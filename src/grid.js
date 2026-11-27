import { message, LocalizedError } from './i18n.js';
import { resizeNotes } from './chart.js';

export const GRID_DIVISIONS = 16;
export const SNAP_DIVISIONS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128];
export const MAX_SNAP_DIVISIONS = 768;
export const MAX_SOURCE_SLOTS = 65536;

export function editGridNote(notes, fraction, note, tolerance = 0, divisions = GRID_DIVISIONS) {
  if (!Number.isInteger(divisions) || divisions < 1 || divisions > MAX_SNAP_DIVISIONS) throw new LocalizedError(message('吸附栅格须为 1–768 之间的整数。'));
  if (!Number.isFinite(fraction) || !/^[0-9AB]$/.test(note)) throw new LocalizedError(message('无效的音符或落点。'));
  let closest = -1, distance = Infinity;
  for (let index = 0; index < notes.length; index++) {
    const difference = Math.abs(index / notes.length - fraction);
    if (notes[index] !== '0' && difference <= tolerance && difference < distance) { closest = index; distance = difference; }
  }
  if (closest >= 0) { const result = [...notes]; result[closest] = note; return result.join(''); }
  const slot = Math.max(0, Math.min(divisions - 1, Math.round(fraction * divisions)));
  if (note === '0') {
    const index = slot * notes.length / divisions;
    if (!Number.isInteger(index)) return notes;
    const result = [...notes]; result[index] = '0'; return result.join('');
  }
  const targetDivisor = (first, second) => {
    while (second) [first, second] = [second, first % second];
    return first;
  };
  const targetDenominator = divisions / targetDivisor(slot, divisions);
  if (!/[1-9AB]/.test(notes)) {
    const result = Array(divisions).fill('0'); result[slot] = note; return result.join('');
  }
  let divisor = notes.length, remainder = targetDenominator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const length = notes.length / divisor * targetDenominator;
  if (length > MAX_SOURCE_SLOTS) throw new LocalizedError(message('混合细分需要超过 65536 格，无法无损添加；请简化当前小节后重试。'));
  const result = [...resizeNotes(notes, length)];
  result[slot * length / divisions] = note;
  return result.join('');
}