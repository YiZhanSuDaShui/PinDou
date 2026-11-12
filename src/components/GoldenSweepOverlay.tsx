'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { MappedPixel } from '../utils/pixelation';

export type ColorPreviewMode = 'gold' | 'isolate';

export interface GoldenSweepRequest {
  color: string;
  id: number;
  mode: ColorPreviewMode;
}

interface GoldenSweepOverlayProps {
  sourceCanvasRef: RefObject<HTMLCanvasElement | null>;
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  request: GoldenSweepRequest | null;
  onComplete?: (id: number) => void;
}

type Preview = {
  request: GoldenSweepRequest;
  mask: HTMLCanvasElement;
  columns: Array<number[] | undefined>;
  first: number;
  last: number;
  start: number;
  end: number;
  radius: number;
  sweepDuration: number;
  started: number;
  reducedMotion: boolean;
};

type Interrupted = { snapshot: HTMLCanvasElement; started: number };

const START_DELAY_MS = 65;
const GOLD_HOLD_MS = 2000;
const ISOLATE_HOLD_MS = 3000;
const NATURAL_FADE_MS = 400;
const INTERRUPT_FADE_MS = 160;

function createPreview(
  data: MappedPixel[][],
  dims: { N: number; M: number },
  base: HTMLCanvasElement,
  request: GoldenSweepRequest,
  now: number
): Preview | null {
  if (dims.N <= 0 || dims.M <= 0 || !base.width || !base.height) return null;

  const columns: Array<number[] | undefined> = new Array(dims.N);
  const target = request.color.toUpperCase();
  let first = dims.N;
  let last = -1;

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

  const mask = document.createElement('canvas');
  mask.width = base.width;
  mask.height = base.height;
  const ctx = mask.getContext('2d');
  if (!ctx) return null;

  const cellW = base.width / dims.N;
  const cellH = base.height / dims.M;

  if (request.mode === 'isolate') {
    // Cover every non-target bead with the neutral preview background.
    // Clearing target bead rectangles reveals their true colors and positions
    // from the original canvas beneath this completely separate layer.
    const dark = document.documentElement.classList.contains('dark');
    ctx.fillStyle = dark ? '#374151' : '#F3F4F6';
    ctx.fillRect(0, 0, mask.width, mask.height);

    // Keep a discreet grid on empty cells for spatial orientation.
    if (cellW >= 3 && cellH >= 3) {
      ctx.strokeStyle = dark ? 'rgba(210, 215, 225, 0.13)' : 'rgba(136, 120, 132, 0.14)';
      ctx.lineWidth = Math.max(0.5, Math.min(1, Math.min(cellW, cellH) * 0.08));
      ctx.beginPath();
      for (let x = 1; x < dims.N; x++) {
        const at = x * cellW;
        ctx.moveTo(at, 0);
        ctx.lineTo(at, mask.height);
      }
      for (let y = 1; y < dims.M; y++) {
        const at = y * cellH;
        ctx.moveTo(0, at);
        ctx.lineTo(mask.width, at);
      }
      ctx.stroke();
    }

    for (let x = first; x <= last; x++) {
      const rows = columns[x];
      if (!rows) continue;
      for (const y of rows) {
        ctx.clearRect(x * cellW, y * cellH, cellW, cellH);
      }
    }
  } else {
    // Cache a gentle full-image champagne-gold tint for the *selected beads*.
    // Reveal it progressively during the sweep, then hold it for two seconds.
    const cellSize = Math.min(cellW, cellH);
    for (let x = first; x <= last; x++) {
      const rows = columns[x];
      if (!rows) continue;
      for (const y of rows) {
        const px = x * cellW;
        const py = y * cellH;
        ctx.fillStyle = 'rgba(235, 170, 52, 0.36)';
        ctx.fillRect(px, py, cellW, cellH);
        ctx.fillStyle = 'rgba(255, 241, 170, 0.25)';
        ctx.fillRect(px + cellW * 0.13, py + cellH * 0.12, cellW * 0.74, cellH * 0.66);
        if (cellSize >= 2.2) {
          ctx.strokeStyle = 'rgba(255, 232, 136, 0.55)';
          ctx.lineWidth = Math.max(0.6, Math.min(1.4, cellSize * 0.08));
          ctx.strokeRect(px + 0.5, py + 0.5,
            Math.max(0, cellW - 1), Math.max(0, cellH - 1));
        }
      }
    }
  }

  const span = last - first + 1;
  return {
    request, mask, columns, first, last,
    start: first - 1.7,
    end: last + 2.7,
    radius: Math.max(2.25, Math.min(3.3, span * 0.1)),
    sweepDuration: Math.min(850, 455 + 360 * span / Math.max(1, dims.N)),
    started: now,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };
}

function sweepHead(preview: Preview, elapsed: number): number {
  const t = Math.max(0, Math.min(1,
    (elapsed - START_DELAY_MS) / preview.sweepDuration));
  const eased = t * t * (3 - 2 * t);
  return preview.start + (preview.end - preview.start) * eased;
}

function drawMovingShimmer(
  ctx: CanvasRenderingContext2D,
  preview: Preview,
  head: number,
  cellW: number,
  cellH: number
) {
  const left = Math.max(0, Math.floor(head - preview.radius));
  const right = Math.min(preview.columns.length - 1, Math.ceil(head + preview.radius));
  const size = Math.min(cellW, cellH);
  for (let x = left; x <= right; x++) {
    const rows = preview.columns[x];
    if (!rows) continue;
    const normalized = Math.abs(x + 0.5 - head) / preview.radius;
    if (normalized >= 1) continue;
    const signal = 1 - normalized;
    const strength = signal * signal * (3 - 2 * signal);
    ctx.fillStyle = 'rgba(255, 241, 164, ' + (0.6 * strength).toFixed(3) + ')';
    ctx.strokeStyle = 'rgba(255, 250, 201, ' + (0.9 * strength).toFixed(3) + ')';
    ctx.lineWidth = Math.max(0.6, Math.min(1.6, size * 0.09));
    for (const y of rows) {
      const px = x * cellW;
      const py = y * cellH;
      ctx.fillRect(px, py, cellW, cellH);
      if (size >= 2.2) {
        ctx.strokeRect(px + 0.5, py + 0.5,
          Math.max(0, cellW - 1), Math.max(0, cellH - 1));
      }
    }
  }
}

function paintPreview(
  ctx: CanvasRenderingContext2D,
  preview: Preview,
  now: number,
  dims: { N: number; M: number }
): boolean {
  const elapsed = now - preview.started;
  const cellW = ctx.canvas.width / dims.N;
  const cellH = ctx.canvas.height / dims.M;

  if (preview.request.mode === 'isolate') {
    // At exactly 3s the hidden colors begin to return smoothly.
    const fadeElapsed = elapsed - ISOLATE_HOLD_MS;
    if (fadeElapsed >= NATURAL_FADE_MS) return false;
    const opacity = fadeElapsed <= 0 ? 1 : Math.max(0, 1 - fadeElapsed / NATURAL_FADE_MS);
    ctx.globalAlpha = preview.reducedMotion ? (fadeElapsed <= 0 ? 1 : 0) : opacity;
    ctx.drawImage(preview.mask, 0, 0);
    ctx.globalAlpha = 1;
    return true;
  }

  const sweepEnd = preview.reducedMotion ? 0 : START_DELAY_MS + preview.sweepDuration;
  const fadeStart = sweepEnd + GOLD_HOLD_MS;
  if (elapsed >= fadeStart + NATURAL_FADE_MS) return false;

  if (elapsed < sweepEnd) {
    if (elapsed >= START_DELAY_MS) {
      const head = sweepHead(preview, elapsed);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.max(0, head * cellW), ctx.canvas.height);
      ctx.clip();
      ctx.drawImage(preview.mask, 0, 0);
      ctx.restore();
      drawMovingShimmer(ctx, preview, head, cellW, cellH);
    }
  } else {
    // The entire selected color remains illuminated for two full seconds
    // after the sweep has *finished*, not two seconds after the click.
    const fadeElapsed = elapsed - fadeStart;
    ctx.globalAlpha = fadeElapsed <= 0 ? 1
      : preview.reducedMotion ? 0
      : Math.max(0, 1 - fadeElapsed / NATURAL_FADE_MS);
    ctx.drawImage(preview.mask, 0, 0);
    ctx.globalAlpha = 1;
  }
  return true;
}

export default function GoldenSweepOverlay({
  sourceCanvasRef, mappedPixelData, gridDimensions, request, onComplete
}: GoldenSweepOverlayProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef({ mappedPixelData, gridDimensions });
  dataRef.current = { mappedPixelData, gridDimensions };
  const completionRef = useRef(onComplete);
  completionRef.current = onComplete;

  const runningRef = useRef<{
    active: Preview | null;
    fading: Interrupted | null;
    frame: number | null;
  }>({ active: null, fading: null, frame: null });

  const frameRef = useRef<(time: number) => void>(() => {});
  frameRef.current = (time: number) => {
    const state = runningRef.current;
    state.frame = null;
    const canvas = overlayRef.current;
    const base = sourceCanvasRef.current;
    const dims = dataRef.current.gridDimensions;
    if (!canvas || !base || !dims || !dataRef.current.mappedPixelData) return;

    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width;
      canvas.height = base.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Freeze the previous visual frame and fade it in 160ms. This also
    // handles isolate -> gold and gold -> isolate, not just A -> B colors.
    if (state.fading) {
      const fade = 1 - (time - state.fading.started) / INTERRUPT_FADE_MS;
      if (fade > 0) {
        ctx.globalAlpha = fade;
        ctx.drawImage(state.fading.snapshot, 0, 0);
        ctx.globalAlpha = 1;
      } else {
        state.fading = null;
      }
    }

    if (state.active) {
      const preview = state.active;
      if (!paintPreview(ctx, preview, time, dims)) {
        state.active = null;
        completionRef.current?.(preview.request.id);
      }
    }
    if (state.active || state.fading) {
      state.frame = requestAnimationFrame(t => frameRef.current(t));
    }
  };

  // Grid edits/imports invalidate all cached masks; no old light may be
  // painted over new bead coordinates or after a deleted color.
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
    const canvas = overlayRef.current;
    const base = sourceCanvasRef.current;

    // Capture the current composite scene instead of just its moving head:
    // a completed gold sweep now holds EVERY bead, and an eye preview can
    // completely mask the non-target colors.
    if ((state.active || state.fading) && canvas && canvas.width && canvas.height) {
      const snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
      state.fading = { snapshot, started: now };
    } else {
      state.fading = null;
    }
    state.active = null;

    if (request && base && dataRef.current.mappedPixelData && dataRef.current.gridDimensions) {
      state.active = createPreview(dataRef.current.mappedPixelData, dataRef.current.gridDimensions,
        base, request, now);
      if (!state.active) completionRef.current?.(request.id);
    }
    if ((state.active || state.fading) && state.frame === null) {
      state.frame = requestAnimationFrame(t => frameRef.current(t));
    }
  }, [request, sourceCanvasRef]);

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
