import { message, LocalizedError } from './i18n.js';
import { MAX_SOURCE_SLOTS } from './grid.js';
import { resizeNotes, barTimeAt } from './chart.js';

export const NOTE_TYPES = [
  { value: '0', name: '空拍', shape: 'empty' },
  { value: '1', name: '咚', shape: 'don' },
  { value: '2', name: '咔', shape: 'ka' },
  { value: '3', name: '大咚', shape: 'don large' },
  { value: '4', name: '大咔', shape: 'ka large' },
  { value: '5', name: '连打', shape: 'roll' },
  { value: '6', name: '大连打', shape: 'roll large' },
  { value: '7', name: '气球连打', shape: 'balloon' },
  { value: '8', name: '长音结束', shape: 'end' },
  { value: '9', name: '特殊连打', shape: 'balloon special' },
  { value: 'A', name: '双人咚', shape: 'don large duet', shortcut: '-' },
  { value: 'B', name: '双人咔', shape: 'ka large duet', shortcut: '=' }
];

export function selectCell(notes, fraction, divisions, tolerance = 0) {
  let closest = -1, distance = Infinity;
  for (let index = 0; index < notes.length; index++) {
    const difference = Math.abs(index / notes.length - fraction);
    if (notes[index] !== '0' && difference <= tolerance && difference < distance) { closest = index; distance = difference; }
  }
  if (closest >= 0) return { numerator: closest, denominator: notes.length };
  return { numerator: Math.max(0, Math.min(divisions - 1, Math.round(fraction * divisions))), denominator: divisions };
}

export function cellValue(notes, cell) {
  const index = cell.numerator * notes.length / cell.denominator;
  return Number.isInteger(index) ? notes[index] : '0';
}

export function setCellNote(notes, cell, note) {
  if (!/^[0-9AB]$/.test(note)) throw new LocalizedError(message('音符只能为 0–9、A、B。'));
  if (cellValue(notes, cell) === note) return notes;
  let divisor = cell.numerator, remainder = cell.denominator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const denominator = cell.denominator / divisor;
  divisor = notes.length; remainder = denominator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const length = notes.length / divisor * denominator;
  if (length > MAX_SOURCE_SLOTS) throw new LocalizedError(message('混合细分超出 65536 个源码格，无法无损修改。'));
  const result = [...resizeNotes(notes, length)];
  result[cell.numerator * length / cell.denominator] = note;
  return result.join('');
}

export function longNoteSpans(bars) {
  const spans = [];
  let active = null;
  for (const bar of bars) for (let index = 0; index < bar.notes.length; index++) {
    const note = bar.notes[index], time = barTimeAt(bar, index / bar.notes.length);
    if ('5679'.includes(note)) {
      if (active) { active.end = time; spans.push(active); }
      active = { note, start: time, end: bars.at(-1).end, complete: false };
    } else if (note === '8' && active) {
      active.end = time; active.complete = true; spans.push(active); active = null;
    }
  }
  if (active) spans.push(active);
  return spans;
}