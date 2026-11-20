import { message, LocalizedError } from './i18n.js';
import { chartVariants } from './courses.js';
export const EDITABLE_COMMANDS = ['BPMCHANGE', 'MEASURE', 'DELAY', 'SCROLL', 'GOGOSTART', 'GOGOEND', 'BARLINEON', 'BARLINEOFF'];
export const PRESERVED_COMMANDS = ['LYRIC', 'SECTION', 'LEVELHOLD', 'SENOTECHANGE'];
export const BRANCH_ROUTES = ['N', 'E', 'M'];
export const BRANCH_ROUTE_NAMES = { N: '普通', E: '玄人', M: '达人' };

export function decodeChart(bytes) {
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }; }
  catch { return { text: new TextDecoder('shift-jis').decode(bytes), encoding: 'Shift-JIS' }; }
}

export function parseChart(text, parser, courseIndex = 0, branchRoutes = []) {
  if (!Array.isArray(branchRoutes) || branchRoutes.some(route => route !== null && !BRANCH_ROUTES.includes(route))) throw new LocalizedError(message('分歧路线选择无效。'));
  const field = name => text.match(new RegExp(`^${name}:(.*)$`, 'mi'))?.[1].trim();
  const blocks = [...text.matchAll(/^#START[^\r\n]*\r?\n([\s\S]*?)^#END/gmi)];
  let bpm = Number(field('BPM'));
  const offset = Number(field('OFFSET') || 0);
  if (!(bpm > 0) || !Number.isFinite(bpm) || !Number.isFinite(offset)) throw new LocalizedError(message('BPM 或 OFFSET 无效。'));
  if (!blocks.length) {
    if (text.split(/\r?\n/).some(line => line.trim() && !/^\s*(?:\/\/|[A-Z][A-Z0-9]*:)/i.test(line))) throw new LocalizedError(message('没有找到 #START / #END。'));
    if (courseIndex !== 0 || branchRoutes.length) throw new LocalizedError(message('难度不存在。'));
    return { title: field('TITLE') || 'Untitled', wave: field('WAVE'), offset, baseBpm: bpm, courses: [], variants: [], variant: null, courseIndex: 0, bars: [], allBars: [], branches: [], branchRoutes: [], unsimulatedCommands: [] };
  }
  parser.parse(text);
  const variants = chartVariants(text), courses = variants.map(variant => variant.course);
  const block = blocks[courseIndex];
  if (!block) throw new LocalizedError(message('难度不存在。'));
  const headerStart = courseIndex ? blocks[courseIndex - 1].index + blocks[courseIndex - 1][0].length : 0;
  const bodyStart = block.index + block[0].indexOf('\n') + 1;
  const baseBpm = bpm;
  let numerator = 4, denominator = 4, time = -offset, gogo = false, scroll = 1, barline = true, delay = 0;
  let digits = [], ranges = [], bars = [], commands = [], sharedCommands = [], events = [], initialVisual = null, branch = null;
  const allBars = [], branches = [];
  const unsimulatedCommands = new Set();
  for (const match of text.slice(headerStart, block.index).matchAll(/^#(BMSCROLL|HBSCROLL)\b/gmi)) unsimulatedCommands.add(match[1].toUpperCase());
  const capture = () => ({ bpm, numerator, denominator, time, gogo, scroll, barline, delay, commands, sharedCommands, bars, warnings: [...unsimulatedCommands] });
  const restore = saved => {
    ({ bpm, numerator, denominator, time, gogo, scroll, barline, delay, commands, sharedCommands, bars } = saved);
    unsimulatedCommands.clear();
    for (const name of saved.warnings) unsimulatedCommands.add(name);
  };
  const fence = command => { sharedCommands = [...sharedCommands, ...commands, ...(command ? [command] : [])]; commands = []; };
  const finishPath = () => {
    if (digits.length) throw new LocalizedError(message('分歧边界必须位于完整小节之间。'));
    if (branch.current) branch.paths[branch.current] = capture();
  };
  const finishBranch = (end, marker) => {
    finishPath();
    if (!branch.current) { fence(); branch.entry = capture(); }
    const current = branch, routes = BRANCH_ROUTES.filter(route => current.paths[route]);
    const requested = branchRoutes[current.index];
    const route = requested ?? (routes.includes('N') ? 'N' : routes[0] ?? null);
    if (route !== null && !routes.includes(route)) throw new LocalizedError(message('第 {p0} 处分歧没有路线 {p1}。', { p0: current.index + 1, p1: route }));
    const selected = route === null ? current.entry : current.paths[route];
    restore(selected);
    bars = route === null ? [...current.entry.bars] : [...current.entry.bars, ...selected.bars];
    Object.assign(current, { end, route, routes, firstBarIndex: current.entry.bars.length, barCount: route === null ? 0 : selected.bars.length });
    branch = null;
    fence(marker);
  };
  const body = block[1];
  for (const match of body.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0].split('//')[0];
    const command = line.trim().match(/^#(\w+)\s*(.*?)\s*$/);
    if (command) {
      const [, nameRaw, value] = command;
      const name = nameRaw.toUpperCase();
      const start = bodyStart + match.index + line.indexOf('#');
      const instruction = { name, start, end: start + line.trim().length, value, timing: { bpm, numerator, denominator, gogo, scroll, barline } };
      if (name === 'BRANCHSTART') {
        if (digits.length) throw new LocalizedError(message('分歧边界必须位于完整小节之间。'));
        const values = value.split(',').map(part => part.trim());
        if (values.length !== 3 || !/^[prs]$/i.test(values[0]) || values.slice(1).some(part => !part || !Number.isFinite(Number(part)))) throw new LocalizedError(message('分歧条件须为 p、r 或 s 及两个有限数值。'));
        if (branch) finishBranch(start);
        fence(instruction);
        branch = { index: branches.length, start, value, paths: {}, current: null, entry: capture() };
        branches.push(branch);
        continue;
      }
      if (BRANCH_ROUTES.includes(name)) {
        if (!branch || value || branch.paths[name] || branch.current === name) throw new LocalizedError(message('分歧路线标记缺失、重复或位置无效。'));
        finishPath();
        if (!branch.current) { fence(); branch.entry = capture(); }
        restore(branch.entry); bars = []; commands = []; sharedCommands = [...sharedCommands, instruction]; branch.current = name;
        continue;
      }
      if (name === 'BRANCHEND') {
        if (!branch || value) throw new LocalizedError(message('分歧结束标记位置无效。'));
        finishBranch(start + line.trim().length, instruction);
        continue;
      }
      if (EDITABLE_COMMANDS.includes(name) || PRESERVED_COMMANDS.includes(name)) {
        const command = instruction;
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
    for (const token of line.matchAll(/[0-9AB]+|,|[^\s0-9AB,]+/gi)) {
      const position = bodyStart + match.index + token.index;
      if (branch && !branch.current) throw new LocalizedError(message('分歧内容必须放在 #N、#E 或 #M 之后。'));
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
        const boundaryCommands = [...sharedCommands.map(command => ({ ...command, shared: true })), ...commands].map(command => {
          const event = { ...command, slot: 0, fraction: 0, time: boundaryTime };
          if (event.name === 'DELAY') { boundaryTime += Number(event.value); event.endTime = boundaryTime; }
          return event;
        });
        const bar = { index: bars.length, branchIndex: branch?.index ?? null, route: branch?.current ?? null, branchStart: Boolean(branch && !bars.length), notes, ranges, comma: position, start: time, end: cursor, duration, ...initial, delay, commands: boundaryCommands.filter(command => !command.shared), events: resolvedEvents, instructions: [...boundaryCommands, ...resolvedEvents], segments, finalState: { ...timing } };
        bars.push(bar); allBars.push(bar);
        time = cursor; digits = []; ranges = []; commands = []; sharedCommands = []; events = []; initialVisual = null; delay = 0;
      } else if (/^[0-9AB]+$/i.test(token[0])) { if (!initialVisual) initialVisual = { bpm, numerator, denominator, gogo, scroll, barline }; digits.push(token[0].toUpperCase()); ranges.push({ start: position, end: position + token[0].length }); }
      else throw new LocalizedError(message('无法识别的谱面内容：{p0}', { p0: token[0] }));
    }
  }
  if (branch) finishBranch(bodyStart + body.length);
  if (branchRoutes.length > branches.length) throw new LocalizedError(message('分歧路线选择无效。'));
  if (digits.length) throw new LocalizedError(message('最后一个小节缺少逗号。'));
  if (!bars.length) throw new LocalizedError(message('没有可编辑的小节。'));
  bars.forEach((bar, index) => { bar.index = index; });
  return { title: field('TITLE') || 'Untitled', wave: field('WAVE'), offset, baseBpm, courses, variants, variant: variants[courseIndex], courseIndex, bars, allBars, branches: branches.map(({ index, start, end, value, route, routes, firstBarIndex, barCount }) => ({ index, start, end, value, route, routes, firstBarIndex, barCount })), branchRoutes: branches.map(branch => branch.route), unsimulatedCommands: [...unsimulatedCommands] };
}

export function setBaseBpm(text, bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new LocalizedError(message('BPM 须为正数。'));
  return text.replace(/^(BPM:)[^\r\n]*/mi, (line, prefix) => `${prefix}${bpm}${line.match(/[\t ]*\/\/.*$/)?.[0] || ''}`);
}

export function insertEmptyBar(text, bar, side) {
  if (!bar) throw new LocalizedError(message('请先创建难度谱面。'));
  if (!['before', 'after'].includes(side)) throw new LocalizedError(message('插入位置无效。'));
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  let position = bar.ranges[0]?.start ?? bar.comma;
  if (side === 'after') {
    position = bar.comma + 1;
    const lineEnd = text.indexOf('\n', position);
    const tail = text.slice(position, lineEnd < 0 ? text.length : lineEnd);
    if (/^[\t \r]*(?:\/\/[^\n]*)?$/.test(tail) && lineEnd >= 0) position = lineEnd + 1;
  }
  const prefix = text.slice(0, position);
  return prefix + (prefix.endsWith('\n') ? '' : newline) + '0000000000000000,' + newline + text.slice(position);
}

export function deleteBar(text, chart, bar) {
  if (!bar) throw new LocalizedError(message('请先创建难度谱面。'));
  if (chart.bars.length <= 1) throw new LocalizedError(message('不能删除最后一个小节。'));
  const start = bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma;
  return text.slice(0, start) + text.slice(bar.comma + 1);
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
    replacements.set('DELAY', settings.delay === null ? '' : `#DELAY ${settings.delay}`);
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
  for (const [key, name] of [['lyric', 'LYRIC'], ['section', 'SECTION'], ['levelhold', 'LEVELHOLD'], ['senote', 'SENOTECHANGE']]) {
    if (!(key in settings)) continue;
    const value = settings[key];
    if (key === 'lyric' && value !== null && (typeof value !== 'string' || /[\r\n]/.test(value) || value.includes('//'))) throw new LocalizedError(message('歌词须为单行文本，不能包含实际换行或 //。'));
    if (['section', 'levelhold'].includes(key) && value !== null && value !== true) throw new LocalizedError(message('SECTION / LEVELHOLD 状态无效。'));
    if (key === 'senote' && value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 12)) throw new LocalizedError(message('SENOTECHANGE 须为 1–12 的整数。'));
    replacements.set(name, value === null ? '' : `#${name}${['lyric', 'senote'].includes(key) ? ` ${value}` : ''}`);
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
    bar = parseChart(text, parser, chart.courseIndex, chart.branchRoutes).bars[cell.bar];
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

export function branchSource(text, branch) {
  const source = text.slice(branch.start, branch.end).trimEnd();
  return /^[\t ]*#BRANCHEND\b/mi.test(source) ? source : `${source}${text.includes('\r\n') ? '\r\n' : '\n'}#BRANCHEND`;
}

export function setBranchSource(text, chart, cell, source, index, parser) {
  const content = source.split(/\r?\n/).map(line => line.split('//')[0].trim()).filter(Boolean);
  if (!/^#BRANCHSTART\b/i.test(content[0] || '') || !/^#BRANCHEND$/i.test(content.at(-1) || '') ||
      content.filter(line => /^#BRANCHSTART\b/i.test(line)).length !== 1 || content.filter(line => /^#BRANCHEND\b/i.test(line)).length !== 1 ||
      content.some(line => /^#(?:START|END)\b/i.test(line))) throw new LocalizedError(message('分歧源码须只包含一段完整的 #BRANCHSTART … #BRANCHEND 结构。'));
  let start, end, target;
  const routes = [...chart.branchRoutes];
  if (index !== null) {
    const branch = chart.branches[index];
    if (!Number.isSafeInteger(index) || !branch) throw new LocalizedError(message('分歧路线选择无效。'));
    ({ start, end } = branch); target = index;
  } else {
    const bar = chart.bars[cell?.bar];
    if (!bar || !Number.isSafeInteger(cell.numerator) || !Number.isSafeInteger(cell.denominator) || cell.denominator < 1 ||
        ![0, 1].includes(cell.numerator / cell.denominator) || bar.branchIndex !== null) throw new LocalizedError(message('请在共用小节的起点或末端插入分歧，不能嵌套分歧。'));
    start = end = cell.numerator === 0 ? bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma : bar.comma + 1;
    target = chart.branches.filter(branch => branch.start < start).length;
    routes.splice(target, 0, null);
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const prefix = text.slice(text.lastIndexOf('\n', start - 1) + 1, start).trim() ? newline : '';
  const suffix = /^(?:\r?\n|[\t ]*\/\/)/.test(text.slice(end)) ? '' : newline;
  const replacement = `${prefix}${source.replace(/\r?\n/g, newline).trimEnd()}${suffix}`;
  const edited = text.slice(0, start) + replacement + text.slice(end);
  const parsed = parseChart(edited, parser, chart.courseIndex);
  if (parsed.branches.length !== routes.length) throw new LocalizedError(message('分歧源码须只包含一段完整的 #BRANCHSTART … #BRANCHEND 结构。'));
  if (parsed.allBars.some(bar => bar.comma >= start && bar.comma < start + replacement.length && bar.notes.length > 65536)) throw new LocalizedError(message('单小节最多支持 65536 个源码格。'));
  if (!parsed.branches[target].routes.includes(routes[target])) routes[target] = parsed.branchRoutes[target];
  return { text: edited, branchRoutes: routes, start, end, insertedEnd: start + replacement.length, index: target };
}

export function barSource(text, bar) {
  const start = bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma;
  return text.slice(start, bar.comma + 1);
}

export function replaceBarSource(text, chart, bar, source, parser) {
  const content = source.split(/\r?\n/).map(line => line.split('//')[0]).join('\n');
  if (/^\s*#(?:BRANCHSTART|BRANCHEND|N|E|M)\b/mi.test(content)) throw new LocalizedError(message('小节源码不能修改分歧结构。'));
  const notes = content.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
  if ((notes.match(/,/g) || []).length !== 1 || !content.trimEnd().endsWith(',') || /^\s*#(?:START|END)\b/mi.test(content)) throw new LocalizedError(message('小节源码须只包含一个以逗号结束的小节。'));
  const start = bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const edited = text.slice(0, start) + source.replace(/\r?\n/g, newline).trimEnd() + text.slice(bar.comma + 1);
  const parsed = parseChart(edited, parser, chart.courseIndex, chart.branchRoutes);
  if (parsed.bars.length !== chart.bars.length || parsed.courses.length !== chart.courses.length) throw new LocalizedError(message('小节源码不能增删小节或难度。'));
  if (parsed.bars[bar.index].notes.length > 65536) throw new LocalizedError(message('单小节最多支持 65536 个源码格。'));
  return edited;
}

export function replaceBar(text, bar, notes) {
  notes = notes.replace(/\s/g, '').replace(/,$/, '');
  if (!/^[0-9AB]+$/.test(notes)) throw new LocalizedError(message('音符只能使用 0–9、A、B，可在末尾带一个逗号。'));
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

export function barStateAtTime(bar, time) {
  const segment = bar.segments.findLast(segment => time >= segment.start && time < segment.end);
  const delay = bar.instructions.findLast(event => event.name === 'DELAY' && time >= event.time && time < event.endTime);
  if (delay && (!segment || delay.fraction > segment.from)) return { ...delay.timing, delay: Number(delay.value) };
  if (segment) return { ...segment, delay: 0 };
  if (time < bar.start) return { ...(bar.instructions[0]?.timing ?? bar), delay: 0 };
  return { ...bar.finalState, delay: 0 };
}