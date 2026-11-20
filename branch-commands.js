import { message, LocalizedError } from './i18n.js';
import { BRANCH_ROUTES, parseChart } from './chart.js';

export function measureBranch(chart, bar) {
  return chart?.branches.find(branch => branch.index === bar?.branchIndex) ?? null;
}

function routeSections(text, branch) {
  const markers = [...text.slice(branch.start, branch.end).matchAll(/^[\t ]*#(N|E|M|BRANCHEND)\b[^\r\n]*(?:\r?\n|$)/gmi)];
  return markers.map((match, index) => ({
    route: match[1].toUpperCase(),
    start: branch.start + match.index,
    bodyStart: branch.start + match.index + match[0].length,
    end: branch.start + (markers[index + 1]?.index ?? branch.end - branch.start)
  }));
}

export function setMeasureBranch(text, chart, bar, operation, parser) {
  if (!bar || chart.bars[bar.index] !== bar) throw new LocalizedError(message('请先创建难度谱面。'));
  const branch = measureBranch(chart, bar), routes = [...chart.branchRoutes];
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const boundary = bar.commands[0]?.start ?? bar.ranges[0]?.start ?? bar.comma;
  const index = branch?.index ?? chart.branches.filter(item => item.start < boundary).length;
  function replace(start, end, chunks, selected = bar.index, preserveSelection = false) {
    let replacement = '';
    const retained = [{ before: 0, after: 0, length: start }];
    for (const chunk of chunks) {
      if (typeof chunk === 'string') replacement += chunk;
      else {
        retained.push({ before: chunk[0], after: start + replacement.length, length: chunk[1] - chunk[0] });
        replacement += text.slice(...chunk);
      }
    }
    retained.push({ before: end, after: start + replacement.length, length: text.length - end });
    const edited = text.slice(0, start) + replacement + text.slice(end);
    parseChart(edited, parser, chart.courseIndex, routes);
    return { text: edited, branchRoutes: routes, index, selected, preserveSelection, retained };
  }
  if (operation.type === 'condition') {
    const { condition, lower, upper } = operation;
    if (!['p', 'r', 's'].includes(condition) || !Number.isFinite(lower) || !Number.isFinite(upper)) throw new LocalizedError(message('分歧条件须为 p、r 或 s 及两个有限数值。'));
    const command = `#BRANCHSTART ${condition},${lower},${upper}`;
    if (branch) {
      const length = text.slice(branch.start).match(/^[^\r\n]*/)[0].split('//')[0].trimEnd().length;
      return replace(branch.start, branch.start + length, [command], bar.index, true);
    }
    routes.splice(index, 0, 'N');
    const prefix = text.slice(text.lastIndexOf('\n', boundary - 1) + 1, boundary).trim() ? newline : '';
    return replace(boundary, boundary, [`${prefix}${command}${newline}#N${newline}`]);
  }
  if (!branch) throw new LocalizedError(message('请先在前面的小节插入分歧开始。'));
  const sections = routeSections(text, branch);
  function disable() {
    const selected = sections.find(item => item.route === branch.route);
    const headerEnd = branch.start + text.slice(branch.start).match(/^[^\r\n]*/)[0].length;
    routes.splice(index, 1);
    return replace(branch.start, branch.end, [[headerEnd, sections[0].start], [selected.bodyStart, selected.end]]);
  }
  if (operation.type === 'disable') return disable();
  if (operation.type === 'route') {
    if (!BRANCH_ROUTES.includes(operation.route)) throw new LocalizedError(message('分歧路线选择无效。'));
    const section = sections.find(item => item.route === operation.route);
    if (section) {
      if (branch.routes.length === 1) return disable();
      const selectedRouteRemoved = branch.route === operation.route;
      if (selectedRouteRemoved) routes[index] = BRANCH_ROUTES.find(route => route !== operation.route && branch.routes.includes(route));
      return replace(section.start, section.end, [], selectedRouteRemoved ? branch.firstBarIndex : bar.index);
    }
    const at = sections.find(item => item.route === 'BRANCHEND')?.start ?? branch.end;
    return replace(at, at, [`${newline}#${operation.route}${newline},${newline}`]);
  }
  if (operation.type === 'end') {
    if (bar.index <= branch.firstBarIndex) throw new LocalizedError(message('分歧结束只能插在分歧开始之后的小节起点。'));
    const selected = sections.find(item => item.route === bar.route);
    const routeSectionsOnly = sections.filter(item => item.route !== 'BRANCHEND');
    const chunks = [[branch.start, routeSectionsOnly[0].start]];
    for (const section of routeSectionsOnly) {
      chunks.push([section.start, section === selected ? boundary : section.end], newline);
    }
    chunks.push(`#BRANCHEND${newline}`, [boundary, selected.end]);
    return replace(branch.start, branch.end, chunks);
  }
  throw new LocalizedError(message('分歧操作无效。'));
}
