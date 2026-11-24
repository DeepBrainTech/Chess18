# Chess18

Chess18 is a browser-based chess game with local play and private online rooms.

## Run locally

```sh
npm install
npm run dev
```

Open the address printed in the terminal. To play online with another device on
the same network, both devices should open this computer's LAN address and
create or join a room using its code. Allow the selected port through the
computer's firewall if prompted.

Local games work without an online room. Without PostgreSQL, online room seats
are saved in `data/rooms.json`. Treat browser room-seat data as private; it is
used to reclaim that seat.

## Run the full stack with Docker Compose

From a fresh clone, start the frontend, backend, and PostgreSQL database with:

```sh
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Compose builds the
application images, waits for PostgreSQL and the backend health checks, and
routes Socket.IO through the frontend so the browser uses one origin. This
requires Docker with the Compose plugin; Node.js and PostgreSQL do not need to
be installed on the host.

Stop the stack with `docker compose down`. The named database volume is
preserved; `docker compose down -v` removes the database and all saved history.
Optional local settings can be placed in `.env`; the defaults work without
creating one. The local database-only workflow below is for running Node.js on
the host.

## PostgreSQL history

To run the Node.js app on the host while PostgreSQL runs in Docker, configure
the included development environment file:

```sh
cp .env.example .env
docker compose up -d --wait postgres
npm install
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. The
Compose service uses PostgreSQL 16, binds only to localhost port 5433, and
keeps its data in a named volume. The server loads `.env`, creates or updates
its schema on startup, and uses PostgreSQL for guest profiles, completed
online-game history and progress, and active room snapshots.

Stop the database with `docker compose down`; its named volume preserves data.
Use `docker compose down -v` only when you intend to delete the database. If
`DATABASE_URL` is unset, online rooms use the local JSON file and saved game
history is disabled.

Guest profiles are identified by an opaque token stored in this browser. The
server stores only a hash of the token. Clearing browser storage loses access
to that guest profile; guest profiles are not shared across browsers or
devices. Local same-device games do not require or use a profile.

Run the online room and persistence integration tests with
`npm run test:online`.
