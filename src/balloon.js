import { message, LocalizedError } from './i18n.js';
import { replaceBar, replaceBarSource, parseChart, synchronizeBranchTiming, setBranchSource, deleteBar, barSource, correspondingBars, EDITABLE_COMMANDS, PRESERVED_COMMANDS } from './chart.js';
import { courseHeaderRange as headerRange, courseHeaderValues, setCourseHeaderValues } from './courses.js';
import { setMeasureBranch } from './branch-commands.js';

export function balloonCounts(text, courseIndex, fieldName = 'BALLOON') {
  return courseHeaderValues(text, courseIndex, fieldName);
}

function writeCounts(text, courseIndex, counts, fieldName = 'BALLOON') {
  return setCourseHeaderValues(text, courseIndex, counts, fieldName);
}

function replaceCounts(counts, preceding, before, after) {
  while (counts.length < preceding + before.length) counts.push(5);
  const replacements = after.map(position => {
    const oldIndex = before.indexOf(position);
    return oldIndex < 0 ? 5 : counts[preceding + oldIndex];
  });
  counts.splice(preceding, before.length, ...replacements);
}

export function balloonIndex(chart, cell) {
  let ordinal = 0;
  const selected = chart.bars[cell.bar];
  for (const bar of chart.allBars || chart.bars) for (let index = 0; index < bar.notes.length; index++) {
    if (!'79'.includes(bar.notes[index])) continue;
    if (bar.comma === selected?.comma && index * cell.denominator === cell.numerator * bar.notes.length) return ordinal;
    ordinal++;
  }
  return -1;
}

function countFields(text, chart) {
  const range = headerRange(text, chart.courseIndex);
  return new Set([...text.slice(range.start, range.end).matchAll(/^BALLOON(?:NOR|EXP|MAS)?:/gmi)].map(match => match[0].slice(0, -1).toUpperCase()));
}

function countField(fields, bar) {
  const field = { N: 'BALLOONNOR', E: 'BALLOONEXP', M: 'BALLOONMAS' }[bar.route];
  return fields.has(field) ? field : 'BALLOON';
}

function* countedBalloons(text, chart, fields) {
  const pools = new Map();
  for (const bar of chart.allBars || chart.bars) {
    const field = countField(fields, bar);
    for (let index = 0; index < bar.notes.length; index++) {
      if (!'79'.includes(bar.notes[index])) continue;
      if (!pools.has(field)) pools.set(field, { counts: balloonCounts(text, chart.courseIndex, field), ordinal: 0 });
      const pool = pools.get(field), ordinal = pool.ordinal++;
      yield { bar, index, ordinal, field, count: pool.counts[ordinal] };
    }
  }
}

export function balloonNoteCounts(text, chart) {
  const counts = new Map();
  if (!chart?.bars.length) return counts;
  for (const { bar, index, count } of countedBalloons(text, chart, countFields(text, chart))) {
    counts.set(`${bar.comma}:${index}`, count);
  }
  return counts;
}

export function balloonInfo(text, chart, cell) {
  const selected = chart.bars[cell.bar];
  if (!selected) return { ordinal: -1 };
  const fields = countFields(text, chart), field = countField(fields, selected);
  for (const item of countedBalloons(text, chart, fields)) {
    if (item.bar.comma === selected.comma && item.index * cell.denominator === cell.numerator * item.bar.notes.length) {
      return { ordinal: item.ordinal, field: item.field, count: item.count };
    }
  }
  return { ordinal: -1, field };
}

export function balloonTotals(text, chart) {
  const totals = { balloon: 0, special: 0 };
  if (!chart?.bars.length) return totals;
  const active = new Set(chart.bars.map(bar => bar.comma));
  for (const { bar, index, count } of countedBalloons(text, chart, countFields(text, chart))) {
    if (!active.has(bar.comma)) continue;
    const key = bar.notes[index] === '7' ? 'balloon' : 'special';
    const total = totals[key] === null ? null : totals[key] + count;
    totals[key] = Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(total) ? total : null;
  }
  return totals;
}

export function setBalloonCount(text, chart, cell, count) {
  if (!Number.isSafeInteger(count) || count < 1) throw new LocalizedError(message('气球敲击次数须为正整数。'));
  const { ordinal, field } = balloonInfo(text, chart, cell);
  if (ordinal < 0) throw new LocalizedError(message('请先选中气球音符。'));
  const counts = balloonCounts(text, chart.courseIndex, field);
  while (counts.length <= ordinal) counts.push(5);
  counts[ordinal] = count;
  return writeCounts(text, chart.courseIndex, counts, field);
}

export function replaceBarWithBalloons(text, chart, bar, notes) {
  notes = notes.replace(/\s/g, '').replace(/,$/, '');
  return reconcileCounts(replaceBar(text, bar, notes), chart, bar, notes);
}

export function deleteBarWithBalloons(text, chart, bar) {
  let edited = deleteBar(text, chart, bar);
  for (const item of correspondingBars(chart, bar).sort((a, b) => b.comma - a.comma)) edited = reconcileCounts(edited, chart, item, '');
  return edited;
}

export function replaceBarSourceWithBalloons(text, chart, bar, source, parser) {
  const edited = replaceBarSource(text, chart, bar, source, parser);
  const notes = parseChart(edited, parser, chart.courseIndex, chart.branchRoutes).bars[bar.index].notes;
  return reconcileCounts(edited, chart, bar, notes);
}

export function copyMeasures(text, chart, first, last) {
  if (!chart || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= chart.bars.length) throw new LocalizedError(message('小节区间无效。'));
  const counts = new Map();
  for (const item of countedBalloons(text, chart, countFields(text, chart))) {
    if (!counts.has(item.bar.comma)) counts.set(item.bar.comma, []);
    counts.get(item.bar.comma).push({ index: item.index, count: item.count });
  }
  return chart.bars.slice(first, last + 1).map(bar => ({
    source: [...bar.instructions.filter(item => item.shared && [...EDITABLE_COMMANDS, ...PRESERVED_COMMANDS].includes(item.name)).map(item => text.slice(item.start, item.end)), barSource(text, bar)].join('\n'),
    balloons: counts.get(bar.comma) ?? []
  }));
}

export function pasteMeasures(text, chart, index, clipboard, mode, parser) {
  if (!chart?.bars[index]) throw new LocalizedError(message('小节不存在。'));
  if (!clipboard?.length) throw new LocalizedError(message('请先复制小节。'));
  if (!['overwrite', 'insert'].includes(mode)) throw new LocalizedError(message('粘贴方式无效。'));
  const target = chart.bars[index], targets = chart.bars.slice(index, index + clipboard.length);
  const startOf = bar => bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma;
  const structural = /^\s*#(?:BRANCHSTART|BRANCHEND|N|E|M)\b/mi;
  if (mode === 'overwrite' && structural.test(text.slice(startOf(target), targets.at(-1).comma + 1).split(/\r?\n/).map(line => line.split('//')[0]).join('\n'))) {
    throw new LocalizedError(message('粘贴覆盖会跨越分歧边界，无法粘贴。请缩短复制区间或改用插入。'));
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const pieces = clipboard.map(piece => ({ ...piece, source: piece.source.replace(/\r?\n/g, newline).trimEnd() }));
  if (pieces.some(piece => structural.test(piece.source))) throw new LocalizedError(message('小节源码不能修改分歧结构。'));
  const edits = [];
  if (mode === 'insert') edits.push({ start: startOf(target), end: startOf(target), pieces, prefix: '' });
  else {
    targets.forEach((bar, offset) => edits.push({ start: startOf(bar), end: bar.comma + 1, pieces: [pieces[offset]], prefix: '' }));
    if (pieces.length > targets.length) {
      const end = targets.at(-1).comma + 1;
      edits.push({ start: end, end, pieces: pieces.slice(targets.length), prefix: newline });
    }
  }
  const added = mode === 'insert' ? pieces.length : Math.max(0, pieces.length - targets.length);
  if (added && target.branchIndex !== null) {
    const anchor = mode === 'insert' ? target : targets.at(-1);
    for (const bar of correspondingBars(chart, anchor).filter(bar => bar !== anchor)) {
      const at = mode === 'insert' ? startOf(bar) : bar.comma + 1;
      edits.push({ start: at, end: at, pieces: Array.from({ length: added }, () => ({ source: ',', balloons: [] })), prefix: mode === 'insert' ? '' : newline });
    }
  }
  edits.sort((first, second) => first.start - second.start);
  for (const edit of edits) edit.content = edit.prefix + edit.pieces.map(piece => piece.source).join(newline) + (/^\r?\n/.test(text.slice(edit.end)) ? '' : newline);
  const fields = countFields(text, chart), mapped = new Map();
  for (const item of countedBalloons(text, chart, fields)) {
    if (edits.some(edit => item.bar.comma >= edit.start && item.bar.comma < edit.end)) continue;
    const shift = edits.filter(edit => edit.end <= item.bar.comma).reduce((sum, edit) => sum + edit.content.length - (edit.end - edit.start), 0);
    mapped.set(`${item.bar.comma + shift}:${item.index}`, item.count);
  }
  let shift = 0;
  for (const edit of edits) {
    let cursor = edit.start + shift + edit.prefix.length;
    for (const piece of edit.pieces) {
      for (const balloon of piece.balloons) mapped.set(`${cursor + piece.source.length - 1}:${balloon.index}`, balloon.count);
      cursor += piece.source.length + newline.length;
    }
    shift += edit.content.length - (edit.end - edit.start);
  }
  let edited = text;
  for (const edit of [...edits].reverse()) edited = edited.slice(0, edit.start) + edit.content + edited.slice(edit.end);
  const parsed = parseChart(edited, parser, chart.courseIndex, chart.branchRoutes, { allowUnequalBranches: true });
  return synchronizeBranchTiming(writeMappedCounts(text, chart, edited, parsed, mapped, fields), parser, chart.courseIndex, chart.branchRoutes);
}

export function setMeasureBranchWithBalloons(text, chart, bar, operation, parser) {
  const result = setMeasureBranch(text, chart, bar, operation, parser);
  const parsed = parseChart(result.text, parser, chart.courseIndex, result.branchRoutes), fields = countFields(text, chart);
  const countsByPosition = new Map();
  for (const item of countedBalloons(text, chart, fields)) {
    for (const range of result.retained.filter(range => item.bar.comma >= range.before && item.bar.comma < range.before + range.length)) {
      countsByPosition.set(`${range.after + item.bar.comma - range.before}:${item.index}`, item.count);
    }
  }
  result.text = writeMappedCounts(text, chart, result.text, parsed, countsByPosition, fields);
  return result;
}

function writeMappedCounts(text, chart, edited, parsed, countsByPosition, fields) {
  const used = new Map(), next = new Map();
  for (const item of countedBalloons(text, chart, fields)) used.set(item.field, (used.get(item.field) ?? 0) + 1);
  for (const item of countedBalloons(edited, parsed, fields)) {
    const key = `${item.bar.comma}:${item.index}`;
    if (!countsByPosition.has(key)) throw new LocalizedError(message('小节编辑无法保留气球次数。'));
    if (!next.has(item.field)) next.set(item.field, []);
    next.get(item.field).push(countsByPosition.get(key));
  }
  for (const field of new Set(['BALLOON', ...fields])) {
    const before = balloonCounts(text, chart.courseIndex, field);
    const after = [...(next.get(field) ?? []), ...before.slice(used.get(field) ?? 0)];
    while (after.length && after.at(-1) === undefined) after.pop();
    // Keep missing counts invalid when moving them before a route's existing counts.
    const counts = after.map(value => value === undefined ? 0 : value);
    if (JSON.stringify(before) !== JSON.stringify(counts)) edited = writeCounts(edited, chart.courseIndex, counts, field);
  }
  return edited;
}

export function setBranchSourceWithBalloons(text, chart, cell, source, index, parser) {
  const result = setBranchSource(text, chart, cell, source, index, parser);
  const parsed = parseChart(result.text, parser, chart.courseIndex, result.branchRoutes), fields = countFields(text, chart);
  const positions = (bars, start, end, field) => {
    const measures = new Map(), keys = [];
    for (const bar of bars) {
      if (bar.comma < start || bar.comma >= end) continue;
      const measure = measures.get(bar.route) || 0; measures.set(bar.route, measure + 1);
      if (countField(fields, bar) !== field) continue;
      for (let slot = 0; slot < bar.notes.length; slot++) if ('79'.includes(bar.notes[slot])) keys.push(`${bar.route}:${measure}:${slot / bar.notes.length}`);
    }
    return keys;
  };
  for (const field of new Set(['BALLOON', ...fields])) {
    const before = positions(chart.allBars, result.start, result.end, field), after = positions(parsed.allBars, result.start, result.insertedEnd, field);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const preceding = chart.allBars.filter(bar => bar.comma < result.start && countField(fields, bar) === field).reduce((sum, bar) => sum + [...bar.notes].filter(note => '79'.includes(note)).length, 0);
    const counts = balloonCounts(result.text, chart.courseIndex, field);
    replaceCounts(counts, preceding, before, after);
    result.text = writeCounts(result.text, chart.courseIndex, counts, field);
  }
  return result;
}

function reconcileCounts(edited, chart, bar, notes) {
  const oldPositions = [], newPositions = [];
  for (let index = 0; index < bar.notes.length; index++) if ('79'.includes(bar.notes[index])) oldPositions.push(index / bar.notes.length);
  for (let index = 0; index < notes.length; index++) if ('79'.includes(notes[index])) newPositions.push(index / notes.length);
  if (JSON.stringify(oldPositions) === JSON.stringify(newPositions)) return edited;
  const fields = countFields(edited, chart), field = countField(fields, bar), counts = balloonCounts(edited, chart.courseIndex, field);
  const preceding = (chart.allBars || chart.bars).filter(item => item.comma < bar.comma && countField(fields, item) === field).reduce((total, item) => total + [...item.notes].filter(note => '79'.includes(note)).length, 0);
  replaceCounts(counts, preceding, oldPositions, newPositions);
  return writeCounts(edited, chart.courseIndex, counts, field);
}