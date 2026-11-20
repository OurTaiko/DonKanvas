import { message, LocalizedError } from './i18n.js';
export const SONG_FIELDS = [
  { key: 'TITLE', label: '曲名' },
  { key: 'SUBTITLE', label: '副标题' },
  { key: 'TITLEZH', label: '曲名（中文）', localized: true },
  { key: 'SUBTITLEZH', label: '副标题（中文）', localized: true },
  { key: 'TITLEEN', label: '曲名（英语）', localized: true },
  { key: 'SUBTITLEEN', label: '副标题（英语）', localized: true },
  { key: 'TITLEJA', label: '曲名（日语）', localized: true },
  { key: 'SUBTITLEJA', label: '副标题（日语）', localized: true },
  { key: 'TITLEKO', label: '曲名（韩语）', localized: true },
  { key: 'SUBTITLEKO', label: '副标题（韩语）', localized: true },
  { key: 'ARTIST', label: '艺术家' },
  { key: 'GENRE', label: '分类' },
  { key: 'WAVE', label: '音频文件（WAVE）' },
  { key: 'BPM', label: '基础 BPM', numeric: true },
  { key: 'OFFSET', label: '偏移 / 秒', numeric: true },
  { key: 'DEMOSTART', label: '试听起点 / 秒', numeric: true }
];

function headerEnd(text) {
  const end = text.search(/^(?:COURSE:|#START\b)/mi);
  return end < 0 ? text.length : end;
}

export function songMetadata(text) {
  const header = text.slice(0, headerEnd(text));
  return Object.fromEntries(SONG_FIELDS.map(({ key }) => [key, header.match(new RegExp(`^${key}:(.*)$`, 'mi'))?.[1].trim() || '']));
}

export function setSongMetadata(text, values) {
  const current = songMetadata(text), changes = [];
  for (const [key, raw] of Object.entries(values)) {
    const field = SONG_FIELDS.find(field => field.key === key);
    if (!field) throw new LocalizedError(message('不支持的歌曲字段：{p0}', { p0: key }));
    const value = String(raw).trim();
    if (/[\r\n\0]/.test(value)) throw new LocalizedError(message('{p0}不能包含换行或空字符。', { p0: message(field.label) }));
    if (field.numeric && (value || key === 'BPM')) {
      const number = Number(value);
      if (!Number.isFinite(number) || (key === 'BPM' && number <= 0) || (key === 'DEMOSTART' && number < 0)) throw new LocalizedError(message('{p0}须为{p1}。', { p0: message(field.label), p1: key === 'BPM' ? message('正数') : key === 'DEMOSTART' ? message('非负数') : message('有限数值') }));
    }
    if (value !== current[key]) changes.push([key, value]);
  }
  let header = text.slice(0, headerEnd(text));
  const body = text.slice(header.length), eol = text.includes('\r\n') ? '\r\n' : '\n';
  for (const [key, value] of changes) {
    const pattern = new RegExp(`^(${key}:[\\t ]*)[^\\r\\n]*`, 'gmi');
    if (!value) header = header.replace(new RegExp(`^${key}:[^\\r\\n]*(?:\\r?\\n|$)`, 'gmi'), '');
    else if (pattern.test(header)) header = header.replace(pattern, (_, prefix) => `${prefix}${value}`);
    else header += `${header && !header.endsWith('\n') ? eol : ''}${key}:${value}${eol}`;
  }
  return header + body;
}
