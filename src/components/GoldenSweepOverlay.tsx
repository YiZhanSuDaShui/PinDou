'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { MappedPixel } from '../utils/pixelation';

export interface GoldenSweepRequest {
  color: string;
  id: number;
}

interface GoldenSweepOverlayProps {
  sourceCanvasRef: RefObject<HTMLCanvasElement | null>;
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  request: GoldenSweepRequest | null;
  onComplete?: (id: number) => void;
}

type Sweep = {
  id: number;
  columns: Array<number[] | undefined>;
  first: number;
  last: number;
  start: number;
  end: number;
  radius: number;
  duration: number;
  started: number;
};

type FadingSweep = { sweep: Sweep; head: number; started: number };

const START_DELAY = 65;
const FADE_DURATION = 160;
// The pulse travels across the selected color's actual horizontal bounds,
// NOT from the left edge of the whole picture. This avoids waiting for a
// right-hand detail to light up.
function buildSweep(
  data: MappedPixel[][],
  dims: { N: number; M: number },
  request: GoldenSweepRequest,
  now: number
): Sweep | null {
  const columns: Array<number[] | undefined> = new Array(dims.N);
  let first = dims.N;
  let last = -1;
  const target = request.color.toUpperCase();

  for (let y = 0; y < dims.M; y++) {
    for (let x = 0; x < dims.N; x++) {
      const cell = data[y]?.[x];
      if (cell && !cell.isExternal && cell.color.toUpperCase() === target) {
        if (!columns[x]) columns[x] = [];
        columns[x]!.push(y);
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
    }
  }
  if (last < first) return null;

  const span = last - first + 1;
  return {
    id: request.id, columns, first, last,
    start: first - 1.7, end: last + 2.7,
    radius: Math.max(2.25, Math.min(3.3, span * 0.10)),
    duration: Math.min(850, 455 + 360 * span / Math.max(1, dims.N)),
    started: now
  };
}

function headAt(sweep: Sweep, now: number): number {
  const t = Math.max(0, Math.min(1,
    (now - sweep.started - START_DELAY) / sweep.duration));
  // A soft acceleration/deceleration, with no simultaneous flash.
  const eased = t * t * (3 - 2 * t);
  return sweep.start + (sweep.end - sweep.start) * eased;
}

function paintGold(
  ctx: CanvasRenderingContext2D,
  sweep: Sweep,
  head: number,
  opacity: number,
  cellWidth: number,
  cellHeight: number
) {
  if (opacity <= 0) return;
  // Only visit the columns near the moving light band. Large bead grids
  // remain responsive and the underlying picture is never redrawn per frame.
  const left = Math.max(0, Math.floor(head - sweep.radius));
  const right = Math.min(sweep.columns.length - 1, Math.ceil(head + sweep.radius));
  for (let x = left; x <= right; x++) {
    const rows = sweep.columns[x];
    if (!rows) continue;
    const distance = Math.abs(x + 0.5 - head) / sweep.radius;
    if (distance >= 1) continue;
    const strength = (1 - distance) ** 2 * (3 - 2 * (1 - distance)) * opacity;
    const bx = x * cellWidth;
    const accent = Math.min(cellWidth, cellHeight);
    for (const y of rows) {
      const by = y * cellHeight;
      // Champagne-gold wash, a bright inner shimmer, and a thin illuminated
      // bead edge. Each remains translucent so the true color shows through.
      ctx.fillStyle = `rgba(245, 188, 61, ${(0.53 * strength).toFixed(3)})`;
      ctx.fillRect(bx, by, cellWidth, cellHeight);
      ctx.fillStyle = `rgba(255, 248, 186, ${(0.49 * strength).toFixed(3)})`;
      ctx.fillRect(bx + cellWidth * 0.15, by + cellHeight * 0.13,
        cellWidth * 0.7, cellHeight * 0.55);
      if (accent >= 2.2) {
        ctx.strokeStyle = `rgba(255, 236, 143, ${(0.83 * strength).toFixed(3)})`;
        ctx.lineWidth = Math.max(0.7, Math.min(1.5, accent * 0.08));
        ctx.strokeRect(bx + 0.5, by + 0.5,
          Math.max(0, cellWidth - 1), Math.max(0, cellHeight - 1));
      }
    }
  }
}


function paintStaticGold(
  ctx: CanvasRenderingContext2D, sweep: Sweep,
  cellWidth: number, cellHeight: number
) {
  // Reduced-motion users see a short stationary locator instead of a sweep.
  // One pass over matching beads, without re-creating column maps per frame.
  ctx.fillStyle = 'rgba(246, 201, 85, 0.52)';
  for (let x = sweep.first; x <= sweep.last; x++) {
    const rows = sweep.columns[x];
    if (!rows) continue;
    for (const y of rows) {
      ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
    }
  }
}

export default function GoldenSweepOverlay({
  sourceCanvasRef, mappedPixelData, gridDimensions, request, onComplete
}: GoldenSweepOverlayProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef({ mappedPixelData, gridDimensions });
  modelRef.current = { mappedPixelData, gridDimensions };
  const completionRef = useRef(onComplete);
  completionRef.current = onComplete;
  const runningRef = useRef<{
    active: Sweep | null;
    fading: FadingSweep | null;
    frame: number | null;
  }>({ active: null, fading: null, frame: null });

  // A single rAF loop owns both the new sweep and the quickly fading
  // interrupted sweep. Repeated A -> B -> C changes never queue animations.
  const frameRef = useRef<(time: number) => void>(() => {});
  frameRef.current = (time: number) => {
    const state = runningRef.current;
    state.frame = null;
    const canvas = overlayRef.current;
    const base = sourceCanvasRef.current;
    const dims = modelRef.current.gridDimensions;
    if (!canvas || !base || !dims || !modelRef.current.mappedPixelData) return;

    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width;
      canvas.height = base.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cellWidth = canvas.width / dims.N;
    const cellHeight = canvas.height / dims.M;

    if (state.fading) {
      const fade = 1 - (time - state.fading.started) / FADE_DURATION;
      if (fade > 0) {
        paintGold(ctx, state.fading.sweep, state.fading.head, fade, cellWidth, cellHeight);
      } else {
        state.fading = null;
      }
    }

    if (state.active) {
      const sweep = state.active;
      const elapsed = time - sweep.started;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        // Accessibility: a brief static color locator instead of travel.
        if (elapsed < 220) {
          paintStaticGold(ctx, sweep, cellWidth, cellHeight);
        }
      } else {
        const head = headAt(sweep, time);
        const tail = Math.max(0, Math.min(1,
          (START_DELAY + sweep.duration + 125 - elapsed) / 125));
        if (tail > 0 && elapsed >= START_DELAY) {
          paintGold(ctx, sweep, head, tail, cellWidth, cellHeight);
        }
      }
      const stopAt = reducedMotion ? 220 : START_DELAY + sweep.duration + 125;
      if (elapsed >= stopAt) {
        state.active = null;
        completionRef.current?.(sweep.id);
      }
    }

    if (state.active || state.fading) {
      state.frame = requestAnimationFrame(t => frameRef.current(t));
    }
  };

  // Grid changes (editing/removing a color/importing a CSV) invalidate the
  // previous geometry. Do not restart an old highlight on changed cells.
  useEffect(() => {
    const state = runningRef.current;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    state.active = null;
    state.fading = null;
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [mappedPixelData, gridDimensions]);

  useEffect(() => {
    const state = runningRef.current;
    const now = performance.now();

    // Freeze the interrupted beam where it was, then fade it out in 160ms.
    // Never make the new beam wait for the previous one to finish.
    if (state.active) {
      state.fading = {
        sweep: state.active,
        head: headAt(state.active, now),
        started: now
      };
    }
    state.active = null;

    if (request && modelRef.current.mappedPixelData && modelRef.current.gridDimensions) {
      state.active = buildSweep(
        modelRef.current.mappedPixelData, modelRef.current.gridDimensions,
        request, now
      );
      if (!state.active) completionRef.current?.(request.id);
    }

    if ((state.active || state.fading) && state.frame === null) {
      state.frame = requestAnimationFrame(time => frameRef.current(time));
    }
  }, [request]);

  useEffect(() => () => {
    const state = runningRef.current;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
  }, []);

  return (
    <canvas
      ref={overlayRef}
      aria-hidden="true"
      data-golden-flow="true"
      className="pointer-events-none absolute"
      style={{
        left: 1,
        top: 1,
        width: 'calc(100% - 2px)',
        height: 'calc(100% - 2px)',
        imageRendering: 'pixelated'
      }}
    />
  );
}
