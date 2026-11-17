# Chess18 Requirements

## Goal

Build a browser-based chess game in TypeScript. The first release is a complete standard chess game for two people sharing one device. Chess-variant design is a later milestone.

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

- A new game starts with the standard position, White to move.
- A legal move updates the board, turn indicator, last-move highlight, and move list; an illegal move changes none of them.
- Castling and en passant are accepted only when legal under standard chess rules.
- A promoting pawn cannot complete its move until a promotion piece is chosen, and the selected piece appears on the board.
- The game reports check and ends on checkmate or stalemate, with the correct result.
- Insufficient-material, repetition, and move-count draws are handled according to standard chess rules, including claimable draws.
- Undo restores the previous position and turn. Restart returns to the initial position.
- Two players can complete a game on one device without an account or network connection.

## Deferred and Out of Scope

- Chess-variant rules and custom pieces
- Online multiplayer, accounts, and matchmaking
- A computer opponent
- Clocks, tournaments, and game analysis

## Implementation Direction

- Use TypeScript and browser-native ES modules for the browser application.
- Keep the game self-contained and playable offline after dependencies are installed.
- Use a maintained chess rules library for legal move generation and game-state rules rather than implementing chess rules from scratch.

## Future Variant

Variant mechanics will be specified after the standard chess milestone is playable. They must not change the standard rules in this milestone.
