import { useEffect, useRef } from 'react';
import type { Board } from '@gol/core';

/** A small static rendering of a board, for thumbnails. */
export function MiniBoard({ board, dark, className = 'h-16' }: { board: Board; dark: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = board.width;
    canvas.height = board.height;
    ctx.fillStyle = dark ? '#120f28' : '#fffdf7';
    ctx.fillRect(0, 0, board.width, board.height);
    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        if (!board.get(x, y)) continue;
        const hue = (325 + (x / board.width) * 190 + (y / board.height) * 70) % 360;
        ctx.fillStyle = `hsl(${hue} 90% ${dark ? 64 : 52}%)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [board, dark]);
  return (
    <canvas
      ref={ref}
      className={`rounded-lg border-2 border-ink/10 dark:border-white/10 ${className}`}
      style={{ imageRendering: 'pixelated', aspectRatio: `${board.width} / ${board.height}` }}
    />
  );
}
