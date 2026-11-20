export function waveSegments(wave, chartPath = '') {
  wave = wave.trim().replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
  if (!wave || /^(?:\/|[a-z][a-z\d+.-]*:)/i.test(wave)) throw new Error('WAVE 须为授权文件夹内的相对文件路径。');
  const parts = chartPath.replace(/\\/g, '/').split('/').slice(0, -1).filter(part => part && part !== '.');
  if (parts.includes('..')) throw new Error('谱面相对路径无效。');
  for (const part of wave.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('WAVE 路径超出已授权文件夹，请关联包含音频的上级文件夹。');
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length || /\/$/.test(wave) || ['.', '..'].includes(wave.split('/').at(-1))) throw new Error('WAVE 未指定有效的音频文件名。');
  return parts;
}

export function indexMediaFiles(files) {
  const indexed = new Map();
  let name;
  for (const file of files) {
    const parts = (file.webkitRelativePath || '').split('/'), root = parts.shift();
    if (!root || !parts.length) throw new Error('浏览器未提供目录相对路径，请重新选择文件夹或手动载入音频。');
    if (name && root !== name) throw new Error('请一次选择一个音频文件夹。');
    name = root;
    const path = parts.join('/');
    if (indexed.has(path)) throw new Error(`文件夹中存在重复路径：${path}`);
    indexed.set(path, file);
  }
  return { name, files: indexed };
}

export async function findWaveFile(wave, { directory, files, chartHandle, chartPath = '', chartName }) {
  if (directory && chartHandle) {
    const relative = await directory.resolve(chartHandle);
    if (relative) chartPath = relative.join('/');
  } else if (files && !chartPath) {
    const charts = [...files.keys()].filter(path => path.split('/').at(-1).toLowerCase() === chartName.toLowerCase());
    if (charts.length > 1) throw new Error('文件夹中有多份同名谱面，无法确定音频相对位置；请关联当前谱面所在文件夹。');
    if (charts.length === 1) chartPath = charts[0];
  }
  const parts = waveSegments(wave, chartPath);
  if (directory) {
    let parent = directory;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    return (await parent.getFileHandle(parts.at(-1))).getFile();
  }
  const path = parts.join('/');
  if (files?.has(path)) return files.get(path);
  const matches = [...(files?.keys() || [])].filter(key => key.toLowerCase() === path.toLowerCase());
  if (matches.length > 1) throw new Error(`音频路径大小写存在歧义：${path}`);
  if (matches.length === 1) return files.get(matches[0]);
  throw new Error(`找不到 WAVE 指定的音频：${path}`);
}
