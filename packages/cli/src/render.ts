import pc from 'picocolors';
import QRCode from 'qrcode';
import type { Board, FundingStatus, NetworkName, Snapshot } from '@gol/core';
import { NETWORKS } from '@gol/core';

export type RenderStyle = 'blocks' | 'braille';

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/** Pick the densest style that fits the terminal. */
export const autoStyle = (board: Board): RenderStyle =>
  (process.stdout.columns ?? 80) >= board.width + 2 ? 'blocks' : 'braille';

/**
 * Render a board as text. `blocks` packs two cells per character with half blocks,
 * `braille` packs 2x4 cells per character.
 */
export const renderBoard = (board: Board, style: RenderStyle = autoStyle(board), color = true): string => {
  const paint = color ? pc.green : (text: string) => text;
  const lines: string[] = [];
  if (style === 'blocks') {
    for (let y = 0; y < board.height; y += 2) {
      let line = '';
      for (let x = 0; x < board.width; x += 1) {
        const top = board.get(x, y);
        const bottom = board.get(x, y + 1);
        line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
      }
      lines.push(paint(line));
    }
  } else {
    for (let y = 0; y < board.height; y += 4) {
      let line = '';
      for (let x = 0; x < board.width; x += 2) {
        let code = 0x2800;
        for (let dy = 0; dy < 4; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) if (board.get(x + dx, y + dy)) code |= BRAILLE_BITS[dy][dx];
        }
        line += String.fromCharCode(code);
      }
      lines.push(paint(line));
    }
  }
  const width = style === 'blocks' ? board.width : Math.ceil(board.width / 2);
  const frame = pc.dim('─'.repeat(width));
  return [pc.dim('┌') + frame + pc.dim('┐'), ...lines.map((line) => pc.dim('│') + line + pc.dim('│')), pc.dim('└') + frame + pc.dim('┘')].join('\n');
};

export const sats = (value: bigint | number): string => `${BigInt(value).toLocaleString('en-US')} sats`;

export const describeFunding = (funding: FundingStatus): string => {
  const lines = [
    `${pc.bold('Balance')}     ${sats(funding.balance)} ${pc.dim(`(~${funding.movesLeft} moves)`)}`,
    `${pc.bold('Next move')}   ${sats(funding.moveFee)} fee`,
  ];
  if (!funding.canMove) {
    lines.push(pc.red(pc.bold(`Not enough funds: ${sats(funding.shortfall)} more needed. Run \`gol fund\` to top up.`)));
  } else if (funding.movesLeft < 10) {
    lines.push(pc.yellow('Running low on funds. Run `gol fund` to top up.'));
  }
  return lines.join('\n');
};

const END_REASONS: Record<string, string> = {
  extinct: 'every cell died',
  still: 'the board froze into a still life',
  oscillating: 'the board is repeating itself',
  limit: 'the generation limit was reached',
};

export const describeState = (snapshot: Snapshot): string => {
  const { state, board, endReason } = snapshot;
  if (state.gameId === 0) return pc.cyan('No game has been played yet. Start one with `gol new`.');
  const status = state.ended
    ? pc.magenta(`ended - ${endReason ? END_REASONS[endReason] : 'finished'}`)
    : pc.green('running');
  return [
    `${pc.bold('Game')}        #${state.gameId}  ${status}`,
    `${pc.bold('Generation')}  ${state.generation}`,
    `${pc.bold('Population')}  ${board?.population() ?? 0} cells`,
  ].join('\n');
};

export const describeEndReason = (reason?: string): string => (reason ? END_REASONS[reason] ?? reason : '');

export const qrCode = async (text: string): Promise<string> =>
  QRCode.toString(text, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });

export const printAddress = async (label: string, address: string, description: string, showQr = true): Promise<void> => {
  console.log(`${pc.bold(pc.cyan(label))}  ${pc.dim(description)}`);
  if (showQr) console.log(await qrCode(address));
  console.log(`  ${pc.bold(address)}\n`);
};

export const explorerTx = (network: NetworkName, txid: string): string => `${NETWORKS[network].explorerTx}${txid}`;
