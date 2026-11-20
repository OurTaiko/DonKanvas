import { replaceBar, replaceBarSource, parseChart } from './chart.js';

function headerRange(text, courseIndex) {
  const blocks = [...text.matchAll(/^#START[^\r\n]*\r?\n[\s\S]*?^#END/gmi)];
  const block = blocks[courseIndex];
  if (!block) throw new Error('难度不存在。');
  return { start: courseIndex ? blocks[courseIndex - 1].index + blocks[courseIndex - 1][0].length : 0, end: block.index };
}

export function balloonCounts(text, courseIndex) {
  const range = headerRange(text, courseIndex);
  const field = [...text.slice(range.start, range.end).matchAll(/^BALLOON:([^\r\n]*)/gmi)].at(-1);
  const value = field?.[1].split('//')[0].trim();
  return value ? value.split(',').map(value => Number(value.trim())) : [];
}

function writeCounts(text, courseIndex, counts) {
  const range = headerRange(text, courseIndex);
  const field = [...text.slice(range.start, range.end).matchAll(/^BALLOON:([^\r\n]*)/gmi)].at(-1);
  if (!field) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    return text.slice(0, range.end) + `BALLOON:${counts.join(',')}${newline}` + text.slice(range.end);
  }
  const start = range.start + field.index + 'BALLOON:'.length;
  const suffix = field[1].match(/[\t ]*(?:\/\/.*)?$/)[0];
  return text.slice(0, start) + counts.join(',') + suffix + text.slice(start + field[1].length);
}

export function balloonIndex(chart, cell) {
  let ordinal = 0;
  for (const bar of chart.bars) for (let index = 0; index < bar.notes.length; index++) {
    if (!'79'.includes(bar.notes[index])) continue;
    if (bar.index === cell.bar && index * cell.denominator === cell.numerator * bar.notes.length) return ordinal;
    ordinal++;
  }
  return -1;
}

export function setBalloonCount(text, chart, cell, count) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('气球敲击次数须为正整数。');
  const ordinal = balloonIndex(chart, cell);
  if (ordinal < 0) throw new Error('请先选中气球音符。');
  const counts = balloonCounts(text, chart.courseIndex);
  while (counts.length <= ordinal) counts.push(5);
  counts[ordinal] = count;
  return writeCounts(text, chart.courseIndex, counts);
}

export function replaceBarWithBalloons(text, chart, bar, notes) {
  notes = notes.replace(/\s/g, '').replace(/,$/, '');
  return reconcileCounts(replaceBar(text, bar, notes), chart, bar, notes);
}

export function replaceBarSourceWithBalloons(text, chart, bar, source, parser) {
  const edited = replaceBarSource(text, chart, bar, source, parser);
  const notes = parseChart(edited, parser, chart.courseIndex).bars[bar.index].notes;
  return reconcileCounts(edited, chart, bar, notes);
}

function reconcileCounts(edited, chart, bar, notes) {
  const oldPositions = [], newPositions = [];
  for (let index = 0; index < bar.notes.length; index++) if ('79'.includes(bar.notes[index])) oldPositions.push(index / bar.notes.length);
  for (let index = 0; index < notes.length; index++) if ('79'.includes(notes[index])) newPositions.push(index / notes.length);
  if (JSON.stringify(oldPositions) === JSON.stringify(newPositions)) return edited;
  const counts = balloonCounts(edited, chart.courseIndex);
  const preceding = chart.bars.slice(0, bar.index).reduce((total, item) => total + [...item.notes].filter(note => '79'.includes(note)).length, 0);
  while (counts.length < preceding + oldPositions.length) counts.push(5);
  const replacements = newPositions.map(position => {
    const oldIndex = oldPositions.indexOf(position);
    return oldIndex < 0 ? 5 : counts[preceding + oldIndex];
  });
  counts.splice(preceding, oldPositions.length, ...replacements);
  return writeCounts(edited, chart.courseIndex, counts);
}