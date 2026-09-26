import { Board } from './board.js';

export interface Pattern {
  id: string;
  name: string;
  description: string;
  /** Rows of the pattern, `O` = alive. */
  rows: string[];
}

export const PATTERNS: Pattern[] = [
  { id: 'glider', name: 'Glider', description: 'The classic spaceship', rows: ['.O.', '..O', 'OOO'] },
  { id: 'lwss', name: 'Lightweight spaceship', description: 'A faster-looking spaceship', rows: ['.O..O', 'O....', 'O...O', 'OOOO.'] },
  { id: 'r-pentomino', name: 'R-pentomino', description: '5 cells, 1103 generations of chaos', rows: ['.OO', 'OO.', '.O.'] },
  { id: 'acorn', name: 'Acorn', description: 'Grows for 5206 generations', rows: ['.O.....', '...O...', 'OO..OOO'] },
  { id: 'diehard', name: 'Diehard', description: 'Vanishes after 130 generations', rows: ['......O.', 'OO......', '.O...OOO'] },
  {
    id: 'pulsar',
    name: 'Pulsar',
    description: 'Period 3 oscillator',
    rows: [
      '..OOO...OOO..',
      '.............',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '..OOO...OOO..',
      '.............',
      '..OOO...OOO..',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '.............',
      '..OOO...OOO..',
    ],
  },
  {
    id: 'gosper-gun',
    name: 'Gosper glider gun',
    description: 'Shoots a glider every 30 generations',
    rows: [
      '........................O...........',
      '......................O.O...........',
      '............OO......OO............OO',
      '...........O...O....OO............OO',
      'OO........O.....O...OO..............',
      'OO........O...O.OO....O.O...........',
      '..........O.....O.......O...........',
      '...........O...O....................',
      '............OO......................',
    ],
  },
  { id: 'blinker', name: 'Blinker', description: 'Period 2 oscillator', rows: ['OOO'] },
  { id: 'beacon', name: 'Beacon', description: 'Period 2 oscillator', rows: ['OO..', 'OO..', '..OO', '..OO'] },
];

export const patternSize = (pattern: Pattern): { width: number; height: number } => ({
  width: Math.max(...pattern.rows.map((row) => row.length)),
  height: pattern.rows.length,
});

/** Stamp a pattern onto a copy of `board` with its top-left corner at (x, y). */
export const stampPattern = (board: Board, pattern: Pattern, x: number, y: number): Board => {
  const next = board.clone();
  pattern.rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch === 'O') next.set(x + dx, y + dy, true);
    });
  });
  return next;
};

/** Stamp a pattern in the middle of `board`. */
export const centerPattern = (board: Board, pattern: Pattern): Board => {
  const { width, height } = patternSize(pattern);
  return stampPattern(board, pattern, Math.floor((board.width - width) / 2), Math.floor((board.height - height) / 2));
};
