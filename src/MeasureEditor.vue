<script setup>
import { t } from './i18n.js';
import { computed, inject, reactive, watch } from 'vue';
import { RotateCcw, Trash2, Headphones, Eraser, ChevronDown } from '@lucide/vue';
import { formatTime } from './useStudio.js';
import { measureStart, measureEnd } from './loop.js';
import { EDITABLE_COMMANDS } from './chart.js';
import { NOTE_TYPES } from './note-model.js';
import { GRID_DIVISIONS } from './grid.js';

const studio = inject('studio');
const { state, controls, cell } = studio;
const bar = computed(() => studio.selectedTiming.value?.bar);
const command = computed(() => bar.value ? studio.command.value : null);
const measureCommand = computed(() => bar.value ? studio.measureCommand.value : null);
const stats = computed(() => bar.value ? studio.stats.value : null);
const position = reactive({ numerator: 0, denominator: 1 });
const fields = reactive({ bpm: 120, scroll: 1, numerator: 4, denominator: 4, delay: 0, gogo: 'off', barline: 'on', lyric: '', senote: 1 });
const enabled = reactive({ bpm: false, scroll: false, meter: false, delay: false, gogo: false, barline: false, lyric: false, section: false, levelhold: false, senote: false });
const types = { bpm: ['BPMCHANGE'], scroll: ['SCROLL'], meter: ['MEASURE'], delay: ['DELAY'], gogo: ['GOGOSTART', 'GOGOEND'], barline: ['BARLINEON', 'BARLINEOFF'] };
const preserved = { lyric: 'LYRIC', section: 'SECTION', levelhold: 'LEVELHOLD', senote: 'SENOTECHANGE' };
const measureKeys = ['meter', 'barline', 'section', 'levelhold'];
const divisions = computed(() => [...new Set([4, 8, 12, 16, 24, 32, 48, 64, 96, 192, bar.value?.notes.length].filter(Boolean))].sort((first, second) => first - second));
const sectionSummaries = computed(() => ({
  note: cell.value?.name ?? (bar.value ? t('空拍') : ''),
  position: command.value ? `${command.value.numerator}/${command.value.denominator} · ${formatTime(command.value.time)}` : '',
  measure: bar.value ? `${t('小节 {p0}', { p0: bar.value.index + 1 })} · ${t('音符数：{p0}', { p0: stats.value.total })}` : '',
  commands: command.value ? t('{p0} 条指令', { p0: command.value.commands.length }) : '',
  instructions: bar.value ? t('{p0} 条指令', { p0: bar.value.instructions.length }) : '',
  source: bar.value ? `${bar.value.notes.length} ${t('格')} · ${t(state.sourceState)}` : ''
}));
watch([command, measureCommand], ([value, measure]) => {
  if (!value || !measure) {
    position.numerator = position.denominator = '';
    for (const key of Object.keys(fields)) fields[key] = '';
    for (const key of Object.keys(enabled)) enabled[key] = false;
    return;
  }
  position.numerator = value.numerator; position.denominator = value.denominator;
  Object.assign(fields, value.timing, { numerator: measure.timing.numerator, denominator: measure.timing.denominator, gogo: value.timing.gogo ? 'on' : 'off', barline: measure.timing.barline ? 'on' : 'off', delay: value.commands.filter(item => item.name === 'DELAY').reduce((sum, item) => sum + Number(item.value), 0) });
  for (const [key, names] of Object.entries(types)) enabled[key] = (measureKeys.includes(key) ? measure : value).commands.some(item => names.includes(item.name));
  for (const [key, name] of Object.entries(preserved)) {
    const item = (measureKeys.includes(key) ? measure : value).commands.findLast(item => item.name === name);
    enabled[key] = Boolean(item);
    if (key === 'lyric') fields.lyric = item?.value ?? '';
    if (key === 'senote') fields.senote = item ? Number(item.value) : 1;
  }
  for (const key of ['bpm', 'scroll', 'delay', 'gogo', 'lyric', 'senote']) if (!enabled[key]) fields[key] = '';
}, { immediate: true });
function movePosition() {
  studio.setCommandPosition(Number(position.numerator), Number(position.denominator));
  position.numerator = command.value.numerator; position.denominator = command.value.denominator;
}
function apply(key, event) {
  const active = measureKeys.includes(key) ? enabled[key] : fields[key] !== '';
  if ((!measureKeys.includes(key) || active) && [...event.currentTarget.querySelectorAll('input, select')].some(input => !input.reportValidity())) return false;
  if (key === 'meter') {
    return studio.applySettings({ numerator: enabled.meter ? Number(fields.numerator) : null, denominator: enabled.meter ? Number(fields.denominator) : null }, true);
  } else {
    const value = !active ? null :
      ['bpm', 'scroll', 'delay', 'senote'].includes(key) ? Number(fields[key]) :
      ['gogo', 'barline'].includes(key) ? fields[key] === 'on' :
      key === 'lyric' ? fields.lyric : true;
    return studio.applySettings({ [key]: value }, measureKeys.includes(key));
  }
}
function finishSetting(event) {
  if (event.isComposing || event.keyCode === 229) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    const field = event.target.id.replace(/^(?:bar|use)-/, '');
    const key = ['numerator', 'denominator'].includes(field) ? 'meter' : field;
    if (!apply(key, { currentTarget: event.target.closest('.command-field') })) {
      event.preventDefault(); event.stopPropagation();
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
  }
}
function locate(item) { studio.setCommandPosition(item.slot, bar.value.notes.length); }
</script>

<template>
  <aside class="measure-editor" :aria-label="t('编辑面板')">
    <details class="inspector-section" open aria-labelledby="note-palette-title">
      <summary class="inspector-heading workspace-section-summary"><h2 id="note-palette-title">{{ t('音符编辑') }}</h2><span class="inspector-summary" :title="sectionSummaries.note">{{ sectionSummaries.note }}</span><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
      <div class="inspector-content">
      <div id="palette" class="palette"><button v-for="type in NOTE_TYPES" :key="type.value" :title="`${t(type.name)}（${type.shortcut ?? type.value}）`" :aria-label="`${t(type.name)}（${type.shortcut ?? type.value}）`" :data-value="type.value" :disabled="!cell || state.invalid" :class="{ active: cell?.note === type.value }" :aria-pressed="cell?.note === type.value" @click="studio.chooseNote(type.value)"><span class="choice-icon" aria-hidden="true"><span class="choice-symbol" :class="type.shape"></span></span><span class="choice-name"><span>{{ t(type.name) }}</span></span><small>{{ type.shortcut ?? type.value }}</small></button></div>
      <div v-if="cell && cell.ordinal >= 0" class="balloon-control command-field">
        <label for="balloon-count">{{ t('气球 / 特殊连打（#{p0}）敲击次数', { p0: cell.ordinal + 1 }) }}</label>
        <input id="balloon-count" type="number" min="1" step="1" :value="Number.isSafeInteger(cell.count) && cell.count > 0 ? cell.count : ''" :placeholder="t('未设置')" :disabled="state.invalid" @change="studio.setBalloon(Number($event.target.value))" @keydown.enter="!$event.isComposing && $event.keyCode !== 229 && $event.target.blur()">
      </div>
      </div>
    </details>
    <details class="selection-position inspector-section" open aria-labelledby="selected-position-title" @focusin="state.playing && studio.pause()">
      <summary class="inspector-heading workspace-section-summary"><h2 id="selected-position-title">{{ t('落点位置') }}</h2><span class="inspector-summary" :title="sectionSummaries.position">{{ sectionSummaries.position }}</span><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
      <div class="inspector-content">
      <label class="command-position">{{ t('小节内位置') }}<span class="meter-inputs"><input id="command-numerator" v-model.number="position.numerator" type="number" min="0" max="65536" step="1" :aria-label="t('选中位置分子')" :disabled="!bar || state.invalid" required @change="movePosition"><span>/</span><input id="command-denominator" v-model.number="position.denominator" type="number" min="1" max="65536" step="1" :aria-label="t('选中位置分母')" :disabled="!bar || state.invalid" required @change="movePosition"></span></label>
      <output id="command-time">{{ command ? `${formatTime(command.time)} · ${command.fraction === 0 ? t('小节起点') : command.fraction === 1 ? t('小节末端') : `${command.numerator}/${command.denominator}`}` : '—' }}</output>
      </div>
    </details>
    <details class="inspector-section" open aria-labelledby="measure-properties-title">
      <summary class="inspector-heading workspace-section-summary"><h2 id="measure-properties-title">{{ t('小节属性') }}</h2><span id="bar-badge" class="inspector-summary" :title="sectionSummaries.measure">{{ sectionSummaries.measure }}</span><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
      <div class="inspector-content">
      <div class="detail-row"><span>{{ t('时间范围') }}</span><b id="bar-time">{{ bar ? `${measureStart(bar).toFixed(3)} – ${measureEnd(bar).toFixed(3)} s` : '—' }}</b></div>
      <div class="detail-row"><span>{{ t('音符数') }}</span><b id="note-count">{{ stats?.total ?? '—' }}</b></div>
      <div class="detail-row"><span>{{ t('主网格') }}</span><b id="bar-grid">{{ GRID_DIVISIONS }} {{ t('格') }}</b></div>
      <div class="detail-row"><label for="division">{{ t('源码格数') }}</label><select id="division" :value="bar?.notes.length ?? ''" :disabled="!bar || state.invalid" @change="studio.setDivision(Number($event.target.value)); $event.target.value = bar.notes.length"><option v-if="!bar" value=""></option><option v-for="length in divisions" :key="length" :value="length">{{ length }}</option></select></div>
      </div>
    </details>
    <details class="inspector-section" open aria-labelledby="command-editor-title" @focusin="state.playing && studio.pause()">
      <summary class="inspector-heading workspace-section-summary"><h2 id="command-editor-title">{{ t('指令编辑') }}</h2><span class="inspector-summary" :title="sectionSummaries.commands">{{ sectionSummaries.commands }}</span><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
      <form class="bar-settings inspector-content" @submit.prevent>
      <fieldset id="position-commands" class="command-group">
      <legend>{{ t('任意落点指令') }}</legend>
      <div class="settings-grid" @keydown="finishSetting">
        <div class="command-field" @change="apply('bpm', $event)"><label for="bar-bpm">BPM</label><input id="bar-bpm" v-model.number="fields.bpm" :aria-label="t('落点 BPM')" type="number" min="0.001" step="any" :disabled="!bar || state.invalid"></div>
        <div class="command-field" @change="apply('scroll', $event)"><label for="bar-scroll">{{ t('卷轴倍率') }}</label><input id="bar-scroll" v-model.number="fields.scroll" :aria-label="t('落点卷轴倍率')" type="number" step="any" :disabled="!bar || state.invalid"></div>
        <div class="command-field" @change="apply('delay', $event)"><label for="bar-delay">{{ t('延迟 / s') }}</label><input id="bar-delay" v-model.number="fields.delay" :aria-label="t('落点延迟')" type="number" step="any" :disabled="!bar || state.invalid"></div>
        <div class="command-field" @change="apply('gogo', $event)"><label for="bar-gogo">Go-Go Time</label><select id="bar-gogo" v-model="fields.gogo" :aria-label="t('Go-Go 状态')" :disabled="!bar || state.invalid"><option value="">{{ t('不启用') }}</option><option value="on">GOGO START</option><option value="off">GOGO END</option></select></div>
        <div class="command-field command-wide" @change="apply('lyric', $event)"><label for="bar-lyric">LYRIC · {{ t('歌词') }}</label><input id="bar-lyric" v-model="fields.lyric" :aria-label="t('歌词')" :disabled="!bar || state.invalid"></div>
        <div class="command-field" @change="apply('senote', $event)"><label for="bar-senote">SENOTECHANGE</label><input id="bar-senote" v-model.number="fields.senote" :aria-label="t('音符唱词编号')" type="number" min="1" max="12" step="1" :disabled="!bar || state.invalid"></div>
      </div>
      </fieldset>
      <p class="command-help">{{ t('任意落点指令留空即移除，填写后生效。') }}</p>
      <fieldset id="measure-commands" class="command-group">
        <legend>{{ t('小节级指令') }}</legend>
        <p class="command-help">{{ t('固定写入当前小节起点，不随落点选择改变。') }}</p>
        <div class="settings-grid" @keydown="finishSetting">
          <div class="command-field" @change="apply('meter', $event)"><label class="command-enable"><input id="use-meter" v-model="enabled.meter" type="checkbox" :disabled="!bar || state.invalid">{{ t('拍号') }}</label><span class="meter-inputs"><input id="bar-numerator" v-model.number="fields.numerator" type="number" min="1" step="1" :aria-label="t('拍号分子')" :disabled="!bar || !enabled.meter || state.invalid" required><span>/</span><input id="bar-denominator" v-model.number="fields.denominator" type="number" min="1" step="1" :aria-label="t('拍号分母')" :disabled="!bar || !enabled.meter || state.invalid" required></span></div>
          <div class="command-field" @change="apply('barline', $event)"><label class="command-enable"><input id="use-barline" v-model="enabled.barline" type="checkbox" :disabled="!bar || state.invalid">{{ t('小节线') }}</label><select id="bar-barline" v-model="fields.barline" :aria-label="t('小节线状态')" :disabled="!bar || !enabled.barline || state.invalid"><option value="on">{{ t('显示') }}</option><option value="off">{{ t('隐藏') }}</option></select></div>
          <div class="command-field"><label class="command-enable" @change="apply('section', $event)"><input id="use-section" v-model="enabled.section" type="checkbox" :disabled="!bar || state.invalid">SECTION</label></div>
          <div class="command-field"><label class="command-enable" @change="apply('levelhold', $event)"><input id="use-levelhold" v-model="enabled.levelhold" type="checkbox" :disabled="!bar || state.invalid">LEVELHOLD</label></div>
        </div>
      </fieldset>
      <div class="aside-actions"><button id="settings-reset" type="button" class="icon" :title="t('清除当前落点的计时与显示指令')" :aria-label="t('清除当前落点的计时与显示指令')" :disabled="!command?.commands.some(item => EDITABLE_COMMANDS.includes(item.name)) || state.invalid" @click="studio.clearSettings"><RotateCcw /></button></div>
      </form>
    </details>
    <details class="inspector-section" open aria-labelledby="measure-command-list-title" @focusin="state.playing && studio.pause()">
      <summary class="inspector-heading workspace-section-summary"><h2 id="measure-command-list-title">{{ t('本小节指令') }}</h2><span class="inspector-summary" :title="sectionSummaries.instructions">{{ sectionSummaries.instructions }}</span><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
      <div class="inspector-content">
      <div id="bar-commands" class="command-list">
        <div v-for="item in bar?.instructions || []" :key="item.start" class="command-row">
          <button type="button" class="command-locate" :title="t('定位指令 {p0}', { p0: state.text.slice(item.start, item.end) })" :disabled="state.invalid" @click="locate(item)"><small>{{ item.slot }}/{{ bar.notes.length }} · {{ formatTime(item.time) }}</small><span>{{ state.text.slice(item.start, item.end) }}</span></button>
          <button type="button" class="icon" :title="item.shared ? t('共用指令（只读）') : t('删除指令 {p0}', { p0: state.text.slice(item.start, item.end) })" :aria-label="item.shared ? t('共用指令（只读）') : t('删除指令 {p0}', { p0: state.text.slice(item.start, item.end) })" :disabled="state.invalid || item.shared" @click="studio.removeCommand(item)"><Trash2 /></button>
        </div>
        <span v-if="!bar?.instructions.length" class="command-empty">{{ bar ? t('无指令') : '—' }}</span>
      </div>
      </div>
    </details>
    <details class="inspector-section source-section" open aria-labelledby="measure-source-title">
      <summary class="inspector-heading workspace-section-summary"><h2 id="measure-source-title">{{ t('小节源码（含指令）') }}</h2><span id="source-state" class="inspector-summary" :title="sectionSummaries.source">{{ sectionSummaries.source }}</span><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
      <div class="inspector-content">
      <textarea id="source" :value="bar ? state.source : ''" :disabled="!bar" spellcheck="false" :aria-label="t('当前小节完整源码')" @input="studio.editSource($event.target.value)"></textarea>
      <div class="source-meta"><span id="slots">{{ bar ? `${bar.notes.length} ${t('格')}` : '—' }}</span><span>0–9 / A / B</span></div>
      <div class="aside-actions"><button id="preview" :disabled="!bar || state.invalid" @click="studio.loopCurrent(true)"><Headphones />{{ t('试听本小节') }}</button><button id="clear" class="icon" :title="t('清空本小节')" :aria-label="t('清空本小节')" :disabled="!bar || state.invalid" @click="studio.clearBar"><Eraser /></button></div>
      </div>
    </details>
  </aside>
</template>

<style scoped>
.measure-editor{display:block;min-width:0;min-height:0;padding:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.inspector-section{min-width:0;margin:0 0 16px;border:0}.inspector-section:last-child{margin-bottom:0}.inspector-content{min-width:0;padding:12px 14px 14px;border:0}.inspector-content.bar-settings{margin:0;border:0}.inspector-content>.detail-row:first-child{margin-top:0}.inspector-content>.detail-row:last-child{margin-bottom:0}
.inspector-section:not([open]){margin-bottom:0;border-bottom:1px solid var(--line)}
.inspector-heading{background:var(--paper)}.inspector-heading:hover{background:#edf3ee}
.inspector-heading h2{flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.inspector-summary{flex:1 1 auto;min-width:0;font-size:11px;line-height:1;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.command-group{min-width:0;margin:12px 0 0;padding:10px 0 0;border:0;border-top:1px dashed var(--line)}.command-group legend{padding:0 8px 0 0;font-size:11px;font-weight:500;color:var(--muted)}.selection-position .command-position{margin-top:0}.selection-position .inspector-content>output{display:block;margin-top:8px;font-size:12px;line-height:18px;color:var(--muted)}
.selection-position input,.command-group input:not([type=checkbox]),.command-group select{box-sizing:border-box;width:100%;min-width:0;max-width:none;height:32px;min-height:32px;margin:0;padding:6px 8px;border:1px solid var(--line);border-radius:4px;background:#fff;font-size:12px;line-height:18px}.selection-position .meter-inputs input,.command-group .meter-inputs input{width:0;flex:1 1 0}
.balloon-control{margin-top:12px;font-size:11px;color:var(--muted)}.balloon-control label{line-height:1.5;overflow-wrap:anywhere}.balloon-control input{width:100%;min-width:0;height:32px;padding:6px 8px;font-size:12px}
@media(max-width:900px){.measure-editor{overflow:visible;border-left:0;border-top:1px solid var(--line)}}
.command-wide{grid-column:1/-1}.command-help{font-size:12px;line-height:1.6;color:var(--muted);margin:8px 0}.branch-edit-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
</style>