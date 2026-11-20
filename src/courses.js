import { t, message, LocalizedError } from './i18n.js';

export const COURSE_NAMES = ['Easy', 'Normal', 'Hard', 'Oni', 'Edit'];
export const COURSE_LABELS = { Easy: '简单', Normal: '普通', Hard: '困难', Oni: '魔王', Edit: '里魔王' };
export const courseLabel = course => COURSE_LABELS[course] ? t(COURSE_LABELS[course]) : course;
export const variantLabel = variant => variant.player === 'single' ? t('单人') : variant.player === 'shared' ? t('多人 - 共用') : t('多人 - {p0}', { p0: variant.player });
const courseName = value => (/^[0-4]$/.test(value) ? COURSE_NAMES[Number(value)] : COURSE_NAMES.find(name => name.toLowerCase() === value.toLowerCase())) ?? value;
const copiedFields = /^(?:LEVEL|BALLOON(?:NOR|EXP|MAS)?|SCOREMODE|SCOREINIT|SCOREDIFF|TOTAL|GAUGEINCR|HIDDENBRANCH|EXAM[123])$/;

export function courseLevelLimit(course) {
  return [5, 7, 8, 10, 10][COURSE_NAMES.indexOf(courseName(String(course)))] ?? 10;
}

function validateLevel(course, level) {
  const maximum = courseLevelLimit(course);
  if (!Number.isSafeInteger(level) || level < 1 || level > maximum) throw new LocalizedError(message('该难度星级须为 1–{p0} 的整数。', { p0: maximum }));
}

export function chartVariants(text) {
  const blocks = [...text.matchAll(/^#START([^\r\n]*)\r?\n([\s\S]*?)^#END\b[^\r\n]*/gmi)];
  let course = 'Oni', style = 'Single', sectionStart = null, headerStart = 0, previousEnd = 0, fields = new Map();
  return blocks.map((block, index) => {
    const localHeaderStart = previousEnd;
    for (const match of text.slice(previousEnd, block.index).matchAll(/^([A-Z][A-Z0-9]*):([^\r\n]*)/gmi)) {
      const name = match[1].toUpperCase(), value = match[2].split('//')[0].trim();
      if (name === 'COURSE') {
        course = courseName(value); style = 'Single'; fields = new Map();
        if (!course) throw new LocalizedError(message('难度、星级或谱面模式无效。'));
        sectionStart = previousEnd + match.index;
        headerStart = index ? sectionStart : 0;
      } else if (name === 'STYLE') {
        if (!/^(?:Single|1|Double|Couple|2)$/i.test(value)) throw new LocalizedError(message('STYLE 须为 Single 或 Double。'));
        style = /^(?:Double|Couple|2)$/i.test(value) ? 'Double' : 'Single';
      }
      if (copiedFields.test(name)) fields.set(name, match[0]);
    }
    const argument = block[1].split('//')[0].trim().toUpperCase();
    if (argument && !/^P[12]$/.test(argument)) throw new LocalizedError(message('#START 仅接受 P1 或 P2。'));
    if (sectionStart === null) sectionStart = block.index;
    previousEnd = block.index + block[0].length;
    return { index, course, key: course.toLowerCase(), style: argument ? 'Double' : style, player: argument || (style === 'Double' ? 'shared' : 'single'),
      start: block.index, end: previousEnd, bodyStart: block.index + block[0].indexOf('\n') + 1, body: block[2],
      sectionStart, headerStart, localHeaderStart, fields: Object.fromEntries(fields),
      prefixCommands: text.slice(localHeaderStart, block.index).match(/^#(?:BMSCROLL|HBSCROLL)\b[^\r\n]*/gmi) || [] };
  });
}

export function courseHeaderRange(text, courseIndex, local = false) {
  const variant = chartVariants(text)[courseIndex];
  if (!variant) throw new LocalizedError(message('难度不存在。'));
  return { start: local ? variant.localHeaderStart : variant.headerStart, end: variant.start };
}

function courseHeaderField(text, courseIndex, fieldName) {
  const range = courseHeaderRange(text, courseIndex);
  return [...text.slice(range.start, range.end).matchAll(new RegExp(`^${fieldName}:([^\\r\\n]*)`, 'gmi'))].at(-1);
}

export function courseHeaderValues(text, courseIndex, fieldName) {
  const field = courseHeaderField(text, courseIndex, fieldName);
  const value = field?.[1].split('//')[0].trim();
  return value ? value.split(',').map(value => Number(value.trim())) : [];
}

export function setCourseHeaderValues(text, courseIndex, values, fieldName) {
  const range = courseHeaderRange(text, courseIndex, true);
  const variants = chartVariants(text), current = variants[courseIndex], next = variants[courseIndex + 1];
  if (next?.sectionStart === current.sectionStart && !new RegExp(`^${fieldName}:`, 'mi').test(text.slice(next.localHeaderStart, next.start))) {
    // Preserve the following part's original rating, including an unrated or nonstandard value.
    const previous = fieldName === 'LEVEL' ? courseHeaderField(text, courseIndex, fieldName)?.[0] ?? 'LEVEL:0' : `${fieldName}:${courseHeaderValues(text, courseIndex, fieldName).join(',')}`;
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    text = text.slice(0, next.start) + previous + newline + text.slice(next.start);
  }
  const field = [...text.slice(range.start, range.end).matchAll(new RegExp(`^${fieldName}:([^\\r\\n]*)`, 'gmi'))].at(-1);
  if (!field) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    return text.slice(0, range.end) + `${fieldName}:${values.join(',')}${newline}` + text.slice(range.end);
  }
  const start = range.start + field.index + fieldName.length + 1;
  const suffix = field[1].match(/[\t ]*(?:\/\/.*)?$/)[0];
  return text.slice(0, start) + values.join(',') + suffix + text.slice(start + field[1].length);
}

export function courseLevel(text, courseIndex) {
  const values = courseHeaderValues(text, courseIndex, 'LEVEL');
  return values.length ? values.length === 1 ? values[0] : NaN : 0;
}

export function setCourseLevel(text, courseIndex, level) {
  const variants = chartVariants(text), variant = variants[courseIndex];
  if (!variant) throw new LocalizedError(message('难度不存在。'));
  validateLevel(variant.course, level);
  const targets = variant.player === 'single' ? [variant] : variants.filter(item => item.key === variant.key && item.player !== 'single');
  for (const target of targets) {
    if (courseLevel(text, target.index) !== level) text = setCourseHeaderValues(text, target.index, [level], 'LEVEL');
  }
  return text;
}

function serializedVariant(variant, style, player, newline) {
  const header = Object.values(variant.fields).filter(line => !/^LEVEL:/i.test(line));
  const level = variant.fields.LEVEL || 'LEVEL:0';
  const commands = variant.prefixCommands?.length ? variant.prefixCommands.join(newline) + newline : '';
  return `COURSE:${variant.course}${newline}${level}${newline}STYLE:${style}${newline}${header.length ? header.join(newline) + newline : ''}${commands}#START${player ? ` ${player}` : ''}${newline}${variant.body.replace(/\r?\n/g, newline).trimEnd()}${newline}#END${newline}`;
}

export function addCourse(text, { course, level, style = 'Single', player }) {
  const variants = chartVariants(text);
  if (!COURSE_NAMES.includes(course) && !variants.some(variant => variant.course === course) || !['Single', 'Double'].includes(style) || player !== undefined && !(style === 'Single' ? player === 'single' : ['P1', 'P2'].includes(player))) throw new LocalizedError(message('难度、星级或谱面模式无效。'));
  validateLevel(course, level);
  const siblings = variants.filter(variant => variant.key === course.toLowerCase());
  if (player === undefined && siblings.length) throw new LocalizedError(message('该难度已存在，请切换难度或添加双人分谱。'));
  const players = style === 'Single' ? ['single'] : player ? [player] : ['P1', 'P2'];
  if (siblings.some(variant => players.includes(variant.player))) throw new LocalizedError(message('该模式的分谱已齐全。'));
  const newline = text.includes('\r\n') ? '\r\n' : '\n', index = variants.length;
  const sharedLevel = style === 'Double' && siblings.find(variant => variant.player !== 'single');
  const template = { course, fields: { LEVEL: sharedLevel ? sharedLevel.fields.LEVEL || 'LEVEL:0' : `LEVEL:${level}` }, body: `,${newline}` };
  const added = players.map(player => serializedVariant(template, style, player === 'single' ? '' : player, newline)).join(newline);
  return { text: `${text}${text.endsWith('\n') ? newline : newline + newline}${added}`, course: index };
}

export function deleteCourse(text, courseIndex) {
  const variants = chartVariants(text), selected = variants[courseIndex];
  if (!selected) throw new LocalizedError(message('难度不存在。'));
  const removed = [selected];
  const remaining = variants.filter(variant => !removed.includes(variant));
  const sections = [...new Set(variants.map(variant => variant.sectionStart))].sort((a, b) => a - b);
  const ranges = sections.flatMap((start, index) => {
    const section = variants.filter(variant => variant.sectionStart === start), targets = section.filter(variant => removed.includes(variant));
    if (!targets.length) return [];
    if (targets.length === section.length) return [{ start, end: sections[index + 1] ?? text.length }];
    // Keep inherited headers for the surviving mode in a shared COURSE section.
    return targets.map(variant => ({ start: variant.start, end: variant.end }));
  });
  for (const variant of removed) {
    for (const match of text.slice(variant.localHeaderStart, variant.start).matchAll(/^#(?:BMSCROLL|HBSCROLL)\b[^\r\n]*(?:\r?\n|$)/gmi)) {
      const start = variant.localHeaderStart + match.index, end = start + match[0].length;
      if (!ranges.some(range => range.start <= start && range.end >= end)) ranges.push({ start, end });
    }
  }
  for (const { start, end } of ranges.sort((a, b) => b.start - a.start)) text = text.slice(0, start) + text.slice(end);
  return { text, course: Math.max(0, remaining.findIndex(variant => variant.key === selected.key)) };
}

export function addPlayerCharts(text, courseIndex, style, player) {
  const variants = chartVariants(text), selected = variants[courseIndex];
  if (!selected || !['Single', 'Double'].includes(style) || player !== undefined && !(style === 'Single' ? player === 'single' : ['P1', 'P2'].includes(player))) throw new LocalizedError(message('难度、星级或谱面模式无效。'));
  const newline = text.includes('\r\n') ? '\r\n' : '\n', siblings = variants.filter(variant => variant.key === selected.key);
  if (player !== undefined && siblings.some(variant => variant.player === player)) throw new LocalizedError(message('该模式的分谱已齐全。'));
  const shared = siblings.find(variant => variant.player === 'shared');
  if (style === 'Double' && shared && (selected === shared || player !== undefined)) {
    const missing = ['P1', 'P2'].filter(player => !siblings.some(variant => variant.player === player));
    if (!missing.length) throw new LocalizedError(message('该模式的分谱已齐全。'));
    const first = text.slice(shared.start, shared.end).replace(/^#START([^\r\n]*)/i, (_, suffix) => `#START ${missing[0]}${suffix.match(/[\t ]*\/\/.*$/)?.[0] || ''}`);
    const second = missing.length > 1 ? newline + newline + serializedVariant(shared, 'Double', missing[1], newline) : '';
    return { text: text.slice(0, shared.start) + first + second + text.slice(shared.end), course: shared.index + Math.max(0, missing.indexOf(player)) };
  }
  const players = style === 'Single' ? [''] : player ? [player] : ['P1', 'P2'];
  const missing = players.filter(player => !siblings.some(variant => style === 'Single' ? variant.style === 'Single' : variant.style === 'Double' && (variant.player === player || variant.player === 'shared')));
  if (!missing.length) throw new LocalizedError(message('该模式的分谱已齐全。'));
  const levelSource = style === 'Double' ? siblings.find(variant => variant.player !== 'single') || selected : selected;
  const template = { ...selected, fields: { ...selected.fields, LEVEL: courseHeaderField(text, levelSource.index, 'LEVEL')?.[0] ?? 'LEVEL:0' } };
  return { text: `${text}${text.endsWith('\n') ? newline : newline + newline}${missing.map(player => serializedVariant(template, style, player, newline)).join(newline)}`, course: variants.length };
}
