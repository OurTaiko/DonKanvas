<script setup>
import { t } from './i18n.js';
import { computed, inject, reactive, watch } from 'vue';
import { ChevronLeft, ChevronRight, RotateCcw, Check, Trash2, Headphones, Eraser } from '@lucide/vue';
import { formatTime } from './useStudio.js';
import { measureStart, measureEnd } from './loop.js';
import { EDITABLE_COMMANDS } from './chart.js';

const studio = inject('studio');
const { state, controls, bar, command, stats } = studio;
const position = reactive({ numerator: 0, denominator: 1 });
const fields = reactive({ bpm: 120, scroll: 1, numerator: 4, denominator: 4, delay: 0, gogo: 'off', barline: 'on' });
const enabled = reactive({ bpm: false, scroll: false, meter: false, delay: false, gogo: false, barline: false });
const types = { bpm: ['BPMCHANGE'], scroll: ['SCROLL'], meter: ['MEASURE'], delay: ['DELAY'], gogo: ['GOGOSTART', 'GOGOEND'], barline: ['BARLINEON', 'BARLINEOFF'] };
const divisions = computed(() => [...new Set([4, 8, 12, 16, 24, 32, 48, 64, 96, 192, bar.value?.notes.length].filter(Boolean))].sort((first, second) => first - second));
watch(command, value => {
  if (!value) return;
  position.numerator = value.numerator; position.denominator = value.denominator;
  Object.assign(fields, value.timing, { gogo: value.timing.gogo ? 'on' : 'off', barline: value.timing.barline ? 'on' : 'off', delay: value.commands.filter(item => item.name === 'DELAY').reduce((sum, item) => sum + Number(item.value), 0) });
  for (const [key, names] of Object.entries(types)) enabled[key] = value.commands.some(item => names.includes(item.name));
}, { immediate: true });
function movePosition() {
  studio.setCommandPosition(Number(position.numerator), Number(position.denominator));
  position.numerator = command.value.numerator; position.denominator = command.value.denominator;
}
function apply() {
  const settings = {};
  for (const key of ['bpm', 'scroll', 'delay']) settings[key] = enabled[key] ? Number(fields[key]) : null;
  for (const key of ['numerator', 'denominator']) settings[key] = enabled.meter ? Number(fields[key]) : null;
  settings.gogo = enabled.gogo ? fields.gogo === 'on' : null;
  settings.barline = enabled.barline ? fields.barline === 'on' : null;
  studio.applySettings(settings);
}
function locate(item) { studio.setCommandPosition(item.slot, bar.value.notes.length); }
</script>

<template>
  <aside>
    <div class="aside-heading"><h2>{{ t('小节编辑') }}</h2><span id="bar-badge">{{ String(state.selected + 1).padStart(3, '0') }}</span></div>
    <div class="bar-nav">
      <button id="bar-prev" class="icon" :title="t('上一小节')" :aria-label="t('上一小节')" :disabled="!bar" @click="studio.select(state.selected - 1)"><ChevronLeft /></button>
      <label>{{ t('小节') }}<input id="bar-number" type="number" min="1" :max="state.chart?.bars.length" :value="state.selected + 1" :disabled="!bar" @change="studio.select(Number($event.target.value) - 1); $event.target.value = state.selected + 1"></label>
      <button id="bar-next" class="icon" :title="t('下一小节')" :aria-label="t('下一小节')" :disabled="!bar" @click="studio.select(state.selected + 1)"><ChevronRight /></button>
    </div>
    <div class="detail-row"><span>{{ t('时间范围') }}</span><b id="bar-time">{{ bar ? `${measureStart(bar).toFixed(3)} – ${measureEnd(bar).toFixed(3)} s` : '—' }}</b></div>
    <div class="detail-row"><label for="division">{{ t('源码格数') }}</label><select id="division" :value="bar?.notes.length" :disabled="!bar || state.invalid" @change="studio.setDivision(Number($event.target.value)); $event.target.value = bar.notes.length"><option v-for="length in divisions" :key="length" :value="length">{{ length }}</option></select></div>
    <form class="bar-settings" @submit.prevent="apply" @focusin="state.playing && studio.pause()">
      <div class="settings-heading"><h3>{{ t('落点指令') }}</h3><button id="settings-reset" type="button" class="icon" :title="t('清除当前落点指令')" :aria-label="t('清除当前落点指令')" :disabled="!command?.commands.some(item => EDITABLE_COMMANDS.includes(item.name)) || state.invalid" @click="studio.clearSettings"><RotateCcw /></button></div>
      <label class="command-position">{{ t('小节内位置') }}<span class="meter-inputs"><input id="command-numerator" v-model.number="position.numerator" type="number" min="0" max="65536" step="1" :aria-label="t('指令位置分子')" :disabled="!bar || state.invalid" required @change="movePosition"><span>/</span><input id="command-denominator" v-model.number="position.denominator" type="number" min="1" max="65536" step="1" :aria-label="t('指令位置分母')" :disabled="!bar || state.invalid" required @change="movePosition"></span></label>
      <output id="command-time">{{ command ? `${formatTime(command.time)} · ${command.fraction === 0 ? t('小节起点') : command.fraction === 1 ? t('小节末端') : `${command.numerator}/${command.denominator}`}` : '—' }}</output>
      <div class="settings-grid">
        <div class="command-field"><label class="command-enable"><input id="use-bpm" v-model="enabled.bpm" type="checkbox" :disabled="!bar || state.invalid">BPM</label><input id="bar-bpm" v-model.number="fields.bpm" :aria-label="t('落点 BPM')" type="number" min="0.001" step="any" :disabled="!bar || !enabled.bpm || state.invalid" required></div>
        <div class="command-field"><label class="command-enable"><input id="use-scroll" v-model="enabled.scroll" type="checkbox" :disabled="!bar || state.invalid">{{ t('卷轴倍率') }}</label><input id="bar-scroll" v-model.number="fields.scroll" :aria-label="t('落点卷轴倍率')" type="number" step="any" :disabled="!bar || !enabled.scroll || state.invalid" required></div>
        <div class="command-field"><label class="command-enable"><input id="use-meter" v-model="enabled.meter" type="checkbox" :disabled="!bar || state.invalid">{{ t('拍号') }}</label><span class="meter-inputs"><input id="bar-numerator" v-model.number="fields.numerator" type="number" min="1" step="1" :aria-label="t('拍号分子')" :disabled="!bar || !enabled.meter || state.invalid" required><span>/</span><input id="bar-denominator" v-model.number="fields.denominator" type="number" min="1" step="1" :aria-label="t('拍号分母')" :disabled="!bar || !enabled.meter || state.invalid" required></span></div>
        <div class="command-field"><label class="command-enable"><input id="use-delay" v-model="enabled.delay" type="checkbox" :disabled="!bar || state.invalid">{{ t('延迟 / s') }}</label><input id="bar-delay" v-model.number="fields.delay" :aria-label="t('落点延迟')" type="number" step="any" :disabled="!bar || !enabled.delay || state.invalid" required></div>
        <div class="command-field"><label class="command-enable"><input id="use-gogo" v-model="enabled.gogo" type="checkbox" :disabled="!bar || state.invalid">Go-Go Time</label><select id="bar-gogo" v-model="fields.gogo" :aria-label="t('Go-Go 状态')" :disabled="!bar || !enabled.gogo || state.invalid"><option value="on">{{ t('开始') }}</option><option value="off">{{ t('结束') }}</option></select></div>
        <div class="command-field"><label class="command-enable"><input id="use-barline" v-model="enabled.barline" type="checkbox" :disabled="!bar || state.invalid">{{ t('小节线') }}</label><select id="bar-barline" v-model="fields.barline" :aria-label="t('小节线状态')" :disabled="!bar || !enabled.barline || state.invalid"><option value="on">{{ t('显示') }}</option><option value="off">{{ t('隐藏') }}</option></select></div>
      </div>
      <button type="submit" id="settings-apply" :disabled="!bar || state.invalid"><Check />{{ t('应用落点指令') }}</button>
      <h3 class="command-list-heading">{{ t('本小节指令') }}</h3>
      <div id="bar-commands" class="command-list">
        <div v-for="item in bar?.instructions || []" :key="item.start" class="command-row">
          <button type="button" class="command-locate" :title="t('定位指令 {p0}', { p0: state.text.slice(item.start, item.end) })" :disabled="state.invalid" @click="locate(item)"><small>{{ item.slot }}/{{ bar.notes.length }} · {{ formatTime(item.time) }}</small><span>{{ state.text.slice(item.start, item.end) }}</span></button>
          <button type="button" class="icon" :title="t('删除指令 {p0}', { p0: state.text.slice(item.start, item.end) })" :aria-label="t('删除指令 {p0}', { p0: state.text.slice(item.start, item.end) })" :disabled="state.invalid" @click="studio.removeCommand(item)"><Trash2 /></button>
        </div>
        <span v-if="!bar?.instructions.length" class="command-empty">{{ t('无指令') }}</span>
      </div>
    </form>
    <div class="source-label"><label for="source">{{ t('小节源码（含指令）') }}</label><span id="source-state">{{ t(state.sourceState) }}</span></div>
    <textarea id="source" :value="state.source" :disabled="!bar" spellcheck="false" :aria-label="t('当前小节完整源码')" @input="studio.editSource($event.target.value)"></textarea>
    <div class="source-meta"><span id="slots">{{ bar?.notes.length || 0 }} {{ t('格') }}</span><span>0–9</span></div>
    <div class="aside-actions"><button id="preview" :disabled="!bar || state.invalid" @click="studio.loopCurrent(true)"><Headphones />{{ t('试听本小节') }}</button><button id="clear" class="icon" :title="t('清空本小节')" :aria-label="t('清空本小节')" :disabled="!bar || state.invalid" @click="studio.clearBar"><Eraser /></button></div>
    <div class="note-summary"><h3>{{ t('音符统计') }}</h3><div><span><em class="dot don"></em>{{ t('咚') }}</span><b id="don-count">{{ stats.don }}</b></div><div><span><em class="dot ka"></em>{{ t('咔') }}</span><b id="ka-count">{{ stats.ka }}</b></div><div><span><em class="dot roll"></em>{{ t('连打 / 其他') }}</span><b id="other-count">{{ stats.other }}</b></div></div>
  </aside>
</template>