import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computed } from 'vue';
import { parse, compileScript } from 'vue/compiler-sfc';
import { translations } from './locales.js';
import { SONG_FIELDS, setSongMetadata } from './metadata.js';
import { NOTE_TYPES } from './note-model.js';
import { languages, locale, localePreference, matchLocale, detectLocale, initializeLocale, setLocale, LOCALE_KEY, t, message, formatMessage, LocalizedError } from './i18n.js';

const reset = () => { locale.value = 'zh-CN'; localePreference.value = 'auto'; };
const placeholders = text => [...new Set(text.match(/\{\w+\}/g) || [])].sort();

test('the language icon and options are in the top toolbar with setup handlers', () => {
  const source = readFileSync(new URL('App.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const { bindings } = compileScript(descriptor, { id: 'i18n-test' });
  assert.ok(bindings.changeLanguage);
  assert.ok(bindings.localePreference);
  assert.ok(bindings.languageKeydown);
  assert.ok(bindings.dismissLanguageMenu);
  const header = descriptor.template.content.match(/<header>[\s\S]*?<\/header>/)[0];
  assert.match(header, /id="language-toggle"/);
  assert.match(header, /@click="changeLanguage\(language.code\)"/);
  assert.match(header, /:aria-pressed="localePreference === language.code"/);
  assert.doesNotMatch(descriptor.template.content.match(/<footer>[\s\S]*?<\/footer>/)[0], /language-toggle|language-menu/);
});

test('project footer links match the repository, organization and MIT license', () => {
  const source = readFileSync(new URL('App.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const footer = descriptor.template.content.match(/<footer>[\s\S]*?<\/footer>/)[0];
  const links = [...footer.matchAll(/<a\b([^>]*)>/g)].map(match => match[1]);
  assert.equal(links.length, 3);
  for (const [index, url] of ['https://github.com/OurTaiko/web-tja-studio', 'https://github.com/OurTaiko', 'https://github.com/OurTaiko/web-tja-studio/blob/HEAD/LICENSE'].entries()) {
    assert.ok(links[index].includes(`href="${url}"`));
    assert.match(links[index], /target="_blank"/);
    assert.match(links[index], /rel="noopener noreferrer"/);
  }
  assert.match(readFileSync(new URL('LICENSE', import.meta.url), 'utf8'), /^MIT License/);
  assert.match(footer, /MIT 开源协议/);
});

test('audio loading belongs to the active chart transport instead of the global toolbar', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const template = descriptor.template.content;
  assert.doesNotMatch(template.match(/<header>[\s\S]*?<\/header>/)[0], /id="open-audio"/);
  const transport = template.match(/<section class="transport">[\s\S]*?<\/section>/)[0];
  const button = transport.match(/<button id="open-audio"[\s\S]*?<\/button>/)[0];
  assert.match(button, /class="primary"/);
  assert.match(button, /:disabled="!state.chart"/);
  assert.match(button, /@click="audioFile.click\(\)"/);
  assert.match(button, /:aria-label="t\('载入音频'\)"/);
  assert.equal([...template.matchAll(/id="open-audio"/g)].length, 1);
});

test('all five catalogs are complete and preserve interpolation placeholders', () => {
  assert.equal(languages.length, 5);
  for (const [key, values] of Object.entries(translations)) {
    assert.equal(values.length, 4, key);
    for (const value of values) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.trim(), key);
      assert.deepEqual(placeholders(value), placeholders(key), key);
    }
  }
  const files = ['App.vue', 'TimelineEditor.vue', 'MeasureEditor.vue', 'useStudio.js', 'chart.js', 'grid.js', 'note-model.js', 'balloon.js', 'loop.js', 'media-files.js', 'history.js', 'metadata.js'];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of source.matchAll(/'([^'\\\r\n]*(?:\\.[^'\\\r\n]*)*)'/g)) {
      if (/\p{Script=Han}/u.test(match[1])) assert.ok(Object.hasOwn(translations, match[1]), `${file}: ${match[1]}`);
    }
  }
  for (const key of [...SONG_FIELDS.map(field => field.label), ...NOTE_TYPES.map(type => type.name)]) assert.ok(Object.hasOwn(translations, key), key);
});

test('browser language matching respects preference order, script and regional variants', () => {
  for (const [input, expected] of [['zh', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh-Hans-TW', 'zh-CN'], ['zh-TW', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh_MO', 'zh-TW'], ['EN-us', 'en'], ['ja-JP', 'ja'], ['ko-KR', 'ko']]) {
    assert.equal(matchLocale(input), expected, input);
  }
  assert.equal(matchLocale('english'), undefined);
  assert.equal(detectLocale(['fr-FR', 'ja-JP', 'en-US']), 'ja');
  assert.equal(detectLocale(['en-GB', 'zh-TW']), 'en');
  assert.equal(detectLocale(['fr-FR']), 'zh-CN');
  assert.equal(detectLocale(), 'zh-CN');
});

test('language preference persists independently of the workspace and updates HTML lang', () => {
  const saved = new Map([['tja-wave-workspace', 'untouched']]);
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const root = {};
  try {
    assert.equal(initializeLocale(storage, ['ko-KR'], root), undefined);
    assert.equal(locale.value, 'ko'); assert.equal(root.lang, 'ko'); assert.equal(localePreference.value, 'auto');
    for (const language of languages) {
      assert.equal(setLocale(language.code, storage, root), undefined);
      assert.equal(root.lang, language.code); assert.equal(saved.get(LOCALE_KEY), language.code);
      initializeLocale(storage, ['fr-FR'], root);
      assert.equal(locale.value, language.code); assert.equal(localePreference.value, language.code);
    }
    saved.set(LOCALE_KEY, 'unsupported');
    initializeLocale(storage, ['en-US'], root); assert.equal(locale.value, 'en');
    assert.equal(localePreference.value, 'auto');
    setLocale('auto', storage, root);
    assert.equal(saved.get(LOCALE_KEY), 'auto'); assert.equal(localePreference.value, 'auto');
    initializeLocale(storage, ['zh-Hant'], root); assert.equal(locale.value, 'zh-TW');
    assert.equal(saved.get('tja-wave-workspace'), 'untouched');
    assert.throws(() => setLocale('unsupported', storage, root), RangeError);
    assert.equal(locale.value, 'zh-TW');
  } finally { reset(); }
});

test('blocked storage reports the error while leaving language selection usable', () => {
  const failure = new Error('Storage blocked');
  const storage = { getItem() { throw failure; }, setItem() { throw failure; } }, root = {};
  try {
    assert.equal(initializeLocale(storage, ['ja-JP'], root), failure);
    assert.equal(locale.value, 'ja'); assert.equal(root.lang, 'ja');
    assert.equal(setLocale('ko', storage, root), failure);
    assert.equal(locale.value, 'ko'); assert.equal(root.lang, 'ko');
  } finally { reset(); }
});

test('messages, nested errors and note labels react immediately without translating user data', () => {
  const error = new LocalizedError(message('BPM 须为正数。'));
  const notice = message('打开谱面失败：{p0}', { p0: error });
  const label = computed(() => formatMessage(notice));
  try {
    for (const [code, expected] of [['en', 'Failed to open chart: BPM must be positive.'], ['ja', '譜面を開けませんでした：BPM は正の数で指定してください。'], ['zh-TW', '開啟譜面失敗：BPM 須為正數。'], ['ko', '채보 열기 실패: BPM은 양수여야 합니다.'], ['zh-CN', '打开谱面失败：BPM 须为正数。']]) {
      locale.value = code;
      assert.equal(label.value, expected);
    }
    locale.value = 'en';
    assert.equal(t('关闭 {p0}', { p0: '咚.tja' }), 'Close 咚.tja');
    assert.equal(t('关闭 {p0}', { p0: '<script>{p0}</script>' }), 'Close <script>{p0}</script>');
    assert.equal(t('unknown translation'), 'unknown translation');
    assert.equal(t('关闭 {p0}'), 'Close {p0}');
    assert.throws(() => setSongMetadata('TITLE:A\nBPM:120\n#START\n0,\n#END', { BPM: 0 }), { message: 'Base BPM must be a positive number.' });
    assert.throws(() => setSongMetadata('TITLE:A\n#START\n0,\n#END', { TITLE: 'A\nB' }), { message: 'Title cannot contain line breaks or null characters.' });
  } finally { reset(); }
});
