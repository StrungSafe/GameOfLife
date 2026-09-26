import pc from 'picocolors';
import { Board, PATTERNS, stampPattern } from '@gol/core';

const ESC = '\x1b[';
const out = process.stdout;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `fn` on the alternate screen, restoring the terminal however it ends. */
export const fullscreen = async <T>(fn: () => Promise<T>): Promise<T> => {
  out.write(`${ESC}?1049h${ESC}?25l`);
  const restore = () => out.write(`${ESC}?25h${ESC}?1049l`);
  const onExit = () => { restore(); process.exit(130); };
  process.once('SIGINT', onExit);
  try {
    return await fn();
  } finally {
    process.off('SIGINT', onExit);
    restore();
  }
};

export const drawScreen = (text: string): void => {
  out.write(`${ESC}H${ESC}2J${text}`);
};

/** Read keys in raw mode until `handler` returns something other than undefined. */
export const readKeys = <T>(handler: (key: string) => T | undefined): Promise<T> => new Promise((resolve) => {
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  const onData = (data: string) => {
    // Split escape sequences from plain characters so fast typing is handled key by key.
    const keys = data.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1b.|[\s\S]/g) ?? [];
    for (const key of keys) {
      if (key === '\u0003') { // Ctrl+C
        stdin.off('data', onData);
        stdin.setRawMode(false);
        process.emit('SIGINT');
        return;
      }
      const result = handler(key);
      if (result !== undefined) {
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        resolve(result);
        return;
      }
    }
  };
  stdin.on('data', onData);
});

const KEY_MOVES: Record<string, [number, number]> = {
  [`${ESC}A`]: [0, -1], [`${ESC}B`]: [0, 1], [`${ESC}C`]: [1, 0], [`${ESC}D`]: [-1, 0],
  k: [0, -1], j: [0, 1], l: [1, 0], h: [-1, 0],
  w: [0, -1], s: [0, 1], d: [1, 0], a: [-1, 0],
  K: [0, -8], J: [0, 8], L: [8, 0], H: [-8, 0],
  W: [0, -8], S: [0, 8], D: [8, 0], A: [-8, 0],
};

/**
 * Interactive editor for the initial board. Returns the board, or null when cancelled.
 */
export const editBoard = async (initial: Board): Promise<Board | null> => {
  if (!process.stdin.isTTY) {
    throw new Error('The board editor needs an interactive terminal. Use --random, --pattern or --file instead.');
  }
  let board = initial.clone();
  let cx = Math.floor(board.width / 2);
  let cy = Math.floor(board.height / 2);
  let patternIndex = 0;
  let offsetX = 0;
  let offsetY = 0;
  let message = '';

  const draw = () => {
    const cols = Math.max(20, (out.columns ?? 80) - 2);
    const rows = Math.max(4, ((out.rows ?? 24) - 6) * 2);
    const viewW = Math.min(board.width, cols);
    const viewH = Math.min(board.height, rows - (rows % 2));
    offsetX = Math.min(Math.max(offsetX, cx - viewW + 1), cx);
    offsetY = Math.min(Math.max(offsetY, cy - viewH + 2), cy - (cy % 2));
    offsetX = Math.max(0, Math.min(offsetX, board.width - viewW));
    offsetY = Math.max(0, Math.min(offsetY - (offsetY % 2), board.height - viewH));

    const lines: string[] = [];
    lines.push(pc.bold(pc.cyan(' Design your starting board ')) + pc.dim(`  ${board.population()} alive  cursor ${cx},${cy}`));
    lines.push(pc.dim(' arrows/hjkl move (shift = x8)  space toggle  r random  c clear  p pattern  enter start  q cancel'));
    lines.push(pc.dim('┌' + '─'.repeat(viewW) + '┐'));
    for (let y = offsetY; y < offsetY + viewH; y += 2) {
      let line = '';
      for (let x = offsetX; x < offsetX + viewW; x += 1) {
        const top = board.get(x, y);
        const bottom = board.get(x, y + 1);
        const ch = top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
        if (x === cx && (y === cy || y + 1 === cy)) {
          // Show the cursor cell in yellow and its partner cell in green.
          const cursorTop = y === cy;
          const glyph = cursorTop ? '▀' : '▄';
          const cursorAlive = cursorTop ? top : bottom;
          const otherAlive = cursorTop ? bottom : top;
          const fg = cursorAlive ? '\x1b[93m' : '\x1b[33m';
          const bg = otherAlive ? '\x1b[42m' : '\x1b[40m';
          line += `${fg}${bg}${cursorAlive ? glyph : glyph === '▀' ? '▔' : '▁'}\x1b[0m`;
        } else {
          line += pc.green(ch);
        }
      }
      lines.push(pc.dim('│') + line + pc.dim('│'));
    }
    lines.push(pc.dim('└' + '─'.repeat(viewW) + '┘'));
    const pattern = PATTERNS[patternIndex];
    lines.push(` ${pc.bold('Pattern')} [${patternIndex + 1}/${PATTERNS.length}] ${pattern.name} ${pc.dim(`- ${pattern.description} (press p to cycle, o to stamp)`)}`);
    lines.push(message ? ` ${message}` : '');
    drawScreen(lines.join('\n'));
  };

  return fullscreen(async () => {
    draw();
    return readKeys<Board | null>((key) => {
      message = '';
      const move = KEY_MOVES[key];
      if (move) {
        cx = Math.max(0, Math.min(board.width - 1, cx + move[0]));
        cy = Math.max(0, Math.min(board.height - 1, cy + move[1]));
      } else if (key === ' ' || key === 'x') {
        board.toggle(cx, cy);
      } else if (key === 'r') {
        board = Board.random(board.width, board.height, 0.3);
        message = pc.cyan('Randomised!');
      } else if (key === 'c') {
        board = Board.empty(board.width, board.height);
      } else if (key === 'p') {
        patternIndex = (patternIndex + 1) % PATTERNS.length;
      } else if (key === 'o') {
        board = stampPattern(board, PATTERNS[patternIndex], cx, cy);
      } else if (key === '\r' || key === '\n') {
        if (board.isEmpty()) {
          message = pc.red('The board is empty - bring some cells to life first.');
        } else {
          return board;
        }
      } else if (key === 'q' || key === '\x1b') {
        return null;
      }
      draw();
      return undefined;
    });
  });
};

/** Buffered raw-mode key reader, for loops that also wait on timers. */
export const keyReader = () => {
  const stdin = process.stdin;
  const queue: string[] = [];
  let waiter: ((key: string | null) => void) | null = null;
  const onData = (data: string) => {
    for (const key of data.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1b.|[\s\S]/g) ?? []) {
      if (key === '\u0003') { process.emit('SIGINT'); return; }
      if (waiter) { const resolve = waiter; waiter = null; resolve(key); } else queue.push(key);
    }
  };
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  stdin.on('data', onData);
  return {
    /** The next key, or null after `timeoutMs`. */
    next(timeoutMs?: number): Promise<string | null> {
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve) => {
        const timer = timeoutMs === undefined ? undefined : setTimeout(() => { waiter = null; resolve(null); }, timeoutMs);
        waiter = (key) => { clearTimeout(timer); resolve(key); };
      });
    },
    close() {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    },
  };
};
