import type { MappedPixel } from './pixelation';

export interface CellPosition {
  row: number;
  col: number;
}

export interface PixelChange extends CellPosition {
  before: MappedPixel;
  after: MappedPixel;
}

// Only changed beads and optional palette metadata are retained in history.
export interface EditHistoryEntry {
  changes: PixelChange[];
  excludedBefore?: string[];
  excludedAfter?: string[];
  initialBefore?: string[];
  initialAfter?: string[];
}

export function pixelsEqual(a: MappedPixel, b: MappedPixel): boolean {
  return a.key === b.key &&
    a.color.toUpperCase() === b.color.toUpperCase() &&
    Boolean(a.isExternal) === Boolean(b.isExternal);
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && Array.from(a).every(value => b.has(value));
}

export function buildHistoryEntry(
  before: MappedPixel[][],
  after: MappedPixel[][],
  excludedBefore?: ReadonlySet<string>,
  excludedAfter?: ReadonlySet<string>,
  initialBefore?: ReadonlySet<string>,
  initialAfter?: ReadonlySet<string>
): EditHistoryEntry | null {
  if (before.length !== after.length ||
    before.some((row, index) => row.length !== after[index]?.length)) {
    // A different image or grid size starts a fresh history, not an edit.
    return null;
  }

  const entry: EditHistoryEntry = { changes: [] };
  for (let row = 0; row < before.length; row++) {
    for (let col = 0; col < before[row].length; col++) {
      const oldCell = before[row][col];
      const newCell = after[row][col];
      if (oldCell && newCell && !pixelsEqual(oldCell, newCell)) {
        entry.changes.push({
          row, col, before: { ...oldCell }, after: { ...newCell }
        });
      }
    }
  }

  if (excludedBefore && excludedAfter && !setsEqual(excludedBefore, excludedAfter)) {
    entry.excludedBefore = Array.from(excludedBefore);
    entry.excludedAfter = Array.from(excludedAfter);
  }
  if (initialBefore && initialAfter && !setsEqual(initialBefore, initialAfter)) {
    entry.initialBefore = Array.from(initialBefore);
    entry.initialAfter = Array.from(initialAfter);
  }

  return entry.changes.length || entry.excludedBefore || entry.initialBefore ? entry : null;
}

export function applyHistoryEntry(
  grid: MappedPixel[][],
  entry: EditHistoryEntry,
  direction: 'undo' | 'redo'
): MappedPixel[][] {
  if (!entry.changes.length) return grid;
  const result = grid.slice();
  const copiedRows = new Set<number>();
  for (const change of entry.changes) {
    if (!result[change.row]?.[change.col]) continue;
    if (!copiedRows.has(change.row)) {
      result[change.row] = grid[change.row].slice();
      copiedRows.add(change.row);
    }
    result[change.row][change.col] = {
      ...(direction === 'undo' ? change.before : change.after)
    };
  }
  return result;
}

/**
 * Paint a connected 2x2 square stroke, filling any cells skipped by fast
 * pointer movement. The hovered cell is the top-left anchor; at the right
 * and bottom edges the footprint shifts inward to preserve a two-cell width.
 * The caller owns the changes Map for the entire pointer-down/up gesture.
 */
export function paintBrushSegment(
  grid: MappedPixel[][],
  from: CellPosition,
  to: CellPosition,
  newColor: MappedPixel,
  changes: Map<number, PixelChange>,
  brushSize = 2
): MappedPixel[][] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  if (!height || !width || brushSize < 1) return grid;

  const result = grid.slice();
  const copiedRows = new Set<number>();
  let modified = false;

  const paintSquare = (row: number, col: number) => {
    const firstRow = Math.max(0, Math.min(row, Math.max(0, height - brushSize)));
    const firstCol = Math.max(0, Math.min(col, Math.max(0, width - brushSize)));

    for (let y = firstRow; y < Math.min(height, firstRow + brushSize); y++) {
      for (let x = firstCol; x < Math.min(width, firstCol + brushSize); x++) {
        const current = result[y]?.[x];
        if (!current) continue;
        const next: MappedPixel = { ...newColor, isExternal: false };
        if (pixelsEqual(current, next)) continue;

        if (!copiedRows.has(y)) {
          result[y] = grid[y].slice();
          copiedRows.add(y);
        }

        const index = y * width + x;
        const before = changes.get(index)?.before ?? { ...current };
        result[y][x] = next;
        if (pixelsEqual(before, next)) {
          changes.delete(index);
        } else {
          changes.set(index, { row: y, col: x, before, after: { ...next } });
        }
        modified = true;
      }
    }
  };

  // Bresenham visits each intermediate grid cell, including diagonals.
  let x = from.col;
  let y = from.row;
  const dx = Math.abs(to.col - x);
  const dy = Math.abs(to.row - y);
  const stepX = x < to.col ? 1 : -1;
  const stepY = y < to.row ? 1 : -1;
  let error = dx - dy;
  while (true) {
    paintSquare(y, x);
    if (x === to.col && y === to.row) break;
    const doubled = 2 * error;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
  }

  return modified ? result : grid;
}
