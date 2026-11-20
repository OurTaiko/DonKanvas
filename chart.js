import { message, LocalizedError } from './i18n.js';
export const EDITABLE_COMMANDS = ['BPMCHANGE', 'MEASURE', 'DELAY', 'SCROLL', 'GOGOSTART', 'GOGOEND', 'BARLINEON', 'BARLINEOFF'];
export const PRESERVED_COMMANDS = ['LYRIC', 'SECTION', 'LEVELHOLD', 'SENOTECHANGE'];

export function decodeChart(bytes) {
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }; }
  catch { return { text: new TextDecoder('shift-jis').decode(bytes), encoding: 'Shift-JIS' }; }
}

export function parseChart(text, parser, courseIndex = 0) {
  parser.parse(text);
  const field = name => text.match(new RegExp(`^${name}:(.*)$`, 'mi'))?.[1].trim();
  const blocks = [...text.matchAll(/^#START[^\r\n]*\r?\n([\s\S]*?)^#END/gmi)];
  if (!blocks.length) throw new LocalizedError(message('没有找到 #START / #END。'));
  const courses = blocks.map((block, index) => {
    const header = text.slice(index ? blocks[index - 1].index + blocks[index - 1][0].length : 0, block.index);
    return [...header.matchAll(/^COURSE:(.*)$/gmi)].at(-1)?.[1].trim() || `Course ${index + 1}`;
  });
  const block = blocks[courseIndex];
  if (!block) throw new LocalizedError(message('难度不存在。'));
  if (/^#START[\t ]+\S/m.test(block[0]) || /^STYLE:[\t ]*(Double|2)[\t ]*\r?$/mi.test(text)) throw new LocalizedError(message('暂不支持双人谱面。'));
  const bodyStart = block.index + block[0].indexOf('\n') + 1;
  let bpm = Number(field('BPM'));
  const offset = Number(field('OFFSET') || 0);
  if (!(bpm > 0) || !Number.isFinite(bpm) || !Number.isFinite(offset)) throw new LocalizedError(message('BPM 或 OFFSET 无效。'));
  const baseBpm = bpm;
  let numerator = 4, denominator = 4, time = -offset, gogo = false, scroll = 1, barline = true, delay = 0;
  let digits = [], ranges = [], bars = [], commands = [], events = [], initialVisual = null;
  const unsimulatedCommands = new Set();
  const headerStart = courseIndex ? blocks[courseIndex - 1].index + blocks[courseIndex - 1][0].length : 0;
  for (const match of text.slice(headerStart, block.index).matchAll(/^#(BMSCROLL|HBSCROLL)\b/gmi)) unsimulatedCommands.add(match[1].toUpperCase());
  const body = block[1];
  for (const match of body.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0].split('//')[0];
    const command = line.trim().match(/^#(\w+)\s*(.*?)\s*$/);
    if (command) {
      const [, nameRaw, value] = command;
      const name = nameRaw.toUpperCase();
      if (EDITABLE_COMMANDS.includes(name) || PRESERVED_COMMANDS.includes(name)) {
        const start = bodyStart + match.index + line.indexOf('#');
        const command = { name, start, end: start + line.trim().length, value };
        if (digits.length) events.push({ ...command, slot: digits.join('').length, value });
        else commands.push(command);
      }
      if (name === 'BPMCHANGE') { bpm = Number(value); if (!(bpm > 0) || !Number.isFinite(bpm)) throw new LocalizedError(message('变速 BPM 无效。')); }
      else if (name === 'MEASURE') {
        [numerator, denominator] = value.split('/').map(Number);
        if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0) throw new LocalizedError(message('拍号须为正整数 / 正整数。'));
      }
      else if (name === 'DELAY') { const seconds = Number(value); if (!value || !Number.isFinite(seconds)) throw new LocalizedError(message('DELAY 须为有限秒数。')); if (!digits.length) { time += seconds; delay += seconds; } }
      else if (name === 'SCROLL') { scroll = Number(value); if (!value || !Number.isFinite(scroll)) throw new LocalizedError(message('卷轴速度须为有限数值。')); }
      else if (name === 'GOGOSTART') gogo = true;
      else if (name === 'GOGOEND') gogo = false;
      else if (name === 'BARLINEON') barline = true;
      else if (name === 'BARLINEOFF') barline = false;
      else if (PRESERVED_COMMANDS.includes(name)) unsimulatedCommands.add(name);
      else throw new LocalizedError(message('暂不支持 #{p0}，已停止加载以避免错误对齐。', { p0: name }));
      continue;
    }
    for (const token of line.matchAll(/[0-9]+|,|[^\s0-9,]+/g)) {
      const position = bodyStart + match.index + token.index;
      if (token[0] === ',') {
        const notes = digits.join('') || '0';
        const initial = initialVisual || { bpm, numerator, denominator, gogo, scroll, barline };
        const timing = { ...initial }, segments = [];
        let cursor = time, fraction = 0, duration = 0;
        const resolvedEvents = events.map(event => ({ ...event, fraction: event.slot / notes.length }));
        const advance = target => {
          if (target > fraction) {
            duration += (target - fraction) * 240 / timing.bpm * timing.numerator / timing.denominator;
            const end = time + duration;
            segments.push({ from: fraction, to: target, start: cursor, end, ...timing });
            cursor = end; fraction = target;
          }
        };
        for (const event of resolvedEvents) {
          advance(event.fraction); event.time = cursor;
          if (event.name === 'BPMCHANGE') timing.bpm = Number(event.value);
          else if (event.name === 'MEASURE') [timing.numerator, timing.denominator] = event.value.split('/').map(Number);
          else if (event.name === 'SCROLL') timing.scroll = Number(event.value);
          else if (event.name === 'GOGOSTART') timing.gogo = true;
          else if (event.name === 'GOGOEND') timing.gogo = false;
          else if (event.name === 'BARLINEON') timing.barline = true;
          else if (event.name === 'BARLINEOFF') timing.barline = false;
          else if (event.name === 'DELAY') { duration += Number(event.value); cursor = time + duration; event.endTime = cursor; }
        }
        advance(1);
        let boundaryTime = time - delay;
        const boundaryCommands = commands.map(command => {
          const event = { ...command, slot: 0, fraction: 0, time: boundaryTime };
          if (event.name === 'DELAY') { boundaryTime += Number(event.value); event.endTime = boundaryTime; }
          return event;
        });
        bars.push({ index: bars.length, notes, ranges, comma: position, start: time, end: cursor, duration, ...initial, delay, commands: boundaryCommands, events: resolvedEvents, instructions: [...boundaryCommands, ...resolvedEvents], segments, finalState: { ...timing } });
        time = cursor; digits = []; ranges = []; commands = []; events = []; initialVisual = null; delay = 0;
      } else if (/^[0-9]+$/.test(token[0])) { if (!initialVisual) initialVisual = { bpm, numerator, denominator, gogo, scroll, barline }; digits.push(token[0]); ranges.push({ start: position, end: position + token[0].length }); }
      else throw new LocalizedError(message('无法识别的谱面内容：{p0}', { p0: token[0] }));
    }
  }
  if (digits.length) throw new LocalizedError(message('最后一个小节缺少逗号。'));
  if (!bars.length) throw new LocalizedError(message('没有可编辑的小节。'));
  return { title: field('TITLE') || 'Untitled', wave: field('WAVE'), offset, baseBpm, courses, courseIndex, bars, unsimulatedCommands: [...unsimulatedCommands] };
}

export function setBaseBpm(text, bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new LocalizedError(message('BPM 须为正数。'));
  return text.replace(/^(BPM:)[^\r\n]*/mi, (line, prefix) => `${prefix}${bpm}${line.match(/[\t ]*\/\/.*$/)?.[0] || ''}`);
}

export function setBarSettings(text, bar, settings, slot = 0) {
  const state = barStateAt(bar, slot / bar.notes.length);
  const replacements = new Map();
  if ('bpm' in settings) {
    if (settings.bpm !== null && (!Number.isFinite(settings.bpm) || settings.bpm <= 0)) throw new LocalizedError(message('BPM 须为正数。'));
    replacements.set('BPMCHANGE', settings.bpm === null ? '' : `#BPMCHANGE ${settings.bpm}`);
  }
  if ('numerator' in settings || 'denominator' in settings) {
    const numerator = settings.numerator ?? state.numerator, denominator = settings.denominator ?? state.denominator;
    if (![numerator, denominator].every(value => Number.isSafeInteger(value) && value > 0)) throw new LocalizedError(message('拍号须为正整数 / 正整数。'));
    replacements.set('MEASURE', settings.numerator === null || settings.denominator === null ? '' : `#MEASURE ${numerator}/${denominator}`);
  }
  if ('scroll' in settings) {
    if (settings.scroll !== null && !Number.isFinite(settings.scroll)) throw new LocalizedError(message('卷轴速度须为有限数值。'));
    replacements.set('SCROLL', settings.scroll === null ? '' : `#SCROLL ${settings.scroll}`);
  }
  if ('delay' in settings) {
    if (settings.delay !== null && !Number.isFinite(settings.delay)) throw new LocalizedError(message('延迟须为有限秒数。'));
    replacements.set('DELAY', settings.delay ? `#DELAY ${settings.delay}` : '');
  }
  if ('gogo' in settings) {
    if (settings.gogo !== null && typeof settings.gogo !== 'boolean') throw new LocalizedError(message('Go-Go 状态无效。'));
    replacements.set('GOGOSTART', settings.gogo === null ? '' : settings.gogo ? '#GOGOSTART' : '#GOGOEND');
    replacements.set('GOGOEND', '');
  }
  if ('barline' in settings) {
    if (settings.barline !== null && typeof settings.barline !== 'boolean') throw new LocalizedError(message('小节线状态无效。'));
    replacements.set('BARLINEON', settings.barline === null ? '' : settings.barline ? '#BARLINEON' : '#BARLINEOFF');
    replacements.set('BARLINEOFF', '');
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = [...replacements.values()].filter(Boolean);
  if (!replacements.size) return text;
  let position = bar.comma, consumed = 0;
  for (const range of bar.ranges) {
    if (slot < consumed + range.end - range.start) { position = range.start + slot - consumed; break; }
    consumed += range.end - range.start;
  }
  const prefix = position > 0 && text[position - 1] !== '\n' ? newline : '';
  text = text.slice(0, position) + (lines.length ? prefix + lines.join(newline) + newline : '') + text.slice(position);
  const commands = slot === 0 ? bar.commands : bar.events.filter(event => event.slot === slot);
  for (const command of [...commands].reverse()) {
    if (replacements.has(command.name)) text = text.slice(0, command.start) + text.slice(command.end);
  }
  return text;
}

export function setPositionSettings(text, chart, cell, settings, parser) {
  const { numerator, denominator } = cell;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 1 || numerator > denominator) throw new LocalizedError(message('指令位置无效。'));
  let bar = chart.bars[cell.bar];
  if (!bar) throw new LocalizedError(message('小节不存在。'));
  if (Object.values(settings).every(value => value === null) && !Number.isInteger(numerator * bar.notes.length / denominator)) return text;
  let divisor = numerator, remainder = denominator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const reduced = denominator / divisor;
  divisor = bar.notes.length; remainder = reduced;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const length = bar.notes.length / divisor * reduced;
  if (length > 65536) throw new LocalizedError(message('指令位置超出 65536 个源码格，无法无损插入。'));
  if (length !== bar.notes.length) {
    text = replaceBar(text, bar, resizeNotes(bar.notes, length));
    bar = parseChart(text, parser, chart.courseIndex).bars[cell.bar];
  }
  return setBarSettings(text, bar, settings, numerator * length / denominator);
}

export function clearPositionSettings(text, bar, cell) {
  const commands = cell.numerator === 0 ? bar.commands : bar.events.filter(event => event.slot * cell.denominator === cell.numerator * bar.notes.length);
  for (const command of [...commands].reverse()) {
    if (EDITABLE_COMMANDS.includes(command.name)) text = text.slice(0, command.start) + text.slice(command.end);
  }
  return text;
}

export function barSource(text, bar) {
  const start = bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma;
  return text.slice(start, bar.comma + 1);
}

export function replaceBarSource(text, chart, bar, source, parser) {
  const content = source.split(/\r?\n/).map(line => line.split('//')[0]).join('\n');
  const notes = content.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
  if ((notes.match(/,/g) || []).length !== 1 || !content.trimEnd().endsWith(',') || /^\s*#(?:START|END)\b/mi.test(content)) throw new LocalizedError(message('小节源码须只包含一个以逗号结束的小节。'));
  const start = bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const edited = text.slice(0, start) + source.replace(/\r?\n/g, newline).trimEnd() + text.slice(bar.comma + 1);
  const parsed = parseChart(edited, parser, chart.courseIndex);
  if (parsed.bars.length !== chart.bars.length || parsed.courses.length !== chart.courses.length) throw new LocalizedError(message('小节源码不能增删小节或难度。'));
  if (parsed.bars[bar.index].notes.length > 65536) throw new LocalizedError(message('单小节最多支持 65536 个源码格。'));
  return edited;
}

export function replaceBar(text, bar, notes) {
  notes = notes.replace(/\s/g, '').replace(/,$/, '');
  if (!/^[0-9]+$/.test(notes)) throw new LocalizedError(message('音符只能使用 0–9，可在末尾带一个逗号。'));
  if (notes.length > 65536) throw new LocalizedError(message('单小节最多支持 65536 个源码格。'));
  if (!bar.ranges.length) return text.slice(0, bar.comma) + notes + text.slice(bar.comma);
  const events = bar.events || [];
  if (events.some(event => !Number.isInteger(event.slot * notes.length / bar.notes.length))) throw new LocalizedError(message('该细分无法保留小节内指令位置。'));
  const replacements = new Map();
  for (const range of bar.ranges) {
    const preceding = events.findLast(event => event.start < range.start);
    const following = events.find(event => event.start > range.start);
    const start = preceding ? preceding.slot * notes.length / bar.notes.length : 0;
    const end = following ? following.slot * notes.length / bar.notes.length : notes.length;
    if (![...replacements.values()].some(item => item.start === start)) replacements.set(range.start, { start, text: notes.slice(start, end) });
  }
  for (let index = bar.ranges.length - 1; index >= 0; index--) {
    const range = bar.ranges[index];
    text = text.slice(0, range.start) + (replacements.get(range.start)?.text || '') + text.slice(range.end);
  }
  return text;
}

export function resizeNotes(notes, length) {
  const result = Array(length).fill('0');
  for (let index = 0; index < notes.length; index++) {
    if (notes[index] === '0') continue;
    const target = index * length / notes.length;
    if (!Number.isInteger(target)) throw new LocalizedError(message('该细分无法保留现有音符位置，请选择更高细分。'));
    result[target] = notes[index];
  }
  return result.join('');
}

export function clearBarSettings(text, bar) {
  for (const command of [...bar.commands].reverse()) {
    if (EDITABLE_COMMANDS.includes(command.name)) text = text.slice(0, command.start) + text.slice(command.end);
  }
  return text;
}

export function barTimeAt(bar, fraction) {
  if (!bar.segments) return bar.start + fraction * bar.duration;
  if (fraction >= 1) return bar.end;
  const segment = bar.segments.findLast(segment => segment.from <= fraction);
  return segment.start + (fraction - segment.from) / (segment.to - segment.from) * (segment.end - segment.start);
}

export function barFractionAt(bar, time) {
  if (!bar.segments) return Math.max(0, Math.min(1, (time - bar.start) / bar.duration));
  const segment = bar.segments.findLast(segment => time >= segment.start && time < segment.end);
  if (segment) return segment.from + (time - segment.start) / (segment.end - segment.start) * (segment.to - segment.from);
  const next = bar.segments.reduce((next, segment) => segment.start > time && (!next || segment.start < next.start) ? segment : next, null);
  return next ? next.from : 1;
}

export function barStateAt(bar, fraction) {
  if (fraction >= 1) return { ...bar.finalState };
  const segment = bar.segments?.findLast(segment => segment.from <= fraction);
  return segment || bar;
}