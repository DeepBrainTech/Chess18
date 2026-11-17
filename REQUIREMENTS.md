# Chess18 Requirements

## Goal

Build a browser-based chess game in TypeScript for two people sharing one device. Classic chess remains available, and Chess18 adds a set of fixed back-rank arrangements while preserving standard chess rules.

## First Milestone: Standard Chess

### Players and Turns

- The game presents a standard 8-by-8 chessboard in the initial position.
- Two players take alternating turns on the same device, with White moving first.
- Only legal moves for the side to move may be made. An illegal move leaves the position unchanged.
- Players select a piece and a destination square to make a move.

### Rules and Game State

- All standard piece movement and captures are supported.
- The game supports castling, en passant, and pawn promotion to a queen, rook, bishop, or knight.
- The game identifies check, checkmate, and stalemate.
- The game recognizes standard drawn positions, including insufficient material, repetition, and move-count draws; players can claim a draw when the rules allow it and agree to a draw.
- A finished game cannot accept further moves. Players can start a new game.

### Board and Controls

- The interface identifies the side to move and communicates check, checkmate, draw, and other finished-game states.
- Selecting a piece distinguishes its legal destinations from other squares.
- The most recent move is visible on the board, and moves are recorded in a readable move list.
- Players can undo the most recent ply and restart the game. Restarting a game in progress requires confirmation.
- Pawn promotion requires the player to choose one of the four legal promotion pieces.
- The board and controls remain usable on narrow screens and support keyboard and assistive-technology labels.

## Acceptance Criteria

- Selecting Classic chess and starting a game uses the standard position, with White to move.
- A legal move updates the board, turn indicator, last-move highlight, and move list; an illegal move changes none of them.
- Castling and en passant are accepted only when legal under standard chess rules.
- A promoting pawn cannot complete its move until a promotion piece is chosen, and the selected piece appears on the board.
- The game reports check and ends on checkmate or stalemate, with the correct result.
- Insufficient-material, repetition, and move-count draws are handled according to standard chess rules, including claimable draws.
- Undo restores the previous position and turn. New Game starts the selected setup or a random Chess18 setup.
- Two players can complete a game on one device without an account or network connection.

## Deferred and Out of Scope

- Variant rules beyond the Chess18 starting positions below
- Online multiplayer, accounts, and matchmaking
- A computer opponent
- Clocks, tournaments, and game analysis

## Implementation Direction

- Use TypeScript and browser-native ES modules for the browser application.
- Keep the game self-contained and playable offline after dependencies are installed.
- Use a maintained chess rules library for legal move generation and game-state rules rather than implementing chess rules from scratch.

## Chess18 Variant

Chess18 changes only the starting back-rank arrangement. All other rules remain standard chess.

The White back rank is selected from these 17 positions, in the order shown from White's perspective. Black uses the same file order on rank 8. The King remains on e-file and the Rooks remain on a- and h-files; the Bishops occupy opposite-colored squares.

1. `RBBNKNQR`
2. `RBBNKQNR`
3. `RBBQKNNR`
4. `RBNNKQBR`
5. `RBNQKNBR`
6. `RBQNKNBR`
7. `RNBBKNQR`
8. `RNBBKQNR`
9. `RNBNKBQR`
10. `RNNBKQBR`
11. `RNNQKBBR`
12. `RNQBKNBR`
13. `RNQNKBBR`
14. `RQBBKNNR`
15. `RQBNKBNR`
16. `RQNBKNBR`
17. `RQNNKBBR`

### Chess18 Acceptance Criteria

- Players can select Random Chess18, Classic chess, or any of the 17 listed positions.
- A new game uses the selected row for White on rank 1 and its same-file black-piece mirror on rank 8; pawns remain on their standard ranks.
- Random Chess18 selects one of the 17 listed positions.
- Every selected arrangement keeps the King on e-file, Rooks on a- and h-files, and Bishops on opposite-colored squares.
- All standard chess rules, including legal moves, castling, en passant, promotion, check, and draw conditions, apply to each arrangement.
