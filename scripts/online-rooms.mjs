import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Chess } from "chess.js";

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCodeLength = 8;
const allowedStartingPositions = [
  "RBBNKNQR", "RBBNKQNR", "RBBQKNNR", "RBNNKQBR", "RBNQKNBR",
  "RBQNKNBR", "RNBBKNQR", "RNBBKQNR", "RNBNKBQR", "RNNBKQBR",
  "RNNQKBBR", "RNQBKNBR", "RNQNKBBR", "RQBBKNNR", "RQBNKBNR",
  "RQNBKNBR", "RQNNKBBR", "RNBQKBNR",
];
const allowedStartingFens = new Set(allowedStartingPositions.map((row) =>
  `${row.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${row} w KQkq - 0 1`
));
const expirationMs = { waiting: 24 * 60 * 60 * 1000, finished: 30 * 24 * 60 * 60 * 1000 };

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createToken() {
  return randomBytes(32).toString("base64url");
}

function createRoomCode(existingRooms) {
  let code;
  do {
    const bytes = randomBytes(roomCodeLength);
    code = Array.from(bytes, (byte) => codeAlphabet[byte & 31]).join("");
  } while (existingRooms.has(code));
  return code;
}

function serializeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    startingFen: room.startingFen,
    moves: room.game.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, promotion })),
    players: Object.fromEntries(["white", "black"]
      .filter((color) => room.players[color])
      .map((color) => [color, {
        tokenHash: room.players[color].tokenHash,
        userId: room.players[color].userId ?? null,
      }])),
    result: room.result,
    drawOffer: room.drawOffer,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    updatedAt: room.updatedAt,
  };
}

function restoreRoom(data) {
  if (!data || typeof data.code !== "string" || !/^[A-Z2-9]{8}$/.test(data.code)
    || !allowedStartingFens.has(data.startingFen)
    || !["waiting", "playing", "finished"].includes(data.status)
    || !Array.isArray(data.moves)
    || !data.players || typeof data.players !== "object") {
    return null;
  }

  const game = new Chess(data.startingFen);
  try {
    for (const move of data.moves) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion });
    }
  } catch {
    return null;
  }

  const players = { white: null, black: null };
  for (const color of ["white", "black"]) {
    const player = data.players[color];
    if (player && typeof player.tokenHash === "string" && /^[a-f0-9]{64}$/.test(player.tokenHash)) {
      players[color] = {
        tokenHash: player.tokenHash,
        userId: typeof player.userId === "string" ? player.userId : null,
        socketId: null,
        connected: false,
      };
    }
  }

  if (!players.white && !players.black) return null;
  return {
    code: data.code,
    status: data.status,
    startingFen: data.startingFen,
    game,
    players,
    result: data.result ?? null,
    drawOffer: data.drawOffer ?? null,
    createdAt: Number(data.createdAt) || Date.now(),
    startedAt: Number(data.startedAt) || null,
    updatedAt: Number(data.updatedAt) || Date.now(),
  };
}

function gameResult(game, startingFen) {
  if (game.isCheckmate()) return { winner: game.turn() === "w" ? "black" : "white", reason: "checkmate" };
  if (game.isStalemate()) return { winner: null, reason: "stalemate" };
  if (game.isInsufficientMaterial()) return { winner: null, reason: "insufficient material" };

  const halfMoveClock = Number(game.fen().split(" ")[4]);
  const replay = new Chess(startingFen);
  const occurrences = new Map([[positionKey(replay.fen()), 1]]);
  for (const move of game.history({ verbose: true })) {
    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    const key = positionKey(replay.fen());
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const currentOccurrences = occurrences.get(positionKey(game.fen())) ?? 0;
  if (currentOccurrences >= 5) return { winner: null, reason: "fivefold repetition" };
  if (halfMoveClock >= 150) return { winner: null, reason: "75-move rule" };
  return null;
}

function positionKey(fen) {
  return fen.split(" ").slice(0, 4).join(" ");
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    startingFen: room.startingFen,
    fen: room.game.fen(),
    turn: room.game.turn(),
    moves: room.game.history({ verbose: true }).map(({ from, to, promotion, san, color }) =>
      ({ from, to, promotion, san, color })),
    players: {
      white: { occupied: Boolean(room.players.white), connected: Boolean(room.players.white?.connected) },
      black: { occupied: Boolean(room.players.black), connected: Boolean(room.players.black?.connected) },
    },
    result: room.result,
    drawOffer: room.drawOffer,
  };
}

export async function attachOnlineRooms(io, dataDirectory, database = null) {
  const filePath = path.join(dataDirectory, "rooms.json");
  const rooms = new Map();
  let writeQueue = Promise.resolve();
  let operationQueue = Promise.resolve();

  if (database) {
    const savedRooms = await database.loadRooms();
    for (const savedRoom of savedRooms) {
      const room = restoreRoom(savedRoom);
      if (room && !isExpired(room)) rooms.set(room.code, room);
      else if (typeof savedRoom?.code === "string") await database.deleteRoom(savedRoom.code);
    }
  } else {
    try {
      const contents = await readFile(filePath, "utf8");
      const savedRooms = JSON.parse(contents);
      if (!Array.isArray(savedRooms)) throw new Error("Online room data must be an array.");
      for (const savedRoom of savedRooms) {
        const room = restoreRoom(savedRoom);
        if (room && !isExpired(room)) rooms.set(room.code, room);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async function persistRooms() {
    if (database) {
      for (const room of rooms.values()) {
        await database.saveRoom(serializeRoom(room), getCompletedGame(room));
      }
      return;
    }
    const write = writeQueue.then(async () => {
      await mkdir(dataDirectory, { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify([...rooms.values()].map(serializeRoom)), "utf8");
      await rename(temporaryPath, filePath);
    });
    writeQueue = write.catch(() => {});
    await write;
  }

  async function persistRoom(room, previousState) {
    try {
      if (database) await database.saveRoom(serializeRoom(room), getCompletedGame(room));
      else await persistRooms();
    } catch (error) {
      if (previousState) {
        const restored = restoreRoom(previousState);
        if (restored) {
          for (const color of ["white", "black"]) {
            const currentPlayer = room.players[color];
            const restoredPlayer = restored.players[color];
            if (currentPlayer && restoredPlayer?.tokenHash === currentPlayer.tokenHash) {
              restoredPlayer.socketId = currentPlayer.socketId;
              restoredPlayer.connected = currentPlayer.connected;
            }
          }
          rooms.set(room.code, restored);
        }
      } else {
        rooms.delete(room.code);
      }
      throw error;
    }
  }

  function enqueue(operation) {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(() => {});
    return result;
  }

  function getCompletedGame(room) {
    if (room.status !== "finished" || !room.players.white?.userId || !room.players.black?.userId
      || room.players.white.userId === room.players.black.userId || !room.result) {
      return null;
    }
    return {
      roomCode: room.code,
      mode: room.startingFen === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        ? "classic"
        : "chess18",
      whiteUserId: room.players.white.userId,
      blackUserId: room.players.black.userId,
      result: room.result.winner ?? "draw",
      reason: room.result.reason,
      startingFen: room.startingFen,
      finalFen: room.game.fen(),
      pgn: room.game.pgn({ maxWidth: 0 }),
      moves: room.game.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, promotion })),
      createdAt: room.createdAt,
      startedAt: room.startedAt ?? room.createdAt,
      finishedAt: room.updatedAt,
    };
  }

  function isExpired(room) {
    const maxAge = expirationMs[room.status];
    return maxAge !== undefined && Date.now() - room.updatedAt > maxAge;
  }

  function findRoom(rawCode) {
    if (typeof rawCode !== "string") return null;
    const code = rawCode.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return null;
    if (isExpired(room)) {
      rooms.delete(code);
      return null;
    }
    return room;
  }

  function getSeat(room, token, socketId) {
    if (typeof token !== "string" || token.length > 128) return null;
    const tokenHash = hashToken(token);
    for (const color of ["white", "black"]) {
      const player = room.players[color];
      if (player?.tokenHash === tokenHash && player.socketId === socketId) return color;
    }
    return null;
  }

  async function createUniqueRoomCode() {
    let code = createRoomCode(rooms);
    while (database && await database.roomCodeExists(code)) {
      code = createRoomCode(rooms);
    }
    return code;
  }

  function sendState(room) {
    io.to(room.code).emit("room:state", publicRoom(room));
  }

  io.on("connection", (socket) => {
    function onRequest(event, handler) {
      socket.on(event, (payload, acknowledge) => {
        if (typeof acknowledge !== "function") return;
        const request = payload && typeof payload === "object" ? payload : {};
        enqueue(() => handler(request, acknowledge)).catch((error) => {
          console.error(`[rooms] ${event} failed`, error);
          acknowledge({ ok: false, error: "The server could not save this room update." });
        });
      });
    }

    onRequest("profile:identify", async (payload, acknowledge) => {
      if (!database) {
        acknowledge({ ok: true, persistence: "file", guestToken: null, stats: null, games: [] });
        return;
      }
      const profile = await database.identifyGuest(payload.guestToken);
      acknowledge({ ok: true, persistence: "postgres", profile });
    });

    onRequest("profile:history", async (payload, acknowledge) => {
      if (!database) {
        acknowledge({ ok: true, persistence: "file", stats: null, games: [] });
        return;
      }
      const profile = await database.getProfile(payload.guestToken);
      if (!profile) {
        acknowledge({ ok: false, error: "Guest profile could not be verified." });
        return;
      }
      acknowledge({ ok: true, persistence: "postgres", stats: profile.stats, games: profile.games });
    });

    onRequest("room:create", async (payload, acknowledge) => {
      if (!allowedStartingFens.has(payload.startingFen)) {
        acknowledge({ ok: false, error: "Choose a listed starting position." });
        return;
      }

      const preference = ["white", "black", "random"].includes(payload.colorPreference)
        ? payload.colorPreference
        : "random";
      const color = preference === "random"
        ? (randomBytes(1)[0] < 128 ? "white" : "black")
        : preference;
      const userId = database ? await database.findGuestId(payload.guestToken) : null;
      if (database && !userId) {
        acknowledge({ ok: false, error: "Connect a guest profile before creating a room." });
        return;
      }
      const token = createToken();
      const code = await createUniqueRoomCode();
      const room = {
        code,
        status: "waiting",
        startingFen: payload.startingFen,
        game: new Chess(payload.startingFen),
        players: { white: null, black: null },
        result: null,
        drawOffer: null,
        createdAt: Date.now(),
        startedAt: null,
        updatedAt: Date.now(),
      };
      room.players[color] = {
        tokenHash: hashToken(token),
        userId,
        socketId: socket.id,
        connected: true,
      };
      rooms.set(code, room);
      await persistRoom(room, null);
      socket.join(code);
      acknowledge({ ok: true, room: publicRoom(room), color, seatToken: token });
      sendState(room);
    });

    onRequest("room:join", async (payload, acknowledge) => {
      const room = findRoom(payload.code);
      if (!room) {
        acknowledge({ ok: false, error: "Room not found or expired." });
        return;
      }
      if (room.status !== "waiting") {
        acknowledge({ ok: false, error: "Room is full or the game has already started." });
        return;
      }

      const userId = database ? await database.findGuestId(payload.guestToken) : null;
      if (database && !userId) {
        acknowledge({ ok: false, error: "Connect a guest profile before joining a room." });
        return;
      }
      if (userId && Object.values(room.players).some((player) => player?.userId === userId)) {
        acknowledge({ ok: false, error: "A guest profile cannot occupy both seats." });
        return;
      }
      const previousState = serializeRoom(room);
      const color = room.players.white ? "black" : "white";
      const token = createToken();
      room.players[color] = {
        tokenHash: hashToken(token),
        userId,
        socketId: socket.id,
        connected: true,
      };
      room.status = "playing";
      room.startedAt = Date.now();
      room.updatedAt = Date.now();
      await persistRoom(room, previousState);
      socket.join(room.code);
      acknowledge({ ok: true, room: publicRoom(room), color, seatToken: token });
      sendState(room);
    });

    onRequest("room:rejoin", async (payload, acknowledge) => {
      const room = findRoom(payload.code);
      if (!room || typeof payload.seatToken !== "string") {
        acknowledge({ ok: false, error: "Room not found or expired." });
        return;
      }
      const tokenHash = hashToken(payload.seatToken);
      const color = ["white", "black"].find((seat) => room.players[seat]?.tokenHash === tokenHash);
      if (!color) {
        acknowledge({ ok: false, error: "This seat cannot be reclaimed." });
        return;
      }
      const previousState = serializeRoom(room);
      room.players[color].socketId = socket.id;
      room.players[color].connected = true;
      room.updatedAt = Date.now();
      await persistRoom(room, previousState);
      socket.join(room.code);
      acknowledge({ ok: true, room: publicRoom(room), color });
      sendState(room);
    });

    onRequest("game:move", async (payload, acknowledge) => {
      const room = findRoom(payload.code);
      if (!room || room.status !== "playing") {
        acknowledge({ ok: false, error: "Game is not active." });
        return;
      }
      const color = getSeat(room, payload.seatToken, socket.id);
      if (!color) {
        acknowledge({ ok: false, error: "You do not hold a seat in this room." });
        return;
      }
      if ((room.game.turn() === "w") !== (color === "white")) {
        acknowledge({ ok: false, error: "It is not your turn." });
        return;
      }
      if (!/^[a-h][1-8]$/.test(payload.from ?? "") || !/^[a-h][1-8]$/.test(payload.to ?? "")
        || (payload.promotion !== undefined && !["q", "r", "b", "n"].includes(payload.promotion))) {
        acknowledge({ ok: false, error: "Invalid move." });
        return;
      }

      const previousState = serializeRoom(room);
      try {
        room.game.move({ from: payload.from, to: payload.to, promotion: payload.promotion });
      } catch {
        acknowledge({ ok: false, error: "Illegal move." });
        return;
      }
      room.result = gameResult(room.game, room.startingFen);
      room.status = room.result ? "finished" : "playing";
      room.drawOffer = null;
      room.updatedAt = Date.now();
      await persistRoom(room, previousState);
      acknowledge({ ok: true });
      sendState(room);
    });

    onRequest("game:draw", async (payload, acknowledge) => {
      const room = findRoom(payload.code);
      const color = room && getSeat(room, payload.seatToken, socket.id);
      if (!room || room.status !== "playing" || !color) {
        acknowledge({ ok: false, error: "Game is not active for this seat." });
        return;
      }

      const previousState = serializeRoom(room);
      if (payload.action === "claim") {
        if ((room.game.turn() === "w") !== (color === "white")) {
          acknowledge({ ok: false, error: "Only the player to move can claim a draw." });
          return;
        }
        const replay = new Chess(room.startingFen);
        for (const move of room.game.history({ verbose: true })) {
          replay.move({ from: move.from, to: move.to, promotion: move.promotion });
        }
        const halfMoveClock = Number(room.game.fen().split(" ")[4]);
        const canClaim = replay.isThreefoldRepetition() || halfMoveClock >= 100;
        if (!canClaim) {
          acknowledge({ ok: false, error: "A draw cannot be claimed in this position." });
          return;
        }
        room.result = { winner: null, reason: "claimed draw" };
        room.status = "finished";
      } else if (payload.action === "offer") {
        if (room.drawOffer) {
          acknowledge({ ok: false, error: "A draw offer is already pending." });
          return;
        }
        room.drawOffer = color;
      } else if (payload.action === "accept") {
        if (!room.drawOffer || room.drawOffer === color) {
          acknowledge({ ok: false, error: "There is no opponent draw offer to accept." });
          return;
        }
        room.result = { winner: null, reason: "draw by agreement" };
        room.status = "finished";
        room.drawOffer = null;
      } else if (payload.action === "decline") {
        if (!room.drawOffer || room.drawOffer === color) {
          acknowledge({ ok: false, error: "There is no opponent draw offer to decline." });
          return;
        }
        room.drawOffer = null;
      } else {
        acknowledge({ ok: false, error: "Invalid draw action." });
        return;
      }

      room.updatedAt = Date.now();
      await persistRoom(room, previousState);
      acknowledge({ ok: true });
      sendState(room);
    });

    onRequest("room:leave", async (payload, acknowledge) => {
      const room = findRoom(payload.code);
      const color = room && getSeat(room, payload.seatToken, socket.id);
      if (!room || !color) {
        acknowledge({ ok: false, error: "You do not hold a seat in this room." });
        return;
      }
      const previousState = serializeRoom(room);
      if (room.status === "waiting") {
        rooms.delete(room.code);
        try {
          if (database) await database.deleteRoom(room.code);
          else await persistRooms();
        } catch (error) {
          const restored = restoreRoom(previousState);
          if (restored) rooms.set(room.code, restored);
          throw error;
        }
        io.to(room.code).emit("room:closed");
      } else if (room.status === "playing") {
        room.result = { winner: color === "white" ? "black" : "white", reason: "resignation" };
        room.status = "finished";
        room.drawOffer = null;
        room.updatedAt = Date.now();
        await persistRoom(room, previousState);
        sendState(room);
      }
      socket.leave(room.code);
      acknowledge({ ok: true });
    });

    socket.on("disconnect", () => {
      enqueue(async () => {
        let changed = false;
        for (const room of rooms.values()) {
          let roomChanged = false;
          for (const color of ["white", "black"]) {
            const player = room.players[color];
            if (player?.socketId === socket.id) {
              player.socketId = null;
              player.connected = false;
              room.updatedAt = Date.now();
              changed = true;
              roomChanged = true;
            }
          }
          if (roomChanged) sendState(room);
        }
        if (changed) await persistRooms();
      }).catch((error) => {
        console.error("[rooms] disconnect state could not be saved", error);
      });
    });
  });
}
