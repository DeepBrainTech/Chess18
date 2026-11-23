import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Server } from "socket.io";
import { io as createClient } from "socket.io-client";
import { attachOnlineRooms } from "./online-rooms.mjs";

const temporaryDirectories = [];

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function startRoomServer(dataDirectory) {
  const httpServer = createServer();
  const socketServer = new Server(httpServer);
  await attachOnlineRooms(socketServer, dataDirectory);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => socketServer.close(resolve));
    },
  };
}

async function connect(url) {
  const client = createClient(url, { reconnection: false });
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
  return client;
}

function request(client, event, payload) {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}

function nextRoomState(client, code) {
  return new Promise((resolve) => {
    const handler = (state) => {
      if (state.code !== code) return;
      client.off("room:state", handler);
      resolve(state);
    };
    client.on("room:state", handler);
  });
}

async function createTemporaryDataDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chess18-online-"));
  temporaryDirectories.push(directory);
  return directory;
}

test("private rooms validate turns and persist a reconnectable game across restart", async (t) => {
  const dataDirectory = await createTemporaryDataDirectory();
  let server = await startRoomServer(dataDirectory);
  let creator = await connect(server.url);
  const joiner = await connect(server.url);
  t.after(async () => {
    creator.disconnect();
    joiner.disconnect();
    await server.close();
  });

  const created = await request(creator, "room:create", {
    startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    colorPreference: "white",
  });
  assert.equal(created.ok, true);
  assert.equal(created.color, "white");
  assert.match(created.room.code, /^[A-Z2-9]{8}$/);

  const joined = await request(joiner, "room:join", { code: created.room.code.toLowerCase() });
  assert.equal(joined.ok, true);
  assert.equal(joined.color, "black");
  assert.equal(joined.room.status, "playing");

  const duplicateJoin = await request(joiner, "room:join", { code: created.room.code });
  assert.equal(duplicateJoin.ok, false);

  const wrongTurn = await request(joiner, "game:move", {
    code: created.room.code,
    seatToken: joined.seatToken,
    from: "e7",
    to: "e5",
  });
  assert.equal(wrongTurn.ok, false);
  assert.match(wrongTurn.error, /not your turn/i);

  const illegalMove = await request(creator, "game:move", {
    code: created.room.code,
    seatToken: created.seatToken,
    from: "e2",
    to: "e5",
  });
  assert.equal(illegalMove.ok, false);

  const creatorState = nextRoomState(creator, created.room.code);
  const joinerState = nextRoomState(joiner, created.room.code);
  const legalMove = await request(creator, "game:move", {
    code: created.room.code,
    seatToken: created.seatToken,
    from: "e2",
    to: "e4",
  });
  assert.equal(legalMove.ok, true);
  assert.equal((await creatorState).fen, (await joinerState).fen);

  creator.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await server.close();
  server = await startRoomServer(dataDirectory);
  creator = await connect(server.url);
  const restored = await request(creator, "room:rejoin", {
    code: created.room.code,
    seatToken: created.seatToken,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.color, "white");
  assert.equal(restored.room.moves.length, 1);
  assert.equal(restored.room.fen, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
});
