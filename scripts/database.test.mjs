import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { GameDatabase } from "./database.mjs";

test("guest profiles receive opaque tokens while only token hashes are stored", async () => {
  const calls = [];
  const pool = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT id FROM guest_profiles")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO guest_profiles")) {
        return { rowCount: 1, rows: [{ id: "00000000-0000-4000-8000-000000000001" }] };
      }
      if (sql.includes("COUNT(*)::INTEGER")) {
        return { rowCount: 1, rows: [{ games: 0, wins: 0, draws: 0, losses: 0 }] };
      }
      if (sql.includes("SELECT\n           id,")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async end() {},
  };
  const database = new GameDatabase("postgresql://unused", { pool });

  const profile = await database.identifyGuest("a".repeat(43));

  assert.match(profile.guestToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(profile.guestToken, "a".repeat(43));
  assert.deepEqual(profile.stats, { games: 0, wins: 0, draws: 0, losses: 0 });
  const insert = calls.find(({ sql }) => sql.includes("INSERT INTO guest_profiles"));
  assert.notEqual(insert.values[0], profile.guestToken);
  assert.match(insert.values[0], /^[a-f0-9]{64}$/);
});

test("room snapshots and completed-game history are written in one PostgreSQL transaction", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
    release() {
      calls.push({ sql: "RELEASE", values: [] });
    },
  };
  const database = new GameDatabase("postgresql://unused", {
    pool: {
      async connect() {
        return client;
      },
      async end() {},
    },
  });
  const snapshot = {
    code: "AB234567",
    status: "finished",
    updatedAt: 1_800_000_000_000,
  };
  const completedGame = {
    roomCode: snapshot.code,
    mode: "classic",
    whiteUserId: "00000000-0000-4000-8000-000000000001",
    blackUserId: "00000000-0000-4000-8000-000000000002",
    result: "white",
    reason: "checkmate",
    startingFen: "start",
    finalFen: "finish",
    pgn: "1. e4 e5",
    moves: [{ from: "e2", to: "e4" }],
    createdAt: snapshot.updatedAt - 1000,
    startedAt: snapshot.updatedAt - 500,
    finishedAt: snapshot.updatedAt,
  };

  await database.saveRoom(snapshot, completedGame);

  const statements = calls.map(({ sql }) => sql);
  assert.equal(statements[0], "BEGIN");
  assert.match(calls[1].sql, /INSERT INTO online_rooms/);
  assert.match(calls[2].sql, /INSERT INTO completed_games/);
  assert.equal(statements[3], "COMMIT");
  assert.equal(statements[4], "RELEASE");
  assert.equal(calls[1].values[0], snapshot.code);
  assert.deepEqual(JSON.parse(calls[1].values[2]), snapshot);
  assert.equal(calls[2].values[0], completedGame.roomCode);
  assert.deepEqual(JSON.parse(calls[2].values[9]), completedGame.moves);
});

test("failed game archival rolls back the active-room update", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes("INSERT INTO completed_games")) throw new Error("database write failed");
      return { rowCount: 1, rows: [] };
    },
    release() {
      statements.push("RELEASE");
    },
  };
  const database = new GameDatabase("postgresql://unused", {
    pool: {
      async connect() {
        return client;
      },
      async end() {},
    },
  });

  await assert.rejects(database.saveRoom(
    { code: "AB234567", status: "finished", updatedAt: Date.now() },
    {
      roomCode: "AB234567",
      mode: "classic",
      whiteUserId: "00000000-0000-4000-8000-000000000001",
      blackUserId: "00000000-0000-4000-8000-000000000002",
      result: "draw",
      reason: "draw by agreement",
      startingFen: "start",
      finalFen: "finish",
      pgn: "",
      moves: [],
      createdAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: Date.now(),
    },
  ), /database write failed/);
  assert.equal(statements[0], "BEGIN");
  assert.match(statements[2], /INSERT INTO completed_games/);
  assert.equal(statements[3], "ROLLBACK");
  assert.equal(statements[4], "RELEASE");
});

test("the schema defines durable profiles, active rooms, and completed game history", async () => {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS guest_profiles/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS online_rooms/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS completed_games/);
  assert.match(schema, /REFERENCES guest_profiles\(id\)/);
});
