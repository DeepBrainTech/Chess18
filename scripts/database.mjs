import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");
const guestTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createGuestToken() {
  return randomBytes(32).toString("base64url");
}

function publicStats(row) {
  return {
    games: Number(row.games),
    wins: Number(row.wins),
    draws: Number(row.draws),
    losses: Number(row.losses),
  };
}

export class GameDatabase {
  constructor(connectionString, options = {}) {
    this.pool = options.pool ?? new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async initialize() {
    const schema = await readFile(schemaPath, "utf8");
    await this.pool.query(schema);
    await this.pool.query("DELETE FROM online_rooms WHERE expires_at <= NOW()");
    console.log("[db] PostgreSQL schema initialized");
  }

  async identifyGuest(candidateToken) {
    if (typeof candidateToken === "string" && guestTokenPattern.test(candidateToken)) {
      const existing = await this.pool.query(
        "SELECT id FROM guest_profiles WHERE token_hash = $1",
        [hashToken(candidateToken)],
      );
      if (existing.rowCount > 0) {
        return this.loadProfile(existing.rows[0].id, candidateToken);
      }
    }

    const guestToken = createGuestToken();
    const created = await this.pool.query(
      "INSERT INTO guest_profiles (token_hash) VALUES ($1) RETURNING id",
      [hashToken(guestToken)],
    );
    return this.loadProfile(created.rows[0].id, guestToken);
  }

  async findGuestId(guestToken) {
    if (typeof guestToken !== "string" || !guestTokenPattern.test(guestToken)) return null;
    const result = await this.pool.query(
      "SELECT id FROM guest_profiles WHERE token_hash = $1",
      [hashToken(guestToken)],
    );
    return result.rows[0]?.id ?? null;
  }

  async getProfile(guestToken) {
    const userId = await this.findGuestId(guestToken);
    if (!userId) return null;
    return this.loadProfile(userId, guestToken);
  }

  async loadProfile(userId, guestToken) {
    const [statsResult, historyResult] = await Promise.all([
      this.pool.query(
        `SELECT
           COUNT(*)::INTEGER AS games,
           COUNT(*) FILTER (
             WHERE (white_user_id = $1 AND result = 'white')
                OR (black_user_id = $1 AND result = 'black')
           )::INTEGER AS wins,
           COUNT(*) FILTER (WHERE result = 'draw')::INTEGER AS draws,
           COUNT(*) FILTER (
             WHERE (white_user_id = $1 AND result = 'black')
                OR (black_user_id = $1 AND result = 'white')
           )::INTEGER AS losses
         FROM completed_games
         WHERE white_user_id = $1 OR black_user_id = $1`,
        [userId],
      ),
      this.pool.query(
        `SELECT
           id,
           room_code,
           mode,
           CASE WHEN white_user_id = $1 THEN 'white' ELSE 'black' END AS color,
           result,
           reason,
           starting_fen,
           final_fen,
           pgn,
           moves,
           finished_at
         FROM completed_games
         WHERE white_user_id = $1 OR black_user_id = $1
         ORDER BY finished_at DESC
         LIMIT 25`,
        [userId],
      ),
    ]);

    return {
      guestToken,
      stats: publicStats(statsResult.rows[0]),
      games: historyResult.rows.map((row) => ({
        id: row.id,
        roomCode: row.room_code,
        mode: row.mode,
        color: row.color,
        result: row.result,
        reason: row.reason,
        startingFen: row.starting_fen,
        finalFen: row.final_fen,
        pgn: row.pgn,
        moves: row.moves,
        finishedAt: row.finished_at,
      })),
    };
  }

  async loadRooms() {
    const result = await this.pool.query(
      "SELECT snapshot FROM online_rooms WHERE expires_at IS NULL OR expires_at > NOW() ORDER BY updated_at",
    );
    return result.rows.map((row) => row.snapshot);
  }

  async roomCodeExists(code) {
    const result = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM online_rooms WHERE code = $1
         UNION ALL
         SELECT 1 FROM completed_games WHERE room_code = $1
       ) AS exists`,
      [code],
    );
    return result.rows[0].exists;
  }

  async saveRoom(snapshot, completedGame = null) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const expiresAt = snapshot.status === "waiting"
        ? new Date(snapshot.updatedAt + 24 * 60 * 60 * 1000)
        : snapshot.status === "finished"
          ? new Date(snapshot.updatedAt + 30 * 24 * 60 * 60 * 1000)
          : null;
      await client.query(
        `INSERT INTO online_rooms (code, status, snapshot, expires_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (code) DO UPDATE SET
           status = EXCLUDED.status,
           snapshot = EXCLUDED.snapshot,
           expires_at = EXCLUDED.expires_at,
           updated_at = EXCLUDED.updated_at`,
        [
          snapshot.code,
          snapshot.status,
          JSON.stringify(snapshot),
          expiresAt,
          new Date(snapshot.updatedAt),
        ],
      );

      if (completedGame) {
        await client.query(
          `INSERT INTO completed_games (
             room_code, mode, white_user_id, black_user_id, result, reason,
             starting_fen, final_fen, pgn, moves, created_at, started_at, finished_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13
           )
           ON CONFLICT (room_code) DO NOTHING`,
          [
            completedGame.roomCode,
            completedGame.mode,
            completedGame.whiteUserId,
            completedGame.blackUserId,
            completedGame.result,
            completedGame.reason,
            completedGame.startingFen,
            completedGame.finalFen,
            completedGame.pgn,
            JSON.stringify(completedGame.moves),
            new Date(completedGame.createdAt),
            new Date(completedGame.startedAt),
            new Date(completedGame.finishedAt),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[db] transaction rollback failed", rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteRoom(code) {
    await this.pool.query("DELETE FROM online_rooms WHERE code = $1", [code]);
  }

  async close() {
    await this.pool.end();
  }
}
