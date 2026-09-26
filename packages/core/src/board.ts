import { sha256, binToHex } from '@bitauth/libauth';

/**
 * A Game of Life board with dead (non-wrapping) edges.
 *
 * Cells are stored one byte per cell for convenient manipulation. On-chain the board is
 * packed as a big-endian bit string: cell (x, y) is bit index y * width + x, and bit index 0
 * is the most significant bit of byte 0 (matching OP_LSHIFTBIN / OP_RSHIFTBIN semantics).
 */
export class Board {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;

  constructor(width: number, height: number, cells?: Uint8Array) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
      throw new Error(`Invalid board size ${width}x${height}`);
    }
    if ((width * height) % 8 !== 0) {
      throw new Error(`Board cell count must be a multiple of 8 (got ${width}x${height})`);
    }
    this.width = width;
    this.height = height;
    this.cells = cells ?? new Uint8Array(width * height);
    if (this.cells.length !== width * height) {
      throw new Error(`Expected ${width * height} cells, got ${this.cells.length}`);
    }
  }

  static empty(width: number, height: number): Board {
    return new Board(width, height);
  }

  /** A random board where each cell is alive with probability `density`. */
  static random(width: number, height: number, density = 0.3, rng: () => number = Math.random): Board {
    const board = new Board(width, height);
    for (let i = 0; i < board.cells.length; i += 1) board.cells[i] = rng() < density ? 1 : 0;
    return board;
  }

  /** Decode the packed on-chain representation. */
  static fromBytes(width: number, height: number, bytes: Uint8Array): Board {
    const expected = byteLength(width, height);
    if (bytes.length !== expected) {
      throw new Error(`Expected ${expected} board bytes, got ${bytes.length}`);
    }
    const board = new Board(width, height);
    for (let i = 0; i < board.cells.length; i += 1) {
      board.cells[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    }
    return board;
  }

  /** Parse a text pattern: `O`, `#`, `*`, `X`, `1` or `█` are alive, anything else is dead. */
  static fromText(width: number, height: number, text: string, offsetX = 0, offsetY = 0): Board {
    const board = new Board(width, height);
    text.replace(/\r/g, '').split('\n').forEach((line, y) => {
      [...line].forEach((ch, x) => {
        if ('O#*X1█'.includes(ch)) board.set(x + offsetX, y + offsetY, true);
      });
    });
    return board;
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(byteLength(this.width, this.height));
    for (let i = 0; i < this.cells.length; i += 1) {
      if (this.cells[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
    }
    return bytes;
  }

  toHex(): string {
    return binToHex(this.toBytes());
  }

  get(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.cells[y * this.width + x] === 1;
  }

  /** Set a cell; coordinates outside the board are ignored. */
  set(x: number, y: number, alive: boolean): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y * this.width + x] = alive ? 1 : 0;
  }

  toggle(x: number, y: number): void {
    this.set(x, y, !this.get(x, y));
  }

  clone(): Board {
    return new Board(this.width, this.height, this.cells.slice());
  }

  population(): number {
    let count = 0;
    for (const cell of this.cells) count += cell;
    return count;
  }

  isEmpty(): boolean {
    return this.cells.every((cell) => cell === 0);
  }

  equals(other: Board): boolean {
    return this.width === other.width && this.height === other.height
      && this.cells.every((cell, i) => cell === other.cells[i]);
  }

  /** Compute the next generation (B3/S23, cells beyond the edges are dead). */
  next(): Board {
    const { width, height } = this;
    const next = new Board(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if ((dx !== 0 || dy !== 0) && this.get(x + dx, y + dy)) neighbours += 1;
          }
        }
        const alive = this.get(x, y);
        next.cells[y * width + x] = neighbours === 3 || (alive && neighbours === 2) ? 1 : 0;
      }
    }
    return next;
  }

  /** The 16-byte digest stored in the state commitment (truncated sha256 of the packed board). */
  digest(): Uint8Array {
    return boardDigest(this.toBytes());
  }

  /** Render as text using `O` for alive and `.` for dead cells. */
  toText(alive = 'O', dead = '.'): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y += 1) {
      let line = '';
      for (let x = 0; x < this.width; x += 1) line += this.get(x, y) ? alive : dead;
      lines.push(line);
    }
    return lines.join('\n');
  }
}

export const byteLength = (width: number, height: number): number => (width * height) / 8;

export const boardDigest = (packed: Uint8Array): Uint8Array => sha256.hash(packed).slice(0, 16);
