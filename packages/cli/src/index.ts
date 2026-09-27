#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command, Option } from 'commander';
import pc from 'picocolors';
import {
  Board,
  DEFAULT_PARAMS,
  GameClient,
  MAX_GENERATIONS_PER_MOVE,
  MIN_DEPLOY_FUNDING,
  NETWORKS,
  NETWORK_NAMES,
  NotEnoughFundsError,
  PATTERNS,
  centerPattern,
  connect,
  createDeployerKey,
  createSandbox,
  deployGame,
  deployerAddress,
  deployerKeyFromWif,
  discoverDeployments,
  discoverGames,
  isNetworkName,
  loadHistory,
  pickDefaultGame,
  replayGame,
  type Connection,
  type Deployment,
  type NetworkName,
} from '@gol/core';
import { configPath, deploymentFor, fileTxCache, loadConfig, saveConfig, serverFor, type CliConfig } from './config.js';
import {
  autoStyle,
  describeEndReason,
  describeFunding,
  describeState,
  explorerTx,
  printAddress,
  renderBoard,
  sats,
  type RenderStyle,
} from './render.js';
import { drawScreen, editBoard, fullscreen, keyReader, sleep } from './terminal.js';

interface GlobalOptions {
  network?: string;
  server?: string;
  game?: string;
  style?: RenderStyle;
}

const program = new Command()
  .name('gol')
  .description("Conway's Game of Life, played by Bitcoin Cash smart contracts. No wallet needed - the contracts pay for every move.")
  .addOption(new Option('-n, --network <network>', 'network to use').choices(NETWORK_NAMES))
  .option('--server <host>', 'Fulcrum (Electrum Cash) server to connect to')
  .option('-g, --game <category>', 'token category of the game to play (default: the configured game, else the most active one on chain)')
  .addOption(new Option('--style <style>', 'board rendering style').choices(['blocks', 'braille']));

const globals = (): GlobalOptions => program.opts<GlobalOptions>();

interface Context {
  config: CliConfig;
  network: NetworkName;
  connection: Connection;
}

const context = (): Context => {
  const config = loadConfig();
  const options = globals();
  const network = (options.network ?? config.network) as NetworkName;
  if (!isNetworkName(network)) throw new Error(`Unknown network ${network}`);
  const server = options.server ?? serverFor(config, network);
  return { config, network, connection: connect(network, server, { persistent: true }) };
};

/** Look up a game by its category in the on-chain registry. */
const findDeployment = async (ctx: Context, category: string): Promise<Deployment> => {
  const wanted = category.trim().toLowerCase();
  const found = (await discoverDeployments(ctx.network, ctx.connection.provider, ctx.connection.reader))
    .find((entry) => entry.deployment.category === wanted);
  if (!found) throw new Error(`Game ${wanted} was not found in the ${NETWORKS[ctx.network].label} registry. See \`gol games\`.`);
  return found.deployment;
};

/**
 * The game to play: `--game`, else the configured game, else the most active game found on
 * chain through the registry.
 */
const gameContext = async (): Promise<Context & { deployment: Deployment; client: GameClient }> => {
  const ctx = context();
  const override = globals().game;
  let deployment = override ? await findDeployment(ctx, override) : deploymentFor(ctx.config, ctx.network);
  if (!deployment) {
    const best = pickDefaultGame(await discoverGames(ctx.connection));
    if (!best) {
      throw new Error(`No games found on ${NETWORKS[ctx.network].label} yet. Deploy the first one with \`gol deploy\`.`);
    }
    deployment = best.deployment;
    console.log(pc.dim(`Playing the most active game found on chain (${deployment.category.slice(0, 12)}…). Pick another with \`gol games\`.`));
  }
  return { ...ctx, deployment, client: new GameClient(deployment, ctx.connection.provider) };
};

const style = (board: Board): RenderStyle => globals().style ?? autoStyle(board);

const header = (ctx: Context & { deployment?: Deployment }): string =>
  pc.dim(`${NETWORKS[ctx.network].label} · ${ctx.connection.server}${ctx.deployment ? ` · game ${ctx.deployment.category.slice(0, 12)}…` : ''}`);

const guideFunding = async (client: GameClient, network: NetworkName, shortfall?: bigint): Promise<void> => {
  console.log(pc.yellow(pc.bold('\nThe game contracts need more BCH to pay for moves.')));
  if (shortfall) console.log(`At least ${pc.bold(sats(shortfall))} more is needed for the next move.`);
  console.log(`Send any amount from any wallet to the funding address below - a move of up to ${MAX_GENERATIONS_PER_MOVE} generations costs about 2,200 sats.\n`);
  await printAddress('Funding address', client.fundingAddress, 'scan with your BCH wallet');
  const faucet = NETWORKS[network].faucet;
  if (faucet) console.log(pc.dim(`Need test coins? Try the faucet: ${faucet}`));
};

const run = (fn: (...args: any[]) => Promise<void>) => async (...args: any[]) => {
  try {
    await fn(...args);
    process.exit(0);
  } catch (error) {
    console.error(pc.red(`\n${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
};

program.command('config')
  .description('show or change the settings (network, server, game)')
  .addOption(new Option('--set-network <network>', 'default network').choices(NETWORK_NAMES))
  .option('--set-server <host>', 'Fulcrum server for the network ("default" to reset)')
  .option('--set-game <category>', 'game to play on the network ("auto" = the most active game on chain)')
  .action(run(async (options) => {
    const config = loadConfig();
    const network: NetworkName = options.setNetwork ?? globals().network ?? config.network;
    if (options.setNetwork) config.network = options.setNetwork;
    if (options.setServer) {
      if (options.setServer === 'default') delete config.servers[network];
      else config.servers[network] = options.setServer;
    }
    if (options.setGame) {
      if (options.setGame === 'auto' || options.setGame === 'default') delete config.deployments[network];
      else {
        const server = config.servers[network] ?? NETWORKS[network].servers[0];
        const ctx: Context = { config, network, connection: connect(network, server, { persistent: true }) };
        config.deployments[network] = await findDeployment(ctx, options.setGame);
      }
    }
    if (options.setNetwork || options.setServer || options.setGame) saveConfig(config);
    console.log(pc.bold('Settings') + pc.dim(`  (${configPath()})`));
    console.log(`  default network  ${pc.cyan(config.network)}`);
    for (const name of NETWORK_NAMES) {
      const deployment = deploymentFor(config, name);
      console.log(`\n  ${pc.bold(NETWORKS[name].label)}`);
      console.log(`    server  ${serverFor(config, name)}`);
      console.log(`    game    ${deployment ? `${deployment.category} (${deployment.width}x${deployment.height})` : pc.dim('auto - the most active game on chain')}`);
    }
  }));

program.command('games')
  .description('list every game deployed on the network (found on chain), most active first')
  .action(run(async () => {
    const ctx = context();
    console.log(header(ctx));
    const games = await discoverGames(ctx.connection);
    if (!games.length) {
      console.log('No games on this network yet. Deploy the first one with `gol deploy`.');
      return;
    }
    const configured = deploymentFor(ctx.config, ctx.network)?.category;
    games.forEach((game, index) => {
      const s = game.snapshot;
      const status = !s ? pc.red(`unavailable: ${game.error}`)
        : s.state.gameId === 0 ? pc.cyan('waiting for its first game')
          : s.state.ended ? pc.magenta(`game #${s.state.gameId} over at generation ${s.state.generation}`)
            : pc.green(`game #${s.state.gameId} running, generation ${s.state.generation}`);
      const marker = game.deployment.category === configured ? pc.yellow(' ★ selected') : index === 0 && !configured ? pc.yellow(' ★ default') : '';
      console.log(`\n${pc.bold(String(index + 1).padStart(2))}. ${game.deployment.category}${marker}`);
      console.log(`    ${game.deployment.width}x${game.deployment.height} · ${status}${s ? pc.dim(` · ${sats(s.funding.balance)} fuel`) : ''}`);
    });
    console.log(pc.dim('\nPlay one with `gol config --set-game <category>` (or `--set-game auto` for the most active).'));
  }));

program.command('status')
  .description('show the current game, its board and the funding status')
  .option('--no-board', 'hide the board')
  .action(run(async (options) => {
    const ctx = await gameContext();
    console.log(header(ctx));
    const snapshot = await ctx.client.fetchSnapshot();
    if (options.board && snapshot.board) console.log(renderBoard(snapshot.board, style(snapshot.board)));
    console.log(describeState(snapshot));
    console.log(describeFunding(snapshot.funding));
    if (!snapshot.funding.canMove) await guideFunding(ctx.client, ctx.network, snapshot.funding.shortfall);
  }));

program.command('addresses')
  .description('show every address of the game with QR codes')
  .option('--no-qr', 'hide QR codes')
  .action(run(async (options) => {
    const ctx = await gameContext();
    console.log(header(ctx) + '\n');
    for (const entry of ctx.client.addresses()) await printAddress(entry.label, entry.address, entry.description, options.qr);
    console.log(`${pc.bold('Game token category')}  ${ctx.deployment.category}`);
  }));

program.command('fund')
  .description('show where to send BCH to keep the game going')
  .option('--no-qr', 'hide the QR code')
  .option('-w, --wait', 'wait until new funds arrive')
  .action(run(async (options) => {
    const ctx = await gameContext();
    console.log(header(ctx) + '\n');
    const snapshot = await ctx.client.fetchSnapshot();
    console.log(describeFunding(snapshot.funding) + '\n');
    console.log('Send BCH from any wallet to the funding address. The contracts use it to pay the fee of every move.\n');
    await printAddress('Funding address', ctx.client.fundingAddress, 'scan with your BCH wallet', options.qr);
    const faucet = NETWORKS[ctx.network].faucet;
    if (faucet) console.log(pc.dim(`Need test coins? Try the faucet: ${faucet}\n`));
    if (options.wait) {
      process.stdout.write(pc.dim('Waiting for funds'));
      for (;;) {
        await sleep(5000);
        const next = await ctx.client.fetchSnapshot();
        if (next.funding.balance > snapshot.funding.balance) {
          console.log(pc.green(`\nReceived ${sats(next.funding.balance - snapshot.funding.balance)}! Thank you.`));
          console.log(describeFunding(next.funding));
          return;
        }
        process.stdout.write(pc.dim('.'));
      }
    }
  }));

program.command('step')
  .alias('next')
  .description('advance the running game (the contract pays the fee)')
  .option('-c, --count <n>', 'number of generations to advance', '1')
  .option('--per-move <n>', `generations per transaction (max ${MAX_GENERATIONS_PER_MOVE}; more per move is cheaper per generation)`, String(MAX_GENERATIONS_PER_MOVE))
  .option('--no-board', 'do not print the board')
  .action(run(async (options) => {
    const ctx = await gameContext();
    console.log(header(ctx));
    let remaining = Math.max(1, Number(options.count) || 1);
    const perMove = Math.min(MAX_GENERATIONS_PER_MOVE, Math.max(1, Number(options.perMove) || MAX_GENERATIONS_PER_MOVE));
    let snapshot = await ctx.client.fetchSnapshot();
    while (remaining > 0) {
      if (!snapshot.board || snapshot.state.ended) {
        console.log(pc.yellow(snapshot.state.gameId === 0
          ? 'No game has been started yet. Start one with `gol new`.'
          : `Game #${snapshot.state.gameId} has ended (${describeEndReason(snapshot.endReason)}). Start a new one with \`gol new\`.`));
        return;
      }
      try {
        const result = await ctx.client.step(snapshot, Math.min(perMove, remaining));
        snapshot = result.snapshot;
        remaining -= result.generations;
        if (options.board) console.log(renderBoard(result.board, style(result.board)));
        const span = result.generations > 1 ? `s ${result.state.generation - result.generations + 1}-` : ' ';
        console.log(`${pc.green('✔')} Generation${span}${pc.bold(String(result.state.generation))} · ${result.board.population()} alive · ${sats(result.fee)} · ${pc.dim(explorerTx(ctx.network, result.txid))}`);
        if (result.endReason) {
          console.log(pc.magenta(pc.bold(`Game over: ${describeEndReason(result.endReason)}. Start a new one with \`gol new\`.`)));
          return;
        }
      } catch (error) {
        if (error instanceof NotEnoughFundsError) {
          await guideFunding(ctx.client, ctx.network, error.funding.shortfall);
          throw new Error('Move not made: not enough funds.');
        }
        throw error;
      }
    }
  }));

program.command('new')
  .description('start a new game (after the previous one has ended)')
  .option('-r, --random [density]', 'random board, density between 0 and 1 (default 0.3)')
  .addOption(new Option('-p, --pattern <id>', 'start from a classic pattern').choices(PATTERNS.map((pattern) => pattern.id)))
  .option('-f, --file <path>', 'load the board from a text file (O or # = alive)')
  .option('-y, --yes', 'start without asking for confirmation')
  .action(run(async (options) => {
    const ctx = await gameContext();
    console.log(header(ctx));
    const { width, height } = ctx.deployment;
    const snapshot = await ctx.client.fetchSnapshot();
    if (!snapshot.state.ended) {
      throw new Error(`Game #${snapshot.state.gameId} is still running (generation ${snapshot.state.generation}). `
        + 'Advance it with `gol step` until it ends - the contract only allows a new game after the current one is over.');
    }
    if (!snapshot.funding.canMove) {
      await guideFunding(ctx.client, ctx.network, snapshot.funding.shortfall);
      throw new Error('Not enough funds to start a game.');
    }
    const fromEditor = options.random === undefined && !options.pattern && !options.file;
    let board: Board | null;
    if (options.random !== undefined) {
      const density = options.random === true ? 0.3 : Number(options.random);
      board = Board.random(width, height, Number.isFinite(density) ? density : 0.3);
    } else if (options.pattern) {
      board = centerPattern(Board.empty(width, height), PATTERNS.find((pattern) => pattern.id === options.pattern)!);
    } else if (options.file) {
      board = Board.fromText(width, height, readFileSync(options.file, 'utf8'));
    } else {
      board = await editBoard(Board.empty(width, height));
    }
    if (!board) {
      console.log('Cancelled.');
      return;
    }
    console.log(renderBoard(board, style(board)));
    console.log(`${board.population()} cells alive.`);
    if (!options.yes && !fromEditor) {
      process.stdout.write('Start this game? [Y/n] ');
      const answer = await new Promise<string>((resolve) => process.stdin.once('data', (data) => resolve(String(data).trim())));
      if (answer && !/^y/i.test(answer)) {
        console.log('Cancelled.');
        return;
      }
    }
    const result = await ctx.client.newGame(board, snapshot);
    console.log(`${pc.green('✔')} Game #${result.state.gameId} started! ${pc.dim(explorerTx(ctx.network, result.txid))}`);
    console.log(pc.dim('Advance it with `gol step` (or `gol step -c 10`).'));
  }));

const loadGames = async (ctx: Awaited<ReturnType<typeof gameContext>>) => {
  const cache = fileTxCache(ctx.deployment);
  try {
    return await loadHistory(ctx.client, ctx.connection.reader, {
      cache,
      onProgress: (done, total) => {
        if (total > 20) process.stdout.write(`\r${pc.dim(`Loading history ${done}/${total}`)}`);
      },
    });
  } finally {
    cache.flush();
    process.stdout.write('\r\x1b[K');
  }
};

program.command('history')
  .description('list every game played so far')
  .action(run(async () => {
    const ctx = await gameContext();
    console.log(header(ctx));
    const history = await loadGames(ctx);
    if (!history.games.length) {
      console.log('No games yet. Start one with `gol new`.');
      return;
    }
    for (const game of history.games) {
      const status = game.ended ? pc.magenta(`ended: ${describeEndReason(game.endReason)}`) : pc.green('running');
      console.log(`${pc.bold(`#${game.gameId}`.padEnd(5))} ${String(game.generations).padStart(5)} generations  `
        + `${String(game.initialBoard.population()).padStart(5)} → ${String(game.finalPopulation).padEnd(5)} cells  ${status}`);
      console.log(pc.dim(`      started in ${game.startTxid}`));
    }
    console.log(pc.dim('\nReplay a game with `gol replay --game <number>`.'));
  }));

program.command('replay')
  .description('replay the current game (or any past game) up to its latest generation')
  .option('--game <number>', 'game number to replay (default: the current game)')
  .option('--fps <n>', 'generations per second', '8')
  .option('--from <generation>', 'start at this generation', '0')
  .action(run(async (options) => {
    const ctx = await gameContext();
    const history = await loadGames(ctx);
    if (!history.games.length) throw new Error('No games have been played yet.');
    const game = options.game
      ? history.games.find((entry) => entry.gameId === Number(options.game))
      : history.games[history.games.length - 1];
    if (!game) throw new Error(`Game #${options.game} not found. See \`gol history\`.`);
    const frames = replayGame(game);
    const delay = 1000 / Math.max(0.5, Number(options.fps) || 8);
    await fullscreen(async () => {
      for (let generation = Math.max(0, Number(options.from) || 0); generation < frames.length; generation += 1) {
        const board = frames[generation];
        drawScreen([
          `${pc.bold(pc.cyan(`Replay of game #${game.gameId}`))}  generation ${pc.bold(String(generation))}/${game.generations}  ${board.population()} alive`,
          renderBoard(board, style(board)),
          pc.dim('Ctrl+C to stop'),
        ].join('\n'));
        await sleep(delay);
      }
      await sleep(1500);
    });
    const final = frames[frames.length - 1];
    console.log(renderBoard(final, style(final)));
    console.log(`Game #${game.gameId}: ${game.generations} generations, ${game.ended ? `ended (${describeEndReason(game.endReason)})` : 'still running'}.`);
  }));

program.command('watch')
  .description('show the board live as other people play')
  .option('--interval <seconds>', 'refresh interval', '5')
  .action(run(async (options) => {
    const ctx = await gameContext();
    await fullscreen(async () => {
      for (;;) {
        const snapshot = await ctx.client.fetchSnapshot();
        drawScreen([
          header(ctx),
          snapshot.board ? renderBoard(snapshot.board, style(snapshot.board)) : '',
          describeState(snapshot),
          describeFunding(snapshot.funding),
          pc.dim('Ctrl+C to stop'),
        ].join('\n'));
        await sleep(Math.max(2, Number(options.interval) || 5) * 1000);
      }
    });
  }));

program.command('deploy')
  .description('deploy a new game on the selected network (funded from any wallet via a QR code)')
  .option('--width <n>', 'board width', String(DEFAULT_PARAMS.width))
  .option('--height <n>', 'board height', String(DEFAULT_PARAMS.height))
  .option('--max-fee <n>', 'maximum fee per move in sats', String(DEFAULT_PARAMS.maxFee))
  .action(run(async (options) => {
    const ctx = context();
    const { config, network } = ctx;
    console.log(header(ctx) + '\n');
    const wif = config.deployerKeys[network];
    const key = wif ? deployerKeyFromWif(wif) : createDeployerKey(network);
    if (!wif) {
      config.deployerKeys[network] = key.wif;
      saveConfig(config);
    }
    const address = deployerAddress(key, network);
    console.log(pc.bold('Deploying a new Game of Life'));
    console.log(`A throwaway deployer key was created for you (saved in ${configPath()}).`);
    console.log(`Fund it with at least ${pc.bold(sats(MIN_DEPLOY_FUNDING))} from any wallet. Everything sent becomes the game's balance.\n`);
    await printAddress('Deployer address', address, 'scan with your BCH wallet');
    const faucet = NETWORKS[network].faucet;
    if (faucet) console.log(pc.dim(`Need test coins? Try the faucet: ${faucet}\n`));

    process.stdout.write(pc.dim('Waiting for funds'));
    for (;;) {
      const utxos = await ctx.connection.provider.getUtxos(address);
      if (utxos.some((utxo) => !utxo.token)) break;
      process.stdout.write(pc.dim('.'));
      await sleep(5000);
    }
    console.log(pc.green('\nFunds received. Deploying...'));
    const { deployment, txid } = await deployGame({
      provider: ctx.connection.provider,
      network,
      key,
      params: {
        width: Number(options.width),
        height: Number(options.height),
        maxFee: Number(options.maxFee),
      },
    });
    config.deployments[network] = deployment;
    delete config.deployerKeys[network];
    saveConfig(config);
    console.log(`${pc.green('✔')} Deployed! ${pc.dim(explorerTx(network, txid))}`);
    console.log(`Game token category: ${pc.bold(deployment.category)}`);
    console.log(pc.dim('It is announced in the on-chain registry, so every client can find it (`gol games`).'));
    console.log(pc.dim('Start the first game with `gol new`.'));
  }));

program.command('sandbox')
  .description('play offline: the real contracts run on an in-memory mock network (no coins needed)')
  .option('-r, --random [density]', 'start from a random board instead of the editor')
  .addOption(new Option('-p, --pattern <id>', 'start from a classic pattern').choices(PATTERNS.map((pattern) => pattern.id)))
  .option('--fps <n>', 'generations per second when auto-playing', '4')
  .action(run(async (options) => {
    const network: NetworkName = (globals().network as NetworkName | undefined) ?? 'chipnet';
    process.stdout.write(pc.dim('Deploying the contracts on an in-memory network…'));
    const sandbox = await createSandbox(network, DEFAULT_PARAMS, 1_000_000n);
    const client = new GameClient(sandbox.deployment, sandbox.connection.provider);
    const { width, height } = sandbox.deployment;
    let board: Board | null;
    if (options.random !== undefined) {
      const density = options.random === true ? 0.3 : Number(options.random);
      board = Board.random(width, height, Number.isFinite(density) ? density : 0.3);
    } else if (options.pattern) {
      board = centerPattern(Board.empty(width, height), PATTERNS.find((pattern) => pattern.id === options.pattern)!);
    } else {
      board = await editBoard(Board.empty(width, height));
    }
    if (!board) return;
    let result = await client.newGame(board);
    let auto = false;
    const delay = 1000 / Math.max(0.5, Number(options.fps) || 4);
    await fullscreen(async () => {
      const keys = keyReader();
      try {
        for (;;) {
          const { snapshot } = result;
          const ended = snapshot.state.ended;
          if (ended) auto = false;
          drawScreen([
            `${pc.bold(pc.cyan('Sandbox'))} ${pc.dim('- every move is evaluated by the BCH VM, but nothing is broadcast')}`,
            renderBoard(snapshot.board!, style(snapshot.board!)),
            describeState(snapshot),
            `${pc.bold('Fee')}         ${sats(result.fee)} per move, paid by the contract · balance ${sats(snapshot.funding.balance)}`,
            pc.dim(ended ? 'Game over. Press any key to quit.'
              : `space next generation · f next ${MAX_GENERATIONS_PER_MOVE} in one move · a ${auto ? 'stop' : 'start'} auto-play · q quit`),
          ].join('\n'));
          const key = await keys.next(auto ? delay : undefined);
          if (ended || key === 'q' || key === '\x1b') return;
          if (key === 'a') { auto = !auto; if (!auto) continue; }
          else if (key !== null && ![' ', '\r', 'n', 'f'].includes(key)) continue;
          // Auto-play and "f" advance several generations per move, which is much cheaper.
          result = await client.step(snapshot, key === 'f' || key === null ? MAX_GENERATIONS_PER_MOVE : 1);
        }
      } finally {
        keys.close();
      }
    });
  }));

program.parseAsync(process.argv);
