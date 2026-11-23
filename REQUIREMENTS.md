# Chess18 Requirements

## Goal

Build a browser-based chess game in TypeScript for two people to play on one device or on separate devices in a private online room. Classic chess remains available, and Chess18 adds a set of fixed back-rank arrangements while preserving standard chess rules.

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

## Online Multiplayer

- Keep same-device local play available without an account, backend, or network connection.
- A player can create a private online room and share its server-generated room code. Another player can join by entering that code; rooms are not publicly joinable or discoverable.
- The server rejects invalid, expired, full, or already-started room joins and prevents room-code collisions.
- The server is authoritative for online games: it validates each move against the current position, active player's seat and turn, and game status. Invalid moves leave the game unchanged.
- After each accepted move, the server persists the canonical game state and broadcasts it to both players so their board, turn, move list, and game result stay in sync.
- A player's seat is bound to a stable identity, not a transient socket connection. After a refresh or disconnect, that player can reclaim the same color and resume the current game without allowing another player to take the seat.
- On reconnect, the server sends the latest authoritative position, move history, turn, and game status. A server restart must not lose an active online game or its room code and seat assignments.
- Once a game is finished, the server rejects further moves and records the final result.

### Online Multiplayer Acceptance Criteria

- Creating a room returns a room code; a second device can join with that code, and both clients see the same game and assigned colors.
- A move from the wrong player, out of turn, illegal under the selected chess setup, or submitted after the game ends is rejected without changing either client's state.
- Refreshing either client or reconnecting after a network interruption restores that player's original seat and the latest game state.
- Restarting the backend restores active rooms and games from persistent storage, allowing both players to reconnect and continue.
- Local same-device games remain playable without an account, backend, or network connection.

## Database and User History

- Use PostgreSQL to persist user profiles or stable user identifiers, completed-game history, and per-user progress.
- Associate online games and progress with server-verified user identities; never trust a client-supplied user ID to determine record ownership. Users can access only their own history and progress.
- Record enough information to review a game: participants and colors, game mode and starting setup, start and finish times, starting and final positions, move history, and outcome and reason.
- Persist progress in a form that supports each user's games played, wins, draws, and losses. Keep these totals consistent with the recorded game history.
- Persist active online game state as well as completed games, including the room code, seat ownership, current position, turn, and move history. An accepted move must not be reported to clients as complete until its state is safely stored.
- Retain the existing local-play experience without requiring sign-in; when a user is signed in, their local games may be associated with that identity.
- Preserve database data across application and container restarts using a persistent database volume.

### Database Acceptance Criteria

- A signed-in user's completed games and progress remain available after they sign out and back in or use another device.
- A game's stored move history replays from its starting setup to its recorded final position and agrees with its outcome.
- One user cannot read or modify another user's game history or progress.
- Restarting the backend or database does not erase completed games, user progress, or active online games.

## Docker Compose

- Provide a Docker Compose setup that starts the frontend, backend, and PostgreSQL database from a fresh clone with one documented command, such as `docker compose up --build`.
- Docker and Docker Compose are the only required local runtime installations; users do not need to install Node.js or PostgreSQL separately.
- Configure service startup and health checks so the backend waits for a ready database and the frontend can reach the backend.
- Store PostgreSQL data in a named persistent volume so stopping or recreating containers does not erase user data or active games.
- Document the single startup command, how to access the application, and how to stop the stack.

## Deferred and Out of Scope

- Variant rules beyond the Chess18 starting positions below
- Public matchmaking
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
