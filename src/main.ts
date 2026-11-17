import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

type PromotionChoice = "q" | "r" | "b" | "n";

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
const game = new Chess(createStartingFen(selectStartingPosition()));
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
const promotionDialog = getElement<HTMLDialogElement>("promotion-dialog");
const promotionButtons = promotionDialog.querySelectorAll<HTMLButtonElement>("[data-promotion]");

let selectedSquare: Square | null = null;
let legalMoves: Move[] = [];
let pendingPromotion: { from: Square; to: Square } | null = null;
let agreedDraw = false;
let claimedDraw: string | null = null;

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
  const replay = new Chess();
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
  boardElement.replaceChildren();

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const square = squareFor(row, column);
      const piece = board[row][column];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `square ${(row + column) % 2 === 0 ? "square-light" : "square-dark"}`;
      button.dataset.square = square;
      button.disabled = finished;

      if (square === selectedSquare) button.classList.add("is-selected");
      if (square === lastMove?.from || square === lastMove?.to) button.classList.add("is-last-move");
      if (square === checkedKing) button.classList.add("is-in-check");

      const destinationMove = legalDestinations.get(square);
      if (destinationMove) {
        button.classList.add(piece ? "is-capture-target" : "is-legal-target");
      }

      const fileLabel = row === 7 ? `<span class="coordinate coordinate-file">${"abcdefgh"[column]}</span>` : "";
      const rankLabel = column === 0 ? `<span class="coordinate coordinate-rank">${8 - row}</span>` : "";
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
  undoButton.disabled = history.length === 0 || agreedDraw || claimedDraw !== null;
  claimDrawButton.disabled = isGameFinished() || !canClaimDraw();
  agreeDrawButton.disabled = isGameFinished() || history.length === 0;
  moveCount.textContent = `${history.length} ${history.length === 1 ? "ply" : "plies"}`;
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
}

function canClaimDraw(): boolean {
  return currentPositionOccurrences() >= 3 || halfMoveClock() >= 100;
}

function handleSquareClick(square: Square): void {
  if (isGameFinished()) return;

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
  try {
    game.move({ from, to, promotion });
    selectedSquare = null;
    legalMoves = [];
    render();
  } catch {
    selectedSquare = null;
    legalMoves = [];
    render();
  }
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
  if (game.undo()) {
    agreedDraw = false;
    claimedDraw = null;
    selectedSquare = null;
    legalMoves = [];
    render();
  }
});

claimDrawButton.addEventListener("click", () => {
  if (!canClaimDraw()) return;
  claimedDraw = currentPositionOccurrences() >= 3 ? "threefold repetition" : "the 50-move rule";
  selectedSquare = null;
  legalMoves = [];
  render();
});

agreeDrawButton.addEventListener("click", () => {
  if (isGameFinished()) return;
  if (window.confirm("Both players agree to end this game as a draw?")) {
    agreedDraw = true;
    selectedSquare = null;
    legalMoves = [];
    render();
  }
});

newGameButton.addEventListener("click", () => {
  if (game.history().length > 0 && !window.confirm("Start a new game? The current game will be lost.")) return;
  game.load(createStartingFen(selectStartingPosition()));
  agreedDraw = false;
  claimedDraw = null;
  selectedSquare = null;
  legalMoves = [];
  render();
});

render();