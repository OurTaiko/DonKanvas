<script setup>
import { provide, ref } from 'vue';
import { FileMusic, AudioLines, History, Download, SkipBack, SkipForward, Play, Pause, Square, Repeat2, Volume2, Drum, LocateFixed } from '@lucide/vue';
import { useStudio, formatTime } from './useStudio.js';
import TimelineEditor from './TimelineEditor.vue';
import MeasureEditor from './MeasureEditor.vue';

const studio = useStudio();
provide('studio', studio);
const { state, controls, range } = studio;
const chartFile = ref(null), audioFile = ref(null);
async function openFile(event, audio = false) {
  const file = event.target.files[0];
  if (audio) await studio.openAudio(file); else await studio.openChart(file);
  event.target.value = '';
}
</script>

<template>
  <header>
    <div class="brand"><span class="brand-mark">波</span><div>TJA <strong>WAVE STUDIO</strong><small>谱面工作台</small></div></div>
    <div class="file-actions"><button id="open-chart" title="打开谱面" aria-label="打开谱面" @click="chartFile.click()"><FileMusic /><span>打开谱面</span></button><button id="open-audio" title="载入音频" aria-label="载入音频" @click="audioFile.click()"><AudioLines /><span>载入音频</span></button><button id="restore" title="恢复本地草稿" aria-label="恢复本地草稿" @click="studio.restore"><History /></button><button id="export" class="primary" title="导出 TJA" aria-label="导出 TJA" :disabled="!state.chart || state.invalid" @click="studio.exportChart"><Download /><span>导出 TJA</span></button></div>
  </header>
  <input id="chart-file" ref="chartFile" type="file" accept=".tja" hidden @change="openFile($event)"><input id="audio-file" ref="audioFile" type="file" accept="audio/*,.mp3,.ogg,.wav" hidden @change="openFile($event, true)">
  <main>
    <section class="song-heading"><div><div class="eyebrow">CHART SESSION <span id="encoding">{{ state.encoding }}</span></div><h1 id="song-title">{{ state.chart?.title || 'TJA WAVE STUDIO' }}</h1><p id="audio-name">{{ state.audioName }}</p></div><div class="song-meta">
      <label>难度<select id="course" :value="state.course" :disabled="!state.chart || state.invalid" @change="studio.changeCourse(Number($event.target.value))"><option v-for="(course, index) in state.chart?.courses || []" :key="index" :value="index">{{ course }}</option></select></label>
      <label>基础 BPM<input id="base-bpm" type="number" min="0.001" step="any" aria-label="基础 BPM" :value="state.chart?.baseBpm" :disabled="!state.chart || state.invalid" @change="studio.setBpm(Number($event.target.value)); $event.target.value = state.chart.baseBpm"></label>
      <label>偏移 / s<input id="offset" type="number" step="0.001" :value="state.chart?.offset" :disabled="!state.chart || state.invalid" @change="studio.setOffset(Number($event.target.value)); $event.target.value = state.chart.offset"></label>
      <div><span>小节数</span><strong id="bar-count">{{ state.chart?.bars.length || '—' }}</strong></div>
    </div></section>
    <div id="notice" role="status" aria-live="polite" :class="{ error: state.error }">{{ state.notice }}</div>
    <section class="transport"><div class="transport-left">
      <button id="previous" class="icon" title="上一小节" aria-label="上一小节" :disabled="!state.chart" @click="studio.select(state.selected - 1)"><SkipBack /></button>
      <button id="play" class="play icon" title="播放 / 暂停（空格）" :aria-label="state.playing ? '暂停' : '播放'" :disabled="!state.buffer" @click="state.playing ? studio.pause() : studio.play()"><Pause v-if="state.playing" /><Play v-else /></button>
      <button id="stop" class="icon" title="停止" aria-label="停止" :disabled="!state.chart" @click="studio.stop"><Square /></button>
      <button id="next" class="icon" title="下一小节" aria-label="下一小节" :disabled="!state.chart" @click="studio.select(state.selected + 1)"><SkipForward /></button>
      <div class="time"><b id="time">{{ formatTime(state.position) }}</b><span id="duration">/ {{ formatTime(state.buffer?.duration || 0) }}</span></div>
    </div><div class="transport-right">
      <label class="check"><input id="loop" v-model="controls.loop" type="checkbox"><Repeat2 />范围循环</label><label class="check"><input id="hits" v-model="controls.hits" type="checkbox">音符音</label>
      <label>速度<select id="rate" v-model.number="controls.rate"><option :value="0.5">0.5×</option><option :value="0.75">0.75×</option><option :value="1">1.0×</option><option :value="1.25">1.25×</option></select></label>
      <label class="volume"><Volume2 /><input id="volume" v-model.number="controls.volume" aria-label="音乐音量" title="原曲音量" type="range" min="0" max="100"></label>
    </div></section>
    <section class="sound-mixer"><label for="hit-volume">咚咔音量</label><input id="hit-volume" v-model.number="controls.hitVolume" type="range" min="0" max="300" aria-label="咚咔音量"><output id="hit-level" for="hit-volume">{{ controls.hitVolume }}%</output><button id="test-hits" title="单独试听咚、咔" @click="studio.testHits"><Drum />咚咔试音</button></section>
    <section class="loop-controls">
      <label>循环起始小节<input id="loop-first" type="number" min="1" :max="state.chart?.bars.length" :value="range[0]" step="1" :disabled="!state.chart" @change="studio.setLoop(Number($event.target.value), range[1]); $event.target.value = range[0]"></label><span>至</span>
      <label>结束小节<input id="loop-last" type="number" min="1" :max="state.chart?.bars.length" :value="range[1]" step="1" :disabled="!state.chart" @change="studio.setLoop(range[0], Number($event.target.value)); $event.target.value = range[1]"></label>
      <button id="loop-current" title="循环范围设为当前小节" :disabled="!state.chart" @click="studio.loopCurrent()"><LocateFixed />当前小节</button><button id="preview-range" :disabled="!state.buffer" @click="studio.previewRange"><Repeat2 />试听范围</button>
      <output id="loop-summary">第 {{ range[0] }}–{{ range[1] }} 小节 · {{ range[1] - range[0] + 1 }} 小节</output>
    </section>
    <TimelineEditor><MeasureEditor /></TimelineEditor>
  </main>
  <footer><span><span class="status-dot"></span>LOCAL SESSION</span><span id="save-state">{{ state.saveState }}</span><span>TJA / WS — 01</span></footer>
</template>