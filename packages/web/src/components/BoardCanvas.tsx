import { useEffect, useRef, useState } from 'react';
import type { Board, Pattern } from '@gol/core';
import type { AnimationStyle } from '../hooks/useSettings';

export interface BoardCanvasProps {
  board: Board;
  dark: boolean;
  animation: AnimationStyle;
  /** Transition length in ms. */
  duration: number;
  showGrid: boolean;
  /** 1 = fit the available space, larger values zoom in (the area scrolls). */
  zoom?: number;
  editable?: boolean;
  /** Called while painting with every cell under the pointer and the value being painted. */
  onPaint?: (cells: Array<[number, number]>, alive: boolean) => void;
  /** When set, clicking stamps this pattern instead of painting. */
  stamp?: Pattern | null;
  onStamp?: (x: number, y: number) => void;
  /** Dim the board (e.g. while loading). */
  dimmed?: boolean;
}

interface Transition {
  from: Board | null;
  to: Board;
  start: number;
  duration: number;
  style: AnimationStyle;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeInCubic = (t: number) => t * t * t;

/** A rainbow that flows diagonally across the board. */
const cellColors = (width: number, height: number, dark: boolean): string[] => {
  const colors: string[] = new Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const hue = (325 + (x / width) * 190 + (y / height) * 70) % 360;
      colors[y * width + x] = dark ? `hsl(${hue} 95% 64%)` : `hsl(${hue} 80% 52%)`;
    }
  }
  return colors;
};

/** Cells along a line, so fast pointer moves don't leave gaps. */
const lineCells = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    cells.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return cells;
};

export function BoardCanvas({
  board,
  dark,
  animation,
  duration,
  showGrid,
  zoom = 1,
  editable = false,
  onPaint,
  stamp,
  onStamp,
  dimmed = false,
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const transitionRef = useRef<Transition>({ from: null, to: board, start: 0, duration: 0, style: 'none' });
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<[number, number] | null>(null);
  const paintRef = useRef<{ alive: boolean; last: [number, number] } | null>(null);
  const colorsRef = useRef<{ key: string; colors: string[] }>({ key: '', colors: [] });
  const drawRef = useRef<() => void>(() => {});

  const { width: W, height: H } = board;
  const fit = space.width && space.height ? Math.min(space.width / W, space.height / H) : 0;
  const cell = Math.max(fit * zoom, 1);

  // Track the space available to the board.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSpace({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const draw = () => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas || !fit) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = W * cell;
    const cssHeight = H * cell;
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Board background and grid.
    ctx.fillStyle = dark ? '#120f28' : '#fffdf7';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    if (showGrid && cell >= 6) {
      ctx.beginPath();
      for (let x = 1; x < W; x += 1) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, cssHeight); }
      for (let y = 1; y < H; y += 1) { ctx.moveTo(0, y * cell); ctx.lineTo(cssWidth, y * cell); }
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(27,21,64,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const colorKey = `${W}x${H}:${dark}`;
    if (colorsRef.current.key !== colorKey) colorsRef.current = { key: colorKey, colors: cellColors(W, H, dark) };
    const colors = colorsRef.current.colors;

    const { from, to, start, duration: length, style } = transitionRef.current;
    const t = style === 'none' || length <= 0 ? 1 : clamp01((performance.now() - start) / length);
    const gap = cell >= 5 ? Math.max(0.5, cell * 0.09) : 0;
    const radius = cell >= 5 ? cell * 0.28 : 0;
    const full = cell - gap * 2;
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    const maxDistance = Math.hypot(cx, cy) || 1;

    const drawCell = (x: number, y: number, scale: number, alpha: number, color: string) => {
      if (scale <= 0.01 || alpha <= 0.01) return;
      const size = full * scale;
      const offset = (cell - size) / 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      if (radius > 0) {
        ctx.beginPath();
        ctx.roundRect(x * cell + offset, y * cell + offset, size, size, radius * scale);
        ctx.fill();
      } else {
        ctx.fillRect(x * cell + offset, y * cell + offset, size, size);
      }
    };

    const fromCells = from?.cells;
    const toCells = to.cells;
    for (let i = 0; i < toCells.length; i += 1) {
      const before = fromCells ? fromCells[i] === 1 : toCells[i] === 1;
      const after = toCells[i] === 1;
      if (!before && !after) continue;
      const x = i % W;
      const y = (i - x) / W;
      let local = t;
      if (style === 'ripple' && t < 1) {
        const distance = Math.hypot(x - cx, y - cy) / maxDistance;
        local = clamp01((t - distance * 0.55) / 0.45);
      }
      if (before && after) {
        drawCell(x, y, 1, 1, colors[i]);
      } else if (after) {
        if (style === 'fade') drawCell(x, y, 1, local, colors[i]);
        else drawCell(x, y, easeOutBack(local), Math.min(1, local * 3), colors[i]);
      } else if (style === 'fade') {
        drawCell(x, y, 1, 1 - local, colors[i]);
      } else {
        drawCell(x, y, 1 - easeInCubic(local), 1 - local * 0.5, colors[i]);
      }
    }
    ctx.globalAlpha = 1;

    // Editing aids: hovered cell and pattern preview.
    const hover = hoverRef.current;
    if (editable && hover) {
      if (stamp) {
        ctx.globalAlpha = 0.45;
        stamp.rows.forEach((row, dy) => {
          [...row].forEach((ch, dx) => {
            const x = hover[0] + dx;
            const y = hover[1] + dy;
            if (ch === 'O' && x < W && y < H) drawCell(x, y, 1, 0.45, dark ? '#ffffff' : '#1b1540');
          });
        });
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = dark ? '#ffc93c' : '#8b5cf6';
        ctx.lineWidth = Math.max(1.5, cell * 0.12);
        ctx.strokeRect(hover[0] * cell + 1, hover[1] * cell + 1, cell - 2, cell - 2);
      }
    }

    if (t < 1) frameRef.current = requestAnimationFrame(() => drawRef.current());
  };
  drawRef.current = draw;

  // Start a transition whenever the board changes.
  useEffect(() => {
    const previous = transitionRef.current.to;
    const sameSize = previous.width === board.width && previous.height === board.height;
    transitionRef.current = {
      from: sameSize ? previous : null,
      to: board,
      start: performance.now(),
      duration: editable ? Math.min(duration, 160) : duration,
      style: editable && animation !== 'none' ? 'pop' : animation,
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => drawRef.current());
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw on size, theme or option changes.
  useEffect(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => drawRef.current());
  }, [cell, dark, showGrid, stamp, editable]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const cellAt = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * W);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * H);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return [x, y];
  };

  const requestDraw = () => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => drawRef.current());
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable) return;
    const target = cellAt(event);
    if (!target) return;
    event.preventDefault();
    if (stamp) {
      onStamp?.(target[0], target[1]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const alive = !board.get(target[0], target[1]);
    paintRef.current = { alive, last: target };
    onPaint?.([target], alive);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable) return;
    const target = cellAt(event);
    const hover = hoverRef.current;
    if (target?.[0] !== hover?.[0] || target?.[1] !== hover?.[1]) {
      hoverRef.current = target;
      requestDraw();
    }
    const paint = paintRef.current;
    if (paint && target && (target[0] !== paint.last[0] || target[1] !== paint.last[1])) {
      onPaint?.(lineCells(paint.last[0], paint.last[1], target[0], target[1]), paint.alive);
      paint.last = target;
    }
  };

  const endPaint = () => {
    paintRef.current = null;
  };

  const onPointerLeave = () => {
    hoverRef.current = null;
    requestDraw();
  };

  return (
    <div ref={containerRef} className={`relative h-full w-full ${zoom > 1 ? 'overflow-auto' : 'overflow-hidden'}`}>
      <div className="flex min-h-full min-w-full items-center justify-center" style={{ width: zoom > 1 ? W * cell : undefined }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Game board, ${board.population()} live cells`}
          className={`block rounded-xl shadow-[0_0_0_2px_rgb(27_21_64_/_0.12)] transition-opacity dark:shadow-[0_0_0_2px_rgb(255_255_255_/_0.08)] ${
            editable ? (stamp ? 'cursor-copy' : 'cursor-crosshair') : ''
          } ${dimmed ? 'opacity-60' : ''}`}
          style={{ width: W * cell, height: H * cell, touchAction: editable ? 'none' : 'auto' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPaint}
          onPointerCancel={endPaint}
          onPointerLeave={onPointerLeave}
        />
      </div>
    </div>
  );
}
