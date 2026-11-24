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

async function startRoomServer(dataDirectory, database = null) {
  const httpServer = createServer();
  const socketServer = new Server(httpServer);
  await attachOnlineRooms(socketServer, dataDirectory, database);
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

  const localProfile = await request(creator, "profile:identify", { guestToken: "unused" });
  assert.equal(localProfile.ok, true);
  assert.equal(localProfile.persistence, "file");
  assert.equal(localProfile.profile, undefined);

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

test("PostgreSQL room storage associates completed games with server-resolved guest profiles", async (t) => {
  const dataDirectory = await createTemporaryDataDirectory();
  const guestIds = new Map([
    ["white-guest-token", "00000000-0000-4000-8000-000000000001"],
    ["black-guest-token", "00000000-0000-4000-8000-000000000002"],
  ]);
  const savedRooms = new Map();
  const savedGames = new Map();
  const database = {
    async loadRooms() {
      return [...savedRooms.values()];
    },
    async saveRoom(snapshot, completedGame) {
      savedRooms.set(snapshot.code, snapshot);
      if (completedGame) savedGames.set(completedGame.roomCode, completedGame);
    },
    async deleteRoom(code) {
      savedRooms.delete(code);
    },
    async roomCodeExists(code) {
      return savedRooms.has(code) || savedGames.has(code);
    },
    async findGuestId(token) {
      return guestIds.get(token) ?? null;
    },
    async identifyGuest(token) {
      const guestToken = guestIds.has(token) ? token : "white-guest-token";
      return { guestToken, stats: { games: 0, wins: 0, draws: 0, losses: 0 }, games: [] };
    },
    async getProfile(token) {
      if (!guestIds.has(token)) return null;
      const userId = guestIds.get(token);
      const games = [...savedGames.values()]
        .filter((game) => game.whiteUserId === userId || game.blackUserId === userId)
        .map((game) => ({
          id: game.roomCode,
          roomCode: game.roomCode,
          mode: game.mode,
          color: game.whiteUserId === userId ? "white" : "black",
          result: game.result,
          reason: game.reason,
          finishedAt: new Date(game.finishedAt).toISOString(),
        }));
      const wins = games.filter((game) => game.result === game.color).length;
      const draws = games.filter((game) => game.result === "draw").length;
      return {
        guestToken: token,
        stats: { games: games.length, wins, draws, losses: games.length - wins - draws },
        games,
      };
    },
  };
  const server = await startRoomServer(dataDirectory, database);
  const whiteClient = await connect(server.url);
  const blackClient = await connect(server.url);
  t.after(async () => {
    whiteClient.disconnect();
    blackClient.disconnect();
    await server.close();
  });

  const whiteProfile = await request(whiteClient, "profile:identify", { guestToken: "white-guest-token" });
  assert.equal(whiteProfile.ok, true);
  assert.equal(whiteProfile.persistence, "postgres");

  const created = await request(whiteClient, "room:create", {
    startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    colorPreference: "white",
    guestToken: "white-guest-token",
    userId: "attacker-controlled-id",
  });
  const joined = await request(blackClient, "room:join", {
    code: created.room.code,
    guestToken: "black-guest-token",
    userId: "attacker-controlled-id",
  });
  assert.equal(joined.ok, true);

  const moves = [
    [whiteClient, created.seatToken, "e2", "e4"],
    [blackClient, joined.seatToken, "e7", "e5"],
    [whiteClient, created.seatToken, "d1", "h5"],
    [blackClient, joined.seatToken, "b8", "c6"],
    [whiteClient, created.seatToken, "f1", "c4"],
    [blackClient, joined.seatToken, "g8", "f6"],
    [whiteClient, created.seatToken, "h5", "f7"],
  ];
  for (const [client, seatToken, from, to] of moves) {
    const response = await request(client, "game:move", {
      code: created.room.code,
      seatToken,
      from,
      to,
    });
    assert.equal(response.ok, true, response.error);
  }

  const savedGame = savedGames.get(created.room.code);
  assert.equal(savedGame.whiteUserId, guestIds.get("white-guest-token"));
  assert.equal(savedGame.blackUserId, guestIds.get("black-guest-token"));
  assert.equal(savedGame.result, "white");
  assert.equal(savedGame.reason, "checkmate");
  assert.equal(savedGame.moves.length, 7);
  assert.equal(savedRooms.get(created.room.code).players.white.userId, guestIds.get("white-guest-token"));
  const history = await request(whiteClient, "profile:history", { guestToken: "white-guest-token" });
  assert.equal(history.stats.games, 1);
  assert.equal(history.stats.wins, 1);
  assert.equal(history.games[0].reason, "checkmate");
  const unauthorizedHistory = await request(whiteClient, "profile:history", { guestToken: "unknown-token" });
  assert.equal(unauthorizedHistory.ok, false);
});
