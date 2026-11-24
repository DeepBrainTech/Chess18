import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

type PromotionChoice = "q" | "r" | "b" | "n";
type PlayerColor = "white" | "black";
type OnlineStatus = "waiting" | "playing" | "finished";

interface OnlineMove {
  from: Square;
  to: Square;
  promotion?: PromotionChoice;
  san: string;
  color: Color;
}

interface OnlineRoomState {
  code: string;
  status: OnlineStatus;
  startingFen: string;
  fen: string;
  turn: Color;
  moves: OnlineMove[];
  players: Record<PlayerColor, { occupied: boolean; connected: boolean }>;
  result: { winner: PlayerColor | null; reason: string } | null;
  drawOffer: PlayerColor | null;
}

interface OnlineAck {
  ok: boolean;
  room?: OnlineRoomState;
  color?: PlayerColor;
  seatToken?: string;
  persistence?: "postgres" | "file";
  profile?: GuestProfile;
  guestToken?: string;
  stats?: GuestStats | null;
  games?: ProfileGame[];
  error?: string;
}

interface GuestStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

interface ProfileGame {
  id: string;
  roomCode: string;
  mode: "classic" | "chess18";
  color: PlayerColor;
  result: PlayerColor | "draw";
  reason: string;
  finishedAt: string;
}

interface GuestProfile {
  guestToken: string;
  stats: GuestStats;
  games: ProfileGame[];
}

interface OnlineSocket {
  connected: boolean;
  on(event: "connect" | "disconnect", listener: () => void): this;
  on(event: "connect_error", listener: (error: Error) => void): this;
  on(event: "room:state", listener: (state: OnlineRoomState) => void): this;
  on(event: "room:error", listener: (response: { message: string }) => void): this;
  on(event: "room:closed", listener: () => void): this;
  emit(event: string, payload: Record<string, unknown>, acknowledge?: (response: OnlineAck) => void): this;
}

declare global {
  interface Window {
    io?: () => OnlineSocket;
  }
}

const glyphs: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const pieceNames: Record<PieceSymbol, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

const chess18Positions = [
  "RBBNKNQR",
  "RBBNKQNR",
  "RBBQKNNR",
  "RBNNKQBR",
  "RBNQKNBR",
  "RBQNKNBR",
  "RNBBKNQR",
  "RNBBKQNR",
  "RNBNKBQR",
  "RNNBKQBR",
  "RNNQKBBR",
  "RNQBKNBR",
  "RNQNKBBR",
  "RQBBKNNR",
  "RQBNKBNR",
  "RQNBKNBR",
  "RQNNKBBR",
];
const classicPosition = "RNBQKBNR";
const startingPositionSelect = getElement<HTMLSelectElement>("starting-position");
let startingFen = createStartingFen(selectStartingPosition());
const game = new Chess(startingFen);
const boardElement = getElement<HTMLDivElement>("board");
const turnIndicator = getElement<HTMLSpanElement>("turn-indicator");
const turnLabel = getElement<HTMLSpanElement>("turn-label");
const gameMessage = getElement<HTMLParagraphElement>("game-message");
const moveList = getElement<HTMLOListElement>("move-list");
const moveCount = getElement<HTMLSpanElement>("move-count");
const undoButton = getElement<HTMLButtonElement>("undo-button");
const claimDrawButton = getElement<HTMLButtonElement>("claim-draw-button");
const agreeDrawButton = getElement<HTMLButtonElement>("agree-draw-button");
const newGameButton = getElement<HTMLButtonElement>("new-game-button");
const createRoomButton = getElement<HTMLButtonElement>("create-room-button");
const joinRoomForm = getElement<HTMLFormElement>("join-room-form");
const joinRoomButton = getElement<HTMLButtonElement>("join-room-button");
const roomCodeInput = getElement<HTMLInputElement>("room-code-input");
const connectionStatus = getElement<HTMLParagraphElement>("connection-status");
const activeRoomElement = getElement<HTMLDivElement>("active-room");
const roomCodeElement = getElement<HTMLElement>("room-code");
const seatLabel = getElement<HTMLElement>("seat-label");
const copyRoomLinkButton = getElement<HTMLButtonElement>("copy-room-link");
const profileStatus = getElement<HTMLSpanElement>("profile-status");
const profileMessage = getElement<HTMLParagraphElement>("profile-message");
const profileHistory = getElement<HTMLOListElement>("profile-history");
const profileStatsElements: Record<keyof GuestStats, HTMLElement> = {
  games: getElement<HTMLElement>("profile-games"),
  wins: getElement<HTMLElement>("profile-wins"),
  draws: getElement<HTMLElement>("profile-draws"),
  losses: getElement<HTMLElement>("profile-losses"),
};
const promotionDialog = getElement<HTMLDialogElement>("promotion-dialog");
const promotionButtons = promotionDialog.querySelectorAll<HTMLButtonElement>("[data-promotion]");

let selectedSquare: Square | null = null;
let legalMoves: Move[] = [];
let pendingPromotion: { from: Square; to: Square } | null = null;
let agreedDraw = false;
let claimedDraw: string | null = null;
let gameMode: "local" | "online" = "local";
let onlineRoomCode: string | null = null;
let onlineSeatToken: string | null = null;
let onlineColor: Color | null = null;
let onlineRoomStatus: OnlineStatus | null = null;
let onlineResult: OnlineRoomState["result"] = null;
let onlineDrawOffer: PlayerColor | null = null;
let onlinePlayers: OnlineRoomState["players"] | null = null;
let pendingOnlineMove = false;
let onlineMessage = "";
let onlineConnectionState: "connected" | "disconnected" = "disconnected";
const onlineSocket = typeof window.io === "function" ? window.io() : null;
const onlineSessionKey = "chess18-online-seat";
const guestProfileKey = "chess18-guest-profile";
let profileReady = false;
let profilePersistence: "postgres" | "file" | null = null;
let guestToken = readGuestToken();
let guestStats: GuestStats = { games: 0, wins: 0, draws: 0, losses: 0 };
let guestGames: ProfileGame[] = [];

interface SavedOnlineSession {
  code: string;
  seatToken: string;
}

function readSavedOnlineSession(): SavedOnlineSession | null {
  try {
    const saved = localStorage.getItem(onlineSessionKey);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { code, seatToken } = parsed as Record<string, unknown>;
    if (typeof code !== "string" || typeof seatToken !== "string") return null;
    return { code, seatToken };
  } catch {
    return null;
  }
}

let savedOnlineSession = readSavedOnlineSession();

function readGuestToken(): string | null {
  try {
    const token = localStorage.getItem(guestProfileKey);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

function sideName(color: Color): string {
  return color === "w" ? "White" : "Black";
}

function selectStartingPosition(): string {
  if (startingPositionSelect.value === "classic") return classicPosition;
  if (startingPositionSelect.value === "random") {
    return chess18Positions[Math.floor(Math.random() * chess18Positions.length)];
  }
  return chess18Positions[Number(startingPositionSelect.value) - 1] ?? classicPosition;
}

function createStartingFen(whiteBackRank: string): string {
  const blackBackRank = whiteBackRank.toLowerCase();
  return `${blackBackRank}/pppppppp/8/8/8/8/PPPPPPPP/${whiteBackRank} w KQkq - 0 1`;
}

function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

function currentPositionOccurrences(): number {
  const currentPosition = positionKey(game.fen());
  const replay = new Chess(startingFen);
  let occurrences = positionKey(replay.fen()) === currentPosition ? 1 : 0;

  for (const move of game.history({ verbose: true })) {
    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (positionKey(replay.fen()) === currentPosition) occurrences += 1;
  }
  return occurrences;
}

function halfMoveClock(): number {
  return Number(game.fen().split(" ")[4]);
}

function isGameFinished(): boolean {
  if (gameMode === "online") return onlineRoomStatus === "finished";
  return game.isCheckmate()
    || game.isStalemate()
    || game.isInsufficientMaterial()
    || currentPositionOccurrences() >= 5
    || halfMoveClock() >= 150
    || agreedDraw
    || claimedDraw !== null;
}

function squareFor(row: number, column: number): Square {
  return `${"abcdefgh"[column]}${8 - row}` as Square;
}

function getCheckedKingSquare(): Square | null {
  if (!game.isCheck()) return null;

  const board = game.board();
  for (let row = 0; row < board.length; row += 1) {
    for (let column = 0; column < board[row].length; column += 1) {
      const piece = board[row][column];
      if (piece?.type === "k" && piece.color === game.turn()) {
        return squareFor(row, column);
      }
    }
  }
  return null;
}

function renderBoard(): void {
  const board = game.board();
  const legalDestinations = new Map(legalMoves.map((move) => [move.to, move]));
  const lastMove = game.history({ verbose: true }).at(-1);
  const checkedKing = getCheckedKingSquare();
  const finished = isGameFinished();
  const canPlay = gameMode === "local"
    || (onlineRoomStatus === "playing"
      && onlineColor === game.turn()
      && onlineConnectionState === "connected"
      && !pendingOnlineMove);
  const flipped = gameMode === "online" ? onlineColor === "b" : game.turn() === "b";
  boardElement.replaceChildren();

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const boardRow = flipped ? 7 - row : row;
      const boardColumn = flipped ? 7 - column : column;
      const square = squareFor(boardRow, boardColumn);
      const piece = board[boardRow][boardColumn];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `square ${(row + column) % 2 === 0 ? "square-light" : "square-dark"}`;
      button.dataset.square = square;
      button.disabled = finished || !canPlay;

      if (square === selectedSquare) button.classList.add("is-selected");
      if (square === lastMove?.from || square === lastMove?.to) button.classList.add("is-last-move");
      if (square === checkedKing) button.classList.add("is-in-check");

      const destinationMove = legalDestinations.get(square);
      if (destinationMove) {
        button.classList.add(piece ? "is-capture-target" : "is-legal-target");
      }

      const fileLabel = row === 7 ? `<span class="coordinate coordinate-file">${square[0]}</span>` : "";
      const rankLabel = column === 0 ? `<span class="coordinate coordinate-rank">${square[1]}</span>` : "";
      const pieceMarkup = piece
        ? `<span class="piece piece-${piece.color === "w" ? "white" : "black"}" aria-hidden="true">${glyphs[piece.color][piece.type]}</span>`
        : "";
      button.innerHTML = `${pieceMarkup}${rankLabel}${fileLabel}`;

      const pieceDescription = piece ? `${sideName(piece.color)} ${pieceNames[piece.type]}` : "empty";
      button.setAttribute("aria-label", `${square}, ${pieceDescription}${destinationMove ? ", legal destination" : ""}`);
      button.addEventListener("click", () => handleSquareClick(square));
      boardElement.append(button);
    }
  }
}

function resultMessage(): { label: string; message: string; color: Color | null } {
  if (gameMode === "online") {
    if (onlineRoomStatus === "waiting") {
      return { label: "WAITING FOR PLAYER", message: "Share your room code to start the game.", color: null };
    }
    if (onlineRoomStatus === "finished" && onlineResult) {
      if (onlineResult.winner) {
        const winner = onlineResult.winner === "white" ? "White" : "Black";
        return { label: "GAME OVER", message: `${winner} wins by ${onlineResult.reason}.`, color: null };
      }
      return { label: "GAME OVER", message: `${onlineResult.reason[0].toUpperCase()}${onlineResult.reason.slice(1)}.`, color: null };
    }
    if (onlineRoomStatus === "playing" && onlineConnectionState === "disconnected") {
      return { label: "RECONNECTING", message: "Waiting to reconnect to the room.", color: null };
    }
    if (onlineDrawOffer && onlineRoomStatus === "playing") {
      const offeredBy = onlineDrawOffer === "white" ? "White" : "Black";
      return {
        label: onlineDrawOffer === (onlineColor === "w" ? "white" : "black") ? "DRAW OFFER SENT" : "DRAW OFFER",
        message: `${offeredBy} offered a draw.`,
        color: game.turn(),
      };
    }
  }
  if (agreedDraw) return { label: "GAME OVER", message: "Draw by agreement.", color: null };
  if (claimedDraw) return { label: "GAME OVER", message: `Draw claimed: ${claimedDraw}.`, color: null };
  if (game.isCheckmate()) {
    return { label: "CHECKMATE", message: `${sideName(game.turn() === "w" ? "b" : "w")} wins.`, color: null };
  }
  if (game.isStalemate()) return { label: "GAME OVER", message: "Draw by stalemate.", color: null };
  if (game.isInsufficientMaterial()) return { label: "GAME OVER", message: "Draw by insufficient material.", color: null };

  const occurrences = currentPositionOccurrences();
  if (occurrences >= 5) return { label: "GAME OVER", message: "Draw by fivefold repetition.", color: null };
  if (halfMoveClock() >= 150) return { label: "GAME OVER", message: "Draw by the 75-move rule.", color: null };

  const turn = game.turn();
  if (occurrences >= 3) {
    return { label: "DRAW AVAILABLE", message: "Threefold repetition. A draw may be claimed.", color: turn };
  }
  if (halfMoveClock() >= 100) {
    return { label: "DRAW AVAILABLE", message: "The 50-move rule allows a draw claim.", color: turn };
  }
  return {
    label: `${sideName(turn).toUpperCase()} TO MOVE`,
    message: game.isCheck() ? `${sideName(turn)} is in check.` : "The board is set.",
    color: turn,
  };
}

function renderStatus(): void {
  const status = resultMessage();
  turnLabel.textContent = status.label;
  gameMessage.textContent = status.message;
  turnIndicator.classList.toggle("turn-indicator-white", status.color === "w");
  turnIndicator.classList.toggle("turn-indicator-black", status.color === "b");
  turnIndicator.classList.toggle("turn-indicator-finished", status.color === null);

  const history = game.history({ verbose: true });
  const isOnline = gameMode === "online";
  const canActOnline = onlineRoomStatus === "playing"
    && onlineConnectionState === "connected"
    && onlineColor === game.turn();
  const ownColor = onlineColor === "w" ? "white" : "black";
  const canAcceptDraw = onlineConnectionState === "connected"
    && onlineRoomStatus === "playing"
    && onlineDrawOffer !== null
    && onlineDrawOffer !== ownColor;
  undoButton.disabled = isOnline || history.length === 0 || agreedDraw || claimedDraw !== null;
  claimDrawButton.disabled = isGameFinished() || !canClaimDraw() || (isOnline && !canActOnline);
  agreeDrawButton.disabled = isGameFinished()
    || (!isOnline && history.length === 0)
    || (isOnline && (
      (!canActOnline && !canAcceptDraw)
      || (onlineDrawOffer !== null && onlineDrawOffer === ownColor)
    ));
  if (isOnline) {
    agreeDrawButton.textContent = onlineDrawOffer
      ? onlineDrawOffer === (onlineColor === "w" ? "white" : "black") ? "Draw offered" : "Accept draw"
      : "Offer draw";
  } else {
    agreeDrawButton.textContent = "Agree draw";
  }
  newGameButton.textContent = isOnline
    ? onlineRoomStatus === "waiting" ? "Cancel room and play locally" : "Resign and play locally"
    : "＋ New game";
  newGameButton.disabled = isOnline && onlineConnectionState !== "connected";
  moveCount.textContent = `${history.length} ${history.length === 1 ? "ply" : "plies"}`;
  renderOnlineControls();
}

function renderOnlineControls(): void {
  const onlineActive = gameMode === "online" && onlineRoomCode !== null;
  createRoomButton.disabled = onlineActive || !onlineSocket?.connected || !profileReady;
  joinRoomButton.disabled = onlineActive || !onlineSocket?.connected || !profileReady;
  roomCodeInput.disabled = onlineActive;
  activeRoomElement.hidden = !onlineActive;
  if (onlineRoomCode) {
    roomCodeElement.textContent = onlineRoomCode;
    seatLabel.textContent = onlineColor === "w" ? "WHITE" : "BLACK";
  }
  if (onlineActive) {
    const status = onlineRoomStatus === "waiting"
      ? "Waiting for another player to join."
      : onlineRoomStatus === "finished"
        ? "This game has ended."
        : onlinePlayers?.white.connected && onlinePlayers.black.connected
          ? "Both players are connected."
          : "Opponent disconnected. Their seat is reserved.";
    connectionStatus.textContent = onlineConnectionState === "disconnected"
      ? "Connection lost. Reconnecting…"
      : onlineMessage || status;
  } else if (onlineSocket?.connected) {
    connectionStatus.textContent = onlineMessage || "Local play is ready. Online play is optional.";
  } else {
    connectionStatus.textContent = onlineMessage || "Online rooms unavailable. Local play is ready.";
  }
}

function renderGuestProfile(): void {
  for (const [stat, element] of Object.entries(profileStatsElements) as [keyof GuestStats, HTMLElement][]) {
    element.textContent = String(guestStats[stat]);
  }
  profileStatus.textContent = !onlineSocket?.connected
    ? "OFFLINE"
    : !profileReady
      ? "CONNECTING"
      : profilePersistence === "postgres"
        ? "GUEST"
        : "LOCAL ONLY";
  profileMessage.textContent = !onlineSocket?.connected
    ? "Reconnect to load saved online game history."
    : !profileReady
      ? "Connecting to your guest profile."
      : profilePersistence === "postgres"
        ? "Online games are saved to this browser guest profile."
        : "History is disabled until PostgreSQL is configured.";

  profileHistory.replaceChildren();
  if (guestGames.length === 0) {
    const empty = document.createElement("li");
    empty.className = "move-empty";
    empty.textContent = "No completed online games yet";
    profileHistory.append(empty);
    return;
  }

  for (const gameRecord of guestGames) {
    const row = document.createElement("li");
    row.className = "profile-game";
    const opponent = document.createElement("span");
    opponent.textContent = `vs ${gameRecord.color === "white" ? "Black" : "White"} · ${gameRecord.mode === "classic" ? "Classic" : "Chess18"}`;
    const outcome = document.createElement("strong");
    outcome.className = "profile-game-result";
    outcome.textContent = gameRecord.result === "draw"
      ? "Draw"
      : gameRecord.result === gameRecord.color
        ? "Win"
        : "Loss";
    const details = document.createElement("span");
    details.className = "profile-game-meta";
    const date = new Date(gameRecord.finishedAt);
    details.textContent = `Room ${gameRecord.roomCode} · ${Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString()}`;
    row.append(opponent, outcome, details);
    profileHistory.append(row);
  }
}

function renderMoves(): void {
  const history = game.history({ verbose: true });
  moveList.replaceChildren();

  for (let index = 0; index < history.length; index += 2) {
    const row = document.createElement("li");
    row.className = "move-row";
    row.innerHTML = `<span class="move-number">${Math.floor(index / 2) + 1}.</span><span class="move-white">${history[index].san}</span><span class="move-black">${history[index + 1]?.san ?? ""}</span>`;
    moveList.append(row);
  }

  if (history.length === 0) {
    const empty = document.createElement("li");
    empty.className = "move-empty";
    empty.textContent = "No moves yet";
    moveList.append(empty);
  }
}

function render(): void {
  renderBoard();
  renderStatus();
  renderMoves();
  renderGuestProfile();
}

function canClaimDraw(): boolean {
  return currentPositionOccurrences() >= 3 || halfMoveClock() >= 100;
}

function emitOnlineEvent(event: string, payload: Record<string, unknown>): Promise<OnlineAck> {
  if (!onlineSocket?.connected) {
    return Promise.reject(new Error("The online server is not connected."));
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("The server did not respond.")), 10000);
    onlineSocket.emit(event, payload, (response) => {
      window.clearTimeout(timeout);
      if (response.ok) resolve(response);
      else reject(new Error(response.error ?? "The server rejected the request."));
    });
  });
}

function updateGuestProfile(profile: GuestProfile): void {
  try {
    localStorage.setItem(guestProfileKey, profile.guestToken);
    guestToken = profile.guestToken;
  } catch {
    guestToken = null;
    profilePersistence = "file";
    profileReady = false;
    profileMessage.textContent = "The browser cannot save your guest profile. Enable local storage to save history.";
    render();
    return;
  }
  guestStats = profile.stats;
  guestGames = profile.games;
  profileReady = true;
  render();
}

async function initializeGuestProfile(): Promise<void> {
  profileReady = false;
  render();
  try {
    const response = await emitOnlineEvent("profile:identify", { guestToken });
    profilePersistence = response.persistence ?? "file";
    if (response.profile) {
      updateGuestProfile(response.profile);
      return;
    }
    if (response.guestToken) {
      try {
        localStorage.setItem(guestProfileKey, response.guestToken);
        guestToken = response.guestToken;
      } catch {
        guestToken = null;
      }
    }
    guestStats = response.stats ?? { games: 0, wins: 0, draws: 0, losses: 0 };
    guestGames = response.games ?? [];
    profileReady = response.persistence === "file" || Boolean(guestToken);
  } catch (error) {
    profilePersistence = null;
    profileReady = false;
    profileMessage.textContent = error instanceof Error
      ? `Guest profile unavailable: ${error.message}`
      : "Guest profile could not be loaded.";
  }
  render();
}

async function refreshGuestHistory(): Promise<void> {
  if (!guestToken || profilePersistence !== "postgres") return;
  try {
    const response = await emitOnlineEvent("profile:history", { guestToken });
    guestStats = response.stats ?? guestStats;
    guestGames = response.games ?? guestGames;
    renderGuestProfile();
  } catch (error) {
    profileMessage.textContent = error instanceof Error
      ? `Could not refresh game history: ${error.message}`
      : "Could not refresh game history.";
  }
}

function saveOnlineSession(code: string, seatToken: string): boolean {
  try {
    localStorage.setItem(onlineSessionKey, JSON.stringify({ code, seatToken }));
    savedOnlineSession = { code, seatToken };
    return true;
  } catch {
    onlineMessage = "This browser cannot save your seat for reconnecting.";
    return false;
  }
}

function clearOnlineSession(): void {
  try {
    localStorage.removeItem(onlineSessionKey);
  } catch {
    onlineMessage = "Could not clear the saved room from this browser.";
  }
  savedOnlineSession = null;
}

function applyOnlineRoomState(state: OnlineRoomState): void {
  if (state.code !== onlineRoomCode) return;
  const gameJustFinished = state.status === "finished" && onlineRoomStatus !== "finished";
  try {
    game.load(state.startingFen);
    for (const move of state.moves) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion });
    }
  } catch {
    onlineMessage = "The server returned a game position that could not be loaded.";
    return;
  }
  startingFen = state.startingFen;
  onlineRoomStatus = state.status;
  onlineResult = state.result;
  onlineDrawOffer = state.drawOffer;
  onlinePlayers = state.players;
  pendingOnlineMove = false;
  selectedSquare = null;
  legalMoves = [];
  agreedDraw = state.result?.reason === "draw by agreement";
  claimedDraw = state.result?.reason === "claimed draw" ? "a draw claim" : null;
  onlineMessage = "";
  render();
  if (gameJustFinished) void refreshGuestHistory();
}

function activateOnlineRoom(room: OnlineRoomState, color: PlayerColor, seatToken: string): boolean {
  onlineRoomCode = room.code;
  onlineSeatToken = seatToken;
  onlineColor = color === "white" ? "w" : "b";
  gameMode = "online";
  roomCodeInput.value = room.code;
  if (!saveOnlineSession(room.code, seatToken)) return false;
  applyOnlineRoomState(room);
  return true;
}

function resetToLocalGame(): void {
  clearOnlineSession();
  gameMode = "local";
  onlineRoomCode = null;
  onlineSeatToken = null;
  onlineColor = null;
  onlineRoomStatus = null;
  onlineResult = null;
  onlineDrawOffer = null;
  onlinePlayers = null;
  onlineMessage = "";
  pendingOnlineMove = false;
  startingFen = createStartingFen(selectStartingPosition());
  game.load(startingFen);
  agreedDraw = false;
  claimedDraw = null;
  selectedSquare = null;
  legalMoves = [];
  render();
}

async function submitOnlineDraw(action: "claim" | "offer" | "accept"): Promise<void> {
  if (!onlineRoomCode || !onlineSeatToken) return;
  try {
    await emitOnlineEvent("game:draw", {
      code: onlineRoomCode,
      seatToken: onlineSeatToken,
      action,
    });
    onlineMessage = "";
  } catch (error) {
    onlineMessage = error instanceof Error ? error.message : "The draw request failed.";
  }
  render();
}

function handleSquareClick(square: Square): void {
  if (isGameFinished()) return;
  if (gameMode === "online"
    && (onlineRoomStatus !== "playing" || onlineColor !== game.turn() || onlineConnectionState !== "connected" || pendingOnlineMove)) return;

  if (selectedSquare) {
    const targetMoves = legalMoves.filter((move) => move.to === square);
    if (targetMoves.length > 0) {
      const promotionMove = targetMoves.find((move) => move.promotion);
      if (promotionMove) {
        openPromotionDialog(selectedSquare, square, game.turn());
        return;
      }
      makeMove(selectedSquare, square);
      return;
    }
  }

  const piece = game.get(square);
  if (piece?.color === game.turn()) {
    selectedSquare = square;
    legalMoves = game.moves({ square, verbose: true });
  } else {
    selectedSquare = null;
    legalMoves = [];
  }
  render();
}

function makeMove(from: Square, to: Square, promotion?: PromotionChoice): void {
  if (gameMode === "online") {
    if (!onlineRoomCode || !onlineSeatToken || pendingOnlineMove) return;
    pendingOnlineMove = true;
    selectedSquare = null;
    legalMoves = [];
    render();
    emitOnlineEvent("game:move", {
      code: onlineRoomCode,
      seatToken: onlineSeatToken,
      from,
      to,
      promotion,
    }).then(() => {
      pendingOnlineMove = false;
      onlineMessage = "";
      render();
    }).catch((error: unknown) => {
      pendingOnlineMove = false;
      onlineMessage = error instanceof Error ? error.message : "The move was rejected.";
      render();
    });
    return;
  }
  try {
    game.move({ from, to, promotion });
  } catch {
    selectedSquare = null;
    legalMoves = [];
    render();
    return;
  }
  selectedSquare = null;
  legalMoves = [];
  render();
}

function openPromotionDialog(from: Square, to: Square, color: Color): void {
  pendingPromotion = { from, to };
  promotionButtons.forEach((button) => {
    const choice = button.dataset.promotion as PromotionChoice;
    button.innerHTML = `<span class="promotion-piece piece-${color === "w" ? "white" : "black"}" aria-hidden="true">${glyphs[color][choice]}</span><span class="promotion-name">${pieceNames[choice]}</span>`;
  });
  promotionDialog.showModal();
}

promotionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!pendingPromotion) return;
    const choice = button.dataset.promotion as PromotionChoice;
    const move = pendingPromotion;
    pendingPromotion = null;
    promotionDialog.close();
    makeMove(move.from, move.to, choice);
  });
});

getElement<HTMLButtonElement>("cancel-promotion").addEventListener("click", () => {
  pendingPromotion = null;
});

undoButton.addEventListener("click", () => {
  if (gameMode === "online") return;
  if (game.undo()) {
    agreedDraw = false;
    claimedDraw = null;
    selectedSquare = null;
    legalMoves = [];
    render();
  }
});

claimDrawButton.addEventListener("click", () => {
  if (gameMode === "online") {
    void submitOnlineDraw("claim");
    return;
  }
  if (!canClaimDraw()) return;
  claimedDraw = currentPositionOccurrences() >= 3 ? "threefold repetition" : "the 50-move rule";
  selectedSquare = null;
  legalMoves = [];
  render();
});

agreeDrawButton.addEventListener("click", () => {
  if (isGameFinished()) return;
  if (gameMode === "online") {
    const ownColor = onlineColor === "w" ? "white" : "black";
    void submitOnlineDraw(onlineDrawOffer && onlineDrawOffer !== ownColor ? "accept" : "offer");
    return;
  }
  if (window.confirm("Both players agree to end this game as a draw?")) {
    agreedDraw = true;
    selectedSquare = null;
    legalMoves = [];
    render();
  }
});

newGameButton.addEventListener("click", async () => {
  if (gameMode === "online") {
    const prompt = onlineRoomStatus === "waiting"
      ? "Cancel this room and return to local play?"
      : "Resign this online game and return to local play?";
    if (!window.confirm(prompt) || !onlineRoomCode || !onlineSeatToken) return;
    try {
      await emitOnlineEvent("room:leave", { code: onlineRoomCode, seatToken: onlineSeatToken });
      resetToLocalGame();
    } catch (error) {
      onlineMessage = error instanceof Error ? error.message : "Could not leave the online room.";
      render();
    }
    return;
  }
  if (game.history().length > 0 && !window.confirm("Start a new game? The current game will be lost.")) return;
  resetToLocalGame();
});

createRoomButton.addEventListener("click", async () => {
  if (!onlineSocket?.connected) {
    onlineMessage = "The online server is not connected.";
    render();
    return;
  }
  createRoomButton.disabled = true;
  try {
    const response = await emitOnlineEvent("room:create", {
      startingFen: createStartingFen(selectStartingPosition()),
      colorPreference: "random",
      guestToken,
    });
    if (!response.room || !response.color || !response.seatToken) {
      throw new Error("The server returned an incomplete room response.");
    }
    if (!activateOnlineRoom(response.room, response.color, response.seatToken)) {
      await emitOnlineEvent("room:leave", { code: response.room.code, seatToken: response.seatToken });
      resetToLocalGame();
      onlineMessage = "Your browser could not save the room seat.";
    }
  } catch (error) {
    onlineMessage = error instanceof Error ? error.message : "Could not create an online room.";
  }
  render();
});

joinRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    onlineMessage = "Enter a room code to join.";
    render();
    return;
  }
  joinRoomButton.disabled = true;
  try {
    const response = await emitOnlineEvent("room:join", { code, guestToken });
    if (!response.room || !response.color || !response.seatToken) {
      throw new Error("The server returned an incomplete room response.");
    }
    if (!activateOnlineRoom(response.room, response.color, response.seatToken)) {
      await emitOnlineEvent("room:leave", { code: response.room.code, seatToken: response.seatToken });
      resetToLocalGame();
      onlineMessage = "Your browser could not save the room seat.";
    }
  } catch (error) {
    onlineMessage = error instanceof Error ? error.message : "Could not join the room.";
  }
  render();
});

copyRoomLinkButton.addEventListener("click", async () => {
  if (!onlineRoomCode) return;
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", onlineRoomCode);
  try {
    await navigator.clipboard.writeText(inviteUrl.toString());
    onlineMessage = "Invite link copied.";
  } catch {
    onlineMessage = `Share room code ${onlineRoomCode} with the other player.`;
  }
  render();
});

let profileConnectionAttempt = 0;

if (onlineSocket) {
  onlineSocket.on("connect", () => {
    profileConnectionAttempt += 1;
    const attempt = profileConnectionAttempt;
    onlineConnectionState = "connected";
    void initializeGuestProfile().then(async () => {
      if (attempt !== profileConnectionAttempt || !onlineSocket.connected) return;
      if (!savedOnlineSession) return;
      onlineRoomCode = savedOnlineSession.code;
      onlineSeatToken = savedOnlineSession.seatToken;
      gameMode = "online";
      render();
      try {
        const response = await emitOnlineEvent("room:rejoin", {
          code: savedOnlineSession.code,
          seatToken: savedOnlineSession.seatToken,
        });
        if (!response.room || !response.color) throw new Error("The server returned an incomplete reconnect response.");
        onlineColor = response.color === "white" ? "w" : "b";
        applyOnlineRoomState(response.room);
      } catch (error) {
        onlineMessage = error instanceof Error ? error.message : "Could not reclaim the saved seat.";
        render();
      }
    });
  });
  onlineSocket.on("disconnect", () => {
    profileConnectionAttempt += 1;
    profileReady = false;
    onlineConnectionState = "disconnected";
    render();
  });
  onlineSocket.on("connect_error", () => {
    profileConnectionAttempt += 1;
    profileReady = false;
    onlineConnectionState = "disconnected";
    render();
  });
  onlineSocket.on("room:state", (state) => applyOnlineRoomState(state));
  onlineSocket.on("room:error", ({ message }) => {
    onlineMessage = message;
    render();
  });
  onlineSocket.on("room:closed", () => {
    if (gameMode !== "online") return;
    clearOnlineSession();
    gameMode = "local";
    onlineRoomCode = null;
    onlineSeatToken = null;
    onlineColor = null;
    onlineRoomStatus = null;
    onlinePlayers = null;
    onlineResult = null;
    onlineMessage = "This waiting room was closed.";
    render();
  });
}

if (savedOnlineSession) {
  gameMode = "online";
  onlineRoomCode = savedOnlineSession.code;
  onlineSeatToken = savedOnlineSession.seatToken;
}
const roomFromInvite = new URLSearchParams(window.location.search).get("room");
if (roomFromInvite && !savedOnlineSession) roomCodeInput.value = roomFromInvite.toUpperCase();

render();