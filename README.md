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

Local games work without an online room. Online room seats are saved in
`data/rooms.json`, and the server keeps active rooms across restarts. Treat
browser room-seat data as private; it is used to reclaim that seat.

Run the online room integration tests with `npm run test:online`.
