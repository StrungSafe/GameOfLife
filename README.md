# Life on Chain

Conway's Game of Life, played by Bitcoin Cash smart contracts written in [CashScript](https://cashscript.org) and using [CashTokens](https://cashtokens.org).

- **No wallet needed.** The contracts pay the fee for every move out of their own balance.
- **Every generation is computed on-chain.** The covenant runs the Game of Life rules in the BCH virtual machine and only accepts the correct next board.
- **Anyone can keep it going.** Send BCH from any wallet to the funding address (QR code in the CLI and the web app).
- **Games run as long as life does.** There is no generation limit; a game ends only when the board dies out, freezes or loops, and then the contract lets anyone start a new game.
- **Cheap moves.** One transaction can advance up to 8 generations for the same ~2,200 sat fee (~275 sats per generation).
- **Discoverable.** Every deployment announces itself in an on-chain registry, so the CLI and web app find all games (and open the most active one) with no configuration.
- **Full history.** Every board is revealed on-chain, so every game can be replayed from the blockchain.

```
packages/
  core/   contracts (.cash), compiled artifacts, board logic, game client, history, deployment + tests
  cli/    `gol` command line interface
  web/    React + Tailwind web app
```

## Quick start

Requires Node 22+ and Yarn 4 (via Corepack: `corepack enable`).

```bash
yarn install
yarn build      # compiles the contracts, then builds core, cli and web
yarn test       # contract + board tests (MockNetworkProvider, full VM evaluation)
yarn dev        # web app on http://localhost:5173
```

Try everything offline first: open **http://localhost:5173/?sandbox** (or `?sandbox=5000` to start almost broke and see the funding flow), or run `yarn gol sandbox`. The sandbox runs the real contracts against CashScript's in-memory mock network, so every move is fully evaluated by the BCH VM without spending coins.

## How it works

### Contracts (`packages/core/contracts`)

**`GameOfLife.cash`** holds the game's state in a single *mutable NFT* that never leaves the contract. Its 121-byte commitment is:

| bytes    | field                                                      |
| -------- | ---------------------------------------------------------- |
| 0-4      | game id                                                    |
| 4-8      | generation                                                 |
| 8        | status (0 running, 1 ended)                                |
| 9-121    | 7 x 16-byte board digests (truncated sha256), newest first |

The board itself (128 x 80 cells = 1,280 bytes, one bit per cell) is passed as the unlocking argument of each move and checked against the digest, which keeps the state tiny while publishing every board on-chain.

The contract has a single function, `play(board, generations)`:

- `generations = 0` starts a new game from any non-empty `board`, only once the previous game has ended.
- `generations = n >= 1` advances the running game n generations in a loop. Each generation is computed with bit-parallel logic (`<<`, `>>`, `&`, `|`, `^`, `~` on the whole board at once, a 2-bit adder for the neighbour counts, and column masks so the board does not wrap around). The game ends when the final board is empty or repeats one of the 7 boards before it (still lifes and oscillators up to period 7). Both conditions are permanent, so checking the final board is enough; the clients stop a move exactly on the generation where the game ends. There is no generation limit (the counter holds over 2 billion generations).

Every move must carry the value of *all* inputs into the single game output, minus at most `maxFee` (5,000 sats). A move is ~2,190 bytes (~2,190 sats at 1 sat/byte) whether it advances 1 or 8 generations. Each generation uses ~10% of the VM operation budget, so 9 fit in one move; the clients use at most 8 to keep headroom.

**`GameVault.cash`** is the funding address. Its coins can only be spent next to the game's state NFT, and the game covenant then moves them into the game - so donations can only ever pay for moves. (Don't send BCH straight to the game contract: only the funding address is merged into the game.)

### Discovery (`packages/core/src/registry.ts`)

Every genesis transaction pays an 800-sat marker to a fixed **registry address** and carries the game's parameters in an OP_RETURN (`LIFE`, version, width, height, max fee). The registry is a P2SH32 address whose redeem script starts with `OP_RETURN`, so nobody owns it or can spend from it, and it is the same on every network. Clients read the registry address's history from any Fulcrum server, verify each genesis against the contract (the state token, its initial commitment and the contract address must all match, so spam is ignored) and load each game's state. With no game selected, the apps play the most active one: running games first, then the most advanced, then the best funded.

The contracts rely on the May 2026 network upgrade (loops, bitwise shifts/invert, 128-byte commitments).

### Tests

`packages/core/test/contract.test.ts` deploys the contracts on a mock network and checks, with full VM evaluation of every transaction:

- boards (random, all edges and corners, 16x16 up to 128x96) evolve exactly like the reference implementation,
- wrong next boards, lies about the current board, empty boards and new games during a running game are rejected,
- multi-generation moves match the reference, cost the same as single ones, stop exactly where the game ends (and a move that overshoots the end still ends it), and the largest move stays within VM limits even while merging the most funding coins,
- each way a game ends (extinct, still life, period-2 and period-3 oscillators) and restarting afterwards,
- fees are bounded, coins cannot leave the contracts, the vault cannot be spent alone, funding is merged,
- "not enough funds" is detected and recovers after funding, VM limits and standard sizes are respected,
- the history of all games is rebuilt from the chain and replays to the current board,
- every deployed game is discovered through the registry, most active first, ignoring spam.

## CLI

```bash
yarn gol --help
yarn gol config --set-network chipnet     # mainnet | chipnet | testnet4
yarn gol games                            # every game on the network, found on chain
yarn gol config --set-game <category>     # play a specific game (`auto` = the most active one)
yarn gol deploy                           # new game contract: fund the QR code, it deploys itself
yarn gol status                           # board, game state, funding
yarn gol new                              # interactive editor (arrows, space, r = random, p/o = patterns)
yarn gol new --random 0.35 | --pattern gosper-gun | --file board.txt
yarn gol step -c 20                       # advance 20 generations, 8 per transaction (the contract pays)
yarn gol fund --wait                      # funding address + QR code, wait for coins
yarn gol addresses                        # every contract address with QR codes
yarn gol history                          # every game played
yarn gol replay [--game 3] [--fps 12]     # replay the current (or any) game
yarn gol watch                            # live view
yarn gol sandbox                          # offline playground
```

Settings live in `~/.gol-bch/config.json` (override with `GOL_HOME`). Use `-n <network>`, `--server <host>` or `-g <category>` on any command to override them. Without a chosen game, commands play the most active game found on chain.

## Web app

`packages/web` - React 19, Vite, Tailwind CSS 4.

- Board fills the screen (maximise button hides the side panel), light and dark mode.
- **Next generation**, **Next 8 generations** (one transaction, 8x cheaper per generation, played back frame by frame) and **Auto-play** send contract-paid moves; **New game** opens the editor (paint cells, random fill with density, classic pattern stamps, zoom).
- **Replay this game** and **All games** replay history straight from the blockchain (transactions are cached in IndexedDB).
- **Fund** shows the funding address as a QR code and text; running low shows how much is missing.
- **Settings**: network (mainnet / chipnet / testnet4), Fulcrum server, the games found on chain (or "most active game"), a share link, animation style (Pop, Fade, Ripple or Snap) and length, theme and grid.
- **Deploy** a new game from the browser with a throwaway key: fund its QR code from any wallet and it deploys.

## Deploying a game

A game is identified by the token category of its state NFT. To deploy one, run `yarn gol deploy` or use *Settings → Deploy a new game contract* in the web app, then fund the shown address (use a faucet on chipnet/testnet4). Everything sent to the deployer becomes the game's fuel.

The new game is announced in the on-chain registry, so every client finds it automatically. You can also share a direct link from the settings dialog.
