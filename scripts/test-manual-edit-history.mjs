import assert from 'node:assert/strict';
import {
  applyHistoryEntry, buildHistoryEntry, paintBrushSegment
} from '../src/utils/manualEditHistory.ts';

const makeGrid = (rows, cols) => Array.from(
  { length: rows }, () => Array.from(
    { length: cols }, () => ({ key: 'A', color: '#AAAAAA', isExternal: false })
  )
);
const pink = { key: 'P', color: '#FF6699' };
const original = makeGrid(5, 7);
const changes = new Map();
let painted = paintBrushSegment(original, { row: 1, col: 1 }, { row: 1, col: 1 }, pink, changes);
assert.equal(changes.size, 4, 'first stroke footprint is exactly 2 by 2');
assert.equal(original[1][1].key, 'A', 'painting does not mutate original grid');

painted = paintBrushSegment(painted, { row: 1, col: 1 }, { row: 3, col: 5 }, pink, changes);
assert.equal(painted[3][5].key, 'P', 'stroke reaches destination');
assert.ok(changes.size > 4, 'fast move paints intermediate cells');
assert.equal(painted[2][3].key, 'P', 'diagonal movement leaves no gaps');
assert.equal(new Set(changes.keys()).size, changes.size, 'overlapping stamps count a bead once');

const stroke = { changes: [...changes.values()] };
const restored = applyHistoryEntry(painted, stroke, 'undo');
assert.deepEqual(restored, original, 'a whole drag is undone in one operation');
assert.deepEqual(applyHistoryEntry(restored, stroke, 'redo'), painted, 'one redo restores drag');

const edgeGrid = makeGrid(3, 3);
const edgeChanges = new Map();
const edgePainted = paintBrushSegment(edgeGrid, { row: 2, col: 2 }, { row: 2, col: 2 }, pink, edgeChanges);
assert.equal(edgeChanges.size, 4, 'bottom-right footprint stays 2x2 within bounds');
assert.equal(edgePainted[1][1].key, 'P');
assert.equal(edgePainted[0][0].key, 'A');

const metadataEdit = buildHistoryEntry(original, original, new Set(), new Set(['#AAAAAA']));
assert.ok(metadataEdit, 'palette exclusion remains undoable even without changed pixels');
assert.equal(buildHistoryEntry(original, original), null, 'no-op is not added to history');
const replacement = buildHistoryEntry(original, painted);
assert.equal(replacement.changes.length, changes.size);
assert.deepEqual(applyHistoryEntry(painted, replacement, 'undo'), original);
console.log('PASS: 2x2 continuous brush, interpolation, immutable history, undo/redo and exclusions');
