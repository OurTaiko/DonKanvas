<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronsLeft, ChevronsRight, ChevronsUp, ChevronsDown, Keyboard, ListPlus, Monitor, Mouse, Pause, Play, Smartphone, X } from '@lucide/vue';
import { t } from './i18n.js';
import { NOTE_TYPES } from './note-model.js';
import GuidePointer from './GuidePointer.vue';

const storageKey = 'donkanvas-welcome-guide-seen';
const dialog = ref(null), device = ref(''), step = ref(0);
const opened = ref(false), phase = ref(0);
const moveFrame = ref(0);
let animationTimer;
const appendLesson = { title: '先追加一个小节', description: '点击工具栏的“末尾追加小节”，在当前难度末尾添加空白小节。追加后自动定位并选中新小节起点；桌面也可按 Shift+Enter。', hint: '追加小节 → 选中起点', scene: 'append' };
const scrollLessons = [
  { title: '时间轴波形：定位与试听', description: '时间轴波形与音符轨道同步滚动。点按波形只定位播放位置，不改变音符选点；长按可从该处播放。', hint: '点按定位 · 长按试听', scene: 'wave' },
  { title: '全曲概览：跳转与浏览', description: '点按全曲概览可查看对应小节并定位播放头；拖动视窗框只平移时间轴的可视范围，不改变播放头或音符选点。', hint: '点按跳转 · 拖动浏览', scene: 'overview' }
];
const steps = computed(() => device.value === 'touch' ? [
  { title: '从一张谱面开始', description: '在文件菜单中新建歌曲后添加难度谱面，或打开已有谱面；需要伴奏时再载入音频。', hint: '文件 → 新建 / 打开谱面', scene: 'file' },
  appendLesson,
  { title: '点按落点，放置音符', description: '点按时间轴下方的音符轨道选择落点，再点按音符按钮写入。', hint: '选择落点 → 选择音符', scene: 'note' },
  ...scrollLessons,
  { title: '滑动浏览，长按微调', description: '在时间轴上左右滑动浏览；长按音符轨道的落点，再左右拖动可逐格移动选中位置。', hint: '滑动浏览 · 长按后拖动微调', scene: 'move' },
  { title: '长按后，上下调整分音', description: '长按音符轨道后，上下滑动可调整分音：上滑网格变密，下滑变疏，每移动 48px 切换一档，最高 128 分。首次滑动会锁定上下或左右方向，松手后才能切换；上下调整时选点保持不动。', hint: '上滑变密 · 下滑变疏 · 48px / 档', scene: 'grid' },
  { title: '灰色边缘区，快速跳转', description: '点按波形左右的灰色边缘区，播放位置后退或前进一小节；点按音符轨道两侧的灰色边缘区，可选择边缘落点并将其移入视野。', hint: '上方跳小节 · 下方选落点', scene: 'gutter' },
  { title: '长按波形，从这里播放', description: '点按波形只定位；长按波形，即可从该处开始播放。松手后继续播放，点暂停可停止。', hint: '长按波形 → 播放', scene: 'hold' },
  { title: '选择小节并试听', description: '在全局导航中拖动小节选择循环区间，连续点按同一小节两次可取消选择。长按波形可从该处播放。', hint: '拖动选择 · 双击取消', scene: 'range' }
] : [
  { title: '从一张谱面开始', description: '在文件菜单中新建歌曲后添加难度谱面，或打开已有谱面；需要伴奏时再载入音频。', hint: 'Ctrl+Alt+N / Ctrl+O', scene: 'file' },
  { ...appendLesson, keys: ['Shift+Enter'] },
  { title: '选中落点，键入音符', description: '点击时间轴下方的音符轨道选择落点，按 1–9 写入对应音符，按 0 或 Delete 清空。', hint: '1–9 写入 · 0 / Delete 清空', scene: 'note', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace', 'Delete'] },
  ...scrollLessons,
  { title: '鼠标滚轮，浏览时间轴', description: '将鼠标移到时间轴上，向下滚动向后浏览，向上滚动向前浏览。波形和音符轨道同步移动，全曲概览中的视窗框随之更新；播放位置和音符选点不变。', hint: '向下滚动 → 向后浏览 · 向上滚动 → 向前浏览', scene: 'wheel' },
  { title: 'A / D 移动选中位置', description: '先选择落点，再按 A 向前移动一格，按 D 向后移动一格；移动的是选中位置，不是音符本身。', hint: 'A ← / D →', scene: 'position', keys: ['A', 'D'] },
  { title: 'W / S 调整吸附', description: '按 W 增加吸附等分，网格变密；按 S 减少吸附等分，网格变疏。', hint: 'W / S', scene: 'snap', keys: ['W', 'S'] },
  { title: 'Q / E 跳转播放位置', description: '按 Q 将播放位置后退一小节，按 E 前进一小节；这不会移动选中的音符落点。', hint: 'Q ← / E →', scene: 'seek', keys: ['Q', 'E'] },
  { title: '空格播放与暂停', description: '按空格开始播放，再按一次暂停。播放头前进时，音符选点保持不变。', hint: 'Space', scene: 'play', keys: ['Space'] },
  { title: '选择小节并试听', description: '在全局导航中拖动或 Shift+单击小节选择循环区间；双击任意小节取消选择，按空格播放或暂停。', hint: '双击取消 · Space 播放', scene: 'range' }
]);
const current = computed(() => steps.value[step.value]);
const demo = computed(() => {
  const index = phase.value;
  const scene = current.value.scene;
  const appended = scene === 'append' && index >= 3;
  const noteKey = scene === 'note' ? ['', '', '', '1', 'Backspace', '4', '0', ''][index] : '';
  const noteValue = scene === 'note' ? (index < 3 || index === 7 || noteKey === 'Backspace' ? '0' : noteKey) : '';
  const frame = moveFrame.value;
  const distance = frame < 16 ? 0 : frame <= 64 ? (frame - 16) * 2 : frame < 112 ? (112 - frame) * 2 : 0;
  const moveSteps = frame <= 64 ? Math.floor(distance / 24) : 4 - Math.floor((96 - distance) / 24);
  const gridSteps = frame <= 64 ? Math.floor(distance / 48) : 2 - Math.floor((96 - distance) / 48);
  const rangePosition = Math.max(1, Math.min(3, 1 + (frame - 20) / 24));
  const gutterTarget = ['wave-left', 'wave-right', 'note-left', 'note-right'][Math.floor(index / 2)];
  const gutterPan = index >= 7 ? 100 : index >= 5 ? 18.75 : index >= 3 ? 50 : index >= 1 ? 25 : 0;
  const wheelPan = [0, 12.5, 25, 25, 12.5, 0, 0, 0][index];
  const selection = appended ? 25 : scene === 'wheel' ? 50 : scene === 'position' ? (index >= 1 && index < 4 ? 25 : 37.5) : scene === 'move' ? [37.5, 39.0625, 40.625, 43.75, 46.875][moveSteps] : scene === 'gutter' ? (index >= 7 ? 125 : index >= 5 ? 43.75 : 37.5) : 37.5;
  const playhead = scene === 'wheel' ? 62.5 : scene === 'seek' ? (index >= 1 && index < 4 ? 100 / 3 : 50) : scene === 'gutter' ? (index >= 1 && index < 3 ? 25 : 50) : scene === 'hold' ? [30, 30, 40, 50, 60, 70, 80, 85][index] : scene === 'wave' ? [20, 30, 30, 30, 40, 50, 60, 70][index] : scene === 'play' ? [20, 20, 35, 50, 50, 50, 50, 50][index] : 20;
  return {
    key: scene === 'append' ? (index === 2 ? 'Shift+Enter' : '') : scene === 'note' ? noteKey : index === 1 ? current.value.keys?.[0] : index === 4 ? current.value.keys?.at(-1) : '',
    appended,
    noteValue,
    noteSelected: scene === 'append' ? appended : scene !== 'note' || index >= 2,
    pointerTarget: scene === 'append' ? 'append' : scene === 'file' ? (index < 2 ? 'file' : 'new-file') : scene === 'note' ? (device.value === 'touch' && index >= 3 ? 'palette' : 'track') : ['move', 'grid'].includes(scene) ? 'track' : scene === 'wave' || scene === 'hold' && index < 2 ? 'wave' : scene === 'overview' ? 'overview' : scene === 'gutter' ? gutterTarget : scene === 'range' ? 'measure' : '',
    rangePosition,
    rangeEnd: Math.floor(rangePosition + .5),
    rangePressId: frame < 90 ? 0 : frame < 96 ? 1 : 2,
    rangeSelected: scene === 'range' && frame >= 12 && frame < 96,
    pressed: scene === 'append' ? index === 2 : scene === 'note' ? index === 2 || device.value === 'touch' && Boolean(noteKey) : scene === 'file' ? index === 1 : scene === 'gutter' ? index % 2 === 1 : scene === 'hold' ? index === 0 : scene === 'wave' ? index === 1 || index === 2 : scene === 'overview' ? index === 1 || index >= 3 && index <= 5 : ['move', 'grid'].includes(scene) ? frame >= 16 && frame < 112 : scene === 'range' && (frame >= 12 && frame < 76 || frame >= 90 && frame < 92 || frame >= 96 && frame < 98),
    divisions: scene === 'grid' ? [16, 24, 32][gridSteps] : scene === 'move' ? 32 : scene === 'gutter' ? 16 : scene === 'snap' && index >= 1 && index < 4 ? 12 : 8,
    selection,
    playhead,
    playing: scene === 'play' ? index >= 1 && index < 4 : scene === 'wave' ? index >= 3 : scene === 'hold' && index >= 1,
    adjusting: ['move', 'grid'].includes(scene) && frame >= 16 && frame < 112,
    holding: scene === 'hold' && index === 0,
    pressedGutter: scene === 'gutter' && index % 2 === 1 ? gutterTarget : '',
    pointer: scene === 'note' ? (index === 0 ? 62.5 : 37.5) : ['move', 'grid'].includes(scene) ? 37.5 : 30,
    pointerOffset: scene === 'move' ? distance : 0,
    pointerLift: scene === 'grid' ? distance : 0,
    wheelDirection: scene === 'wheel' ? ([1, 2].includes(index) ? 'forward' : [4, 5].includes(index) ? 'backward' : '') : '',
    overviewPointer: index < 4 ? 24 : index === 4 ? 40 : 56,
    overviewPlayhead: scene === 'overview' ? (index >= 1 ? 24 : 12) : 8 + playhead * .32,
    overviewWindow: appended ? 68 : scene === 'wheel' ? 8 + wheelPan * .32 : scene === 'gutter' ? 8 + gutterPan * .32 : scene === 'overview' ? (index === 0 ? 0 : index < 4 ? 8 : index === 4 ? 24 : 40) : 8,
    panOffset: scene === 'wheel' ? wheelPan : scene === 'gutter' ? gutterPan : scene === 'overview' ? (index < 4 ? 0 : index === 4 ? 16 : 32) : 0,
    notes: appended ? [] : scene === 'move' ? [25, 39.0625, 62.5, 75] : scene === 'note' ? [20, 37.5, 60, 80] : scene === 'gutter' ? [20, 60, 100, 140] : [20, 40, 60, 80],
    noteTypes: scene === 'note' ? ['1', noteValue, '1', '2'] : ['1', '2', '1', '2']
  };
});
const miniNotes = computed(() => {
  const measures = [demo.value.noteTypes.filter(value => !['0', '8'].includes(value)), ['2', '1', '2'], ['1', '1', '2'], ['2', '2', '1'], ['1', '5'], ['2', '1']];
  if (demo.value.appended) measures.push([]);
  return measures;
});
function stopAnimation() { clearInterval(animationTimer); }
watch([device, step, opened], () => {
  stopAnimation(); phase.value = 0; moveFrame.value = 0;
  if (opened.value && device.value) animationTimer = ['move', 'grid', 'range'].includes(current.value.scene)
    ? setInterval(() => { moveFrame.value = (moveFrame.value + 1) % 128; }, 50)
    : setInterval(() => { phase.value = (phase.value + 1) % 8; }, ['hold', 'wave'].includes(current.value.scene) ? 450 : 750);
}, { flush: 'sync' });
onUnmounted(stopAnimation);

function open() {
  device.value = ''; step.value = 0;
  if (!dialog.value.open) dialog.value.showModal();
  opened.value = true;
}
function close() { opened.value = false; dialog.value.close(); }
function remember() {
  opened.value = false;
  try { localStorage.setItem(storageKey, '1'); } catch {}
}
function previous() {
  if (step.value === 0) device.value = '';
  else step.value--;
}
function next() {
  if (step.value === steps.value.length - 1) close();
  else step.value++;
}
onMounted(() => {
  let seen = false;
  try { seen = Boolean(localStorage.getItem(storageKey)); } catch {}
  if (!seen) open();
});
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="welcome-guide" aria-labelledby="guide-title" @close="remember" @keydown.stop>
    <div class="guide-header">
      <span class="guide-brand">DONKANVAS <span>/</span> {{ t('快速上手') }}</span>
      <button class="guide-close" type="button" :aria-label="t('关闭')" :title="t('关闭')" @click="close"><X /></button>
    </div>
    <div v-if="!device" class="guide-body device-screen">
      <p class="guide-eyebrow">{{ t('开始之前') }}</p>
      <h2 id="guide-title">{{ t('你正在使用什么设备？') }}</h2>
      <p class="guide-description">{{ t('选择操作方式，查看适合你的编辑技巧。') }}</p>
      <div class="device-options">
        <button type="button" @click="device = 'touch'"><Smartphone aria-hidden="true" /><span><strong>{{ t('移动设备') }}</strong><small>{{ t('手机 / 平板 · 触屏手势') }}</small></span><ArrowRight aria-hidden="true" /></button>
        <button type="button" @click="device = 'desktop'"><Monitor aria-hidden="true" /><span><strong>{{ t('桌面设备') }}</strong><small>{{ t('电脑 · 键盘与鼠标') }}</small></span><ArrowRight aria-hidden="true" /></button>
      </div>
    </div>
    <div v-else class="guide-body lesson-screen">
      <div class="guide-progress" :aria-label="t('第 {p0} 步，共 {p1} 步', { p0: step + 1, p1: steps.length })"><span v-for="(_, index) in steps" :key="index" :class="{ active: index <= step }"></span></div>
      <div class="guide-illustration" :class="[`scene-${current.scene}`, { 'demo-playing': demo.playing, 'demo-holding': demo.holding }]" :style="{ '--measure-count': miniNotes.length, '--demo-grid': `${100 / demo.divisions}%`, '--demo-selection': `${demo.selection - demo.panOffset}%`, '--demo-playhead': `${demo.playhead - demo.panOffset}%`, '--demo-pan': `${-demo.panOffset}%` }" aria-hidden="true">
        <div class="mock-menu-toolbar">
          <span class="mock-file-trigger">{{ t('文件') }}<GuidePointer v-if="demo.pointerTarget === 'file'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" :style="{ '--pointer-x': phase === 0 ? '80%' : '50%' }" /></span>
          <div v-if="current.scene === 'file' && phase >= 2" class="mock-file-menu"><span>{{ t('新建') }}<GuidePointer v-if="demo.pointerTarget === 'new-file'" :touch="device === 'touch'" :pressed="phase === 3" :press-id="phase" /></span><span>{{ t('打开谱面') }}</span></div>
        </div>
        <div class="mock-content">
          <div v-if="current.scene === 'append'" class="mock-append-toolbar"><span class="mock-append-trigger"><ListPlus />{{ t('末尾追加小节') }}<GuidePointer :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" style="--pointer-x:75%;--pointer-y:65%" /></span></div>
          <div class="mock-timeline">
            <span v-if="demo.appended" class="mock-appended-label">{{ String(miniNotes.length).padStart(3, '0') }}</span>
            <div class="mock-wave"><span class="mock-lane-label">{{ t('时间轴波形') }}</span><div class="mock-wave-bars"><i v-for="index in 84" :key="index" :style="{ height: `${12 + (index * 17 % 32)}%` }"></i></div><span class="mock-gutter left"><ChevronsLeft v-if="demo.pressedGutter === 'wave-left'" /><GuidePointer v-if="demo.pointerTarget === 'wave-left'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" /></span><span class="mock-gutter right"><ChevronsRight v-if="demo.pressedGutter === 'wave-right'" /><GuidePointer v-if="demo.pointerTarget === 'wave-right'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" /></span><GuidePointer v-if="demo.pointerTarget === 'wave'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" style="--pointer-x:30%;--pointer-y:65%" /></div>
            <div class="mock-track"><span class="mock-lane-label">{{ t('音符轨道') }}</span><template v-for="(position, index) in demo.notes" :key="index"><span v-if="demo.noteTypes[index] !== '0'" class="mock-note" :data-note="demo.noteTypes[index]" :style="{ left: `${position - demo.panOffset}%` }"></span></template><span v-if="demo.noteSelected" class="mock-selection"></span><span class="mock-gutter left"><ChevronsLeft v-if="demo.pressedGutter === 'note-left'" /><GuidePointer v-if="demo.pointerTarget === 'note-left'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" /></span><span class="mock-gutter right"><ChevronsRight v-if="demo.pressedGutter === 'note-right'" /><GuidePointer v-if="demo.pointerTarget === 'note-right'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" /></span><div v-if="demo.adjusting" class="mock-adjustment" :class="{ 'mock-grid-adjustment': current.scene === 'grid' }"><template v-if="current.scene === 'grid'"><ChevronsUp /><output>{{ demo.divisions }} {{ t('分') }}</output><ChevronsDown /></template><template v-else><ChevronsLeft /><ChevronsRight /></template></div><GuidePointer v-if="demo.pointerTarget === 'track' && current.scene !== 'grid'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" :style="{ '--pointer-x': `${demo.pointer}%`, '--pointer-offset': `${demo.pointerOffset}px` }" /></div>
            <span class="mock-playhead"></span>
            <GuidePointer v-if="current.scene === 'grid'" touch :pressed="demo.pressed" :press-id="phase" :style="{ '--pointer-x': `${demo.pointer}%`, '--pointer-y': `calc(75% - ${demo.pointerLift}px)` }" />
            <div v-if="current.scene === 'wheel'" class="mock-wheel" :data-direction="demo.wheelDirection"><span class="wheel-mouse"><Mouse /><span v-if="demo.wheelDirection" :key="phase" class="wheel-motion"></span></span><ArrowDown v-if="demo.wheelDirection === 'forward'" /><ArrowUp v-else-if="demo.wheelDirection === 'backward'" /><span v-else class="wheel-idle"></span></div>
          </div>
          <div class="mock-overview-section"><span class="mock-navigation-label">{{ t('全曲概览') }}</span><div class="mock-overview"><i v-for="index in 48" :key="index" :style="{ height: `${18 + (index * 23 % 60)}%` }"></i><span class="mock-overview-window" :style="{ left: `${demo.overviewWindow}%` }"></span><span class="mock-overview-playhead" :style="{ left: `${demo.overviewPlayhead}%` }"></span><GuidePointer v-if="demo.pointerTarget === 'overview'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="phase" :style="{ '--pointer-x': `${demo.overviewPointer}%` }" /></div></div>
          <div v-if="device === 'touch' && current.scene === 'note'" class="mock-palette"><span v-for="type in NOTE_TYPES" :key="type.value" class="mock-palette-slot" :class="{ chosen: demo.pointerTarget === 'palette' && demo.noteValue === type.value }" :title="t(type.name)"><span class="palette-dot" :data-note="type.value"></span><span class="palette-name">{{ t(type.name) }}</span><GuidePointer v-if="demo.pointerTarget === 'palette' && demo.noteValue === type.value" touch :pressed="demo.pressed" :press-id="phase" style="--pointer-y:12px" /></span></div>
          <div class="mock-navigation"><span class="mock-navigation-label">{{ t('全局导航') }}</span><i v-for="(notes, index) in miniNotes" :key="index" class="mock-measure" :class="{ selected: demo.rangeSelected && index >= 1 && index <= demo.rangeEnd, 'has-point': demo.appended && index === miniNotes.length - 1, 'in-view': index >= Math.floor(demo.overviewWindow / 100 * miniNotes.length) && index < Math.ceil((demo.overviewWindow + 32) / 100 * miniNotes.length) }"><span>{{ String(index + 1).padStart(3, '0') }}</span><span class="mock-mini-notes"><b v-for="(note, noteIndex) in notes" :key="noteIndex" class="mini-note" :data-note="note"></b></span></i><GuidePointer v-if="demo.pointerTarget === 'measure'" :touch="device === 'touch'" :pressed="demo.pressed" :press-id="demo.rangePressId" :style="{ '--pointer-x': `calc(${(demo.rangePosition + .5) / 6 * 100}% + ${demo.rangePosition / 6 - 5 / 12} * var(--measure-gap))`, '--pointer-y': 'calc(100% - var(--measure-height) / 2)' }" /></div>
        </div>
        <div class="demo-status"><template v-if="['snap', 'grid'].includes(current.scene)">{{ t('吸附') }} 1/{{ demo.divisions }}</template><Pause v-else-if="demo.playing" /><Play v-else-if="['play', 'hold', 'wave', 'seek', 'gutter'].includes(current.scene)" /><span v-if="demo.holding || current.scene === 'wave' && phase === 2">{{ t('长按') }}</span></div>
      </div>
      <div class="guide-key" :class="{ 'numeric-keys': current.scene === 'note' && current.keys }"><template v-if="current.keys"><kbd v-for="key in current.keys" :key="key" :class="{ pressed: demo.key === key, 'clear-key': ['Backspace', 'Delete'].includes(key) }">{{ key }}</kbd></template><template v-else><Mouse v-if="current.scene === 'wheel'" /><Keyboard v-else-if="device === 'desktop'" /><span>{{ t(current.hint) }}</span></template></div>
      <div class="guide-copy" aria-live="polite">
        <p class="guide-eyebrow">{{ t('第 {p0} 步，共 {p1} 步', { p0: step + 1, p1: steps.length }) }}</p>
        <h2 id="guide-title">{{ t(current.title) }}</h2>
        <p class="guide-description">{{ t(current.description) }}</p>
      </div>
      <div class="guide-actions"><button type="button" class="guide-back" @click="previous"><ArrowLeft />{{ t('上一步') }}</button><button type="button" class="guide-next" @click="next">{{ t(step === steps.length - 1 ? '开始编辑' : '下一步') }}<Check v-if="step === steps.length - 1" /><ArrowRight v-else /></button></div>
    </div>
  </dialog>
</template>

<style scoped>
.welcome-guide{box-sizing:border-box;width:min(560px,calc(100% - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid #cbd9d0;border-radius:8px;background:#fff;color:#20332c;box-shadow:0 20px 70px #14271e55;overflow:auto}.welcome-guide::backdrop{background:#10251c99}.guide-header{height:52px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e3ebe5}.guide-brand{font-size:11px;font-weight:800;letter-spacing:0;color:#3c6654}.guide-brand span{color:#b4c5ba;margin:0 7px}.guide-close{display:grid;place-items:center;width:34px;height:34px;padding:0;border:0;background:transparent;color:#50665a}.guide-close svg,.guide-actions svg{width:17px;height:17px}.guide-body{padding:24px}.guide-eyebrow{margin:0 0 8px;color:#438466;font-size:11px;font-weight:800}.guide-body h2{margin:0;font-size:23px;line-height:1.3}.guide-description{margin:10px 0 0;color:#5a6c61;font-size:14px;line-height:1.7}.device-options{display:grid;gap:10px;margin-top:24px}.device-options button{display:flex;align-items:center;gap:16px;width:100%;min-height:76px;padding:14px 16px;text-align:left;border:1px solid #d5e2d9;border-radius:5px;background:#f8fbf8;color:#284c3b}.device-options button:hover{border-color:#5d9c79;background:#f1f8f3}.device-options button>svg:first-child{width:24px;height:24px}.device-options button>svg:last-child{width:17px;margin-left:auto}.device-options button span{display:grid;gap:5px}.device-options strong{font-size:14px}.device-options small{color:#718379;font-size:12px}.guide-progress{display:flex;gap:5px;margin-bottom:16px}.guide-progress span{height:3px;flex:1;background:#e4ece6}.guide-progress span.active{background:#438d64}.guide-illustration{position:relative;height:180px;overflow:hidden;border:1px solid #d4e4d9;border-radius:5px;background:#edf5ef}.mock-toolbar{height:29px;display:flex;align-items:center;gap:5px;padding:0 12px;border-bottom:1px solid #d9e7dc;background:#fff}.mock-toolbar span{width:6px;height:6px;border-radius:50%;background:#c9d8cd}.mock-toolbar span:first-child{background:#ee8060}.mock-toolbar i{width:36px;height:6px;margin-left:10px;border-radius:3px;background:#e3ebe5}.mock-content{position:absolute;inset:30px 0 0}.mock-wave{height:45%;display:flex;align-items:center;justify-content:space-around;border-bottom:1px solid #d5e3d8}.mock-wave i{width:3px;background:#a5c9b3;border-radius:2px}.mock-track{position:relative;height:32%;display:flex;align-items:center;justify-content:space-evenly;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(12.5% - 1px),#d6e5d9 calc(12.5% - 1px),#d6e5d9 12.5%)}.mock-note{width:20px;height:20px;border:3px solid white;border-radius:50%;box-shadow:0 0 0 1px #b4cabe}.mock-note.red{background:#e8674f}.mock-note.blue{background:#4b9db9}.mock-selection{position:absolute;left:36%;top:3px;bottom:3px;width:2px;background:var(--selection)}.mock-measures{height:23%;display:flex;gap:4px;padding:4px 12px}.mock-measures i{display:grid;place-items:center;flex:1;border:1px solid #d4e2d7;background:#fff;color:#8da397;font-size:9px;font-style:normal}.scene-range .mock-measures i:nth-child(n+2):nth-child(-n+4){background:#d7eee0;border-color:#76aa89}.guide-pointer{position:absolute;left:38%;top:55%;color:#214e38;animation:point 2s ease-in-out infinite}.guide-pointer svg{width:24px;height:24px;fill:white;filter:drop-shadow(0 2px 2px #4c6c5a55)}.touch-dot{display:block;width:22px;height:22px;border:4px solid white;border-radius:50%;background:#39865d;box-shadow:0 0 0 2px #39865d}.scene-file .guide-pointer{left:18%;top:8%}.scene-range .guide-pointer{left:26%;top:75%}.scene-move .guide-pointer,.scene-range .guide-pointer{animation:move 2s ease-in-out infinite}.guide-key{position:absolute;right:10px;bottom:10px;display:flex;align-items:center;gap:6px;max-width:65%;padding:5px 8px;background:#fff;border:1px solid #d7e5da;border-radius:3px;color:#426453;font-size:10px;font-weight:700}.guide-key svg{width:14px;height:14px;flex:none}.guide-copy{min-height:120px;padding-top:20px}.guide-actions{display:flex;justify-content:space-between;gap:10px;margin-top:20px}.guide-actions button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;border-radius:4px;font-weight:700}.guide-back{border:1px solid #d4e0d7;background:#fff;color:#486052}.guide-next{border:1px solid #28734e;background:#28734e;color:#fff}.guide-next:hover{background:#205f40}@keyframes point{0%,100%{transform:translate(0,0)}50%{transform:translate(-5px,-5px)}}@keyframes move{0%,100%{transform:translateX(0)}50%{transform:translateX(65px)}}@media(max-width:480px){.guide-body{padding:18px}.guide-illustration{height:150px}.guide-body h2{font-size:20px}.guide-copy{min-height:110px}}@media(max-height:600px){.guide-header{height:40px}.guide-body{padding:12px 18px}.guide-illustration{height:100px}.guide-copy{min-height:0;padding-top:10px}.guide-actions{margin-top:10px}.guide-description{margin-top:5px}.device-options{margin-top:12px}.device-options button{min-height:56px}}@media(prefers-reduced-motion:reduce){.guide-pointer{animation:none}}
</style>

<style scoped>
.mock-track{background-size:var(--demo-grid) 100%;background-image:linear-gradient(90deg,#c1d5c7 1px,transparent 1px)}
.mock-append-toolbar{height:32px;display:flex;align-items:center;justify-content:flex-end}.mock-append-trigger{position:relative;display:flex;align-items:center;gap:4px;padding:4px 6px;font-size:10px;color:#426453}.mock-append-trigger>svg{width:15px;height:15px}.mock-appended-label{position:absolute;top:3px;left:25%;z-index:3;font-size:10px;color:#687b70}.scene-append .mock-navigation{grid-template-columns:repeat(var(--measure-count),minmax(0,1fr))}.scene-append .mock-navigation>.mock-measure.has-point{border-color:var(--selection-line);color:var(--selection-ink);background:var(--selection-soft)}
.mock-adjustment.mock-grid-adjustment{flex-direction:column;justify-content:center;gap:0;padding:0;color:#e2f5e8}.mock-grid-adjustment svg{width:18px;height:14px;flex-shrink:1;min-height:0}.mock-grid-adjustment output{font-size:11px;line-height:16px;font-weight:700;white-space:nowrap}
.mock-navigation-label{display:flex;align-items:center;flex:0 1 auto;max-width:32%;font-size:10px;font-weight:700;line-height:1.15;color:#426453;overflow-wrap:anywhere}
.guide-key{position:static;width:fit-content;max-width:100%;margin-top:8px;box-sizing:border-box}
.mock-selection{left:var(--demo-selection);transition:left .2s;z-index:2;width:3px;background:var(--selection);box-shadow:0 0 0 3px #2457d626}
.mock-wave{position:relative}.mock-gutter{position:absolute;top:0;bottom:0;width:7%;display:flex;align-items:center;justify-content:center;background:#b9bfbaaa;color:#637368;z-index:1}.mock-gutter.left{left:0}.mock-gutter.right{right:0}.mock-gutter svg{width:16px;height:16px}
.mock-playhead{display:none;position:absolute;top:0;bottom:23%;left:var(--demo-playhead);width:2px;background:#d96b3a;z-index:3;transition:left .65s linear}.scene-seek .mock-playhead,.scene-play .mock-playhead,.scene-hold .mock-playhead,.scene-gutter .mock-playhead{display:block}.scene-seek .mock-playhead,.scene-gutter .mock-playhead{transition:none}
.mock-adjustment{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 22px;background:#0006;color:#75d197;z-index:4}.mock-adjustment svg{width:32px;height:32px;filter:drop-shadow(0 1px 1px white)}
.demo-status{position:absolute;top:5px;right:12px;height:20px;display:flex;align-items:center;gap:8px;font-size:11px;color:#427558}.demo-status svg{width:15px;height:15px}.demo-playing .demo-status{color:#d36431}
.guide-key kbd{display:grid;place-items:center;min-width:28px;height:25px;padding:0 6px;border:1px solid #bbcfc1;border-bottom-width:3px;border-radius:3px;font-size:12px;color:#456452;background:#f8fbf8}.guide-key kbd.pressed{background:#28734e;color:#fff;border-color:#1c573a;transform:translateY(2px)}
.scene-position .guide-pointer,.scene-snap .guide-pointer,.scene-seek .guide-pointer,.scene-play .guide-pointer{display:none}.scene-move .guide-pointer,.scene-gutter .guide-pointer,.scene-hold .guide-pointer{animation:none;left:var(--demo-pointer);transition:left .5s;z-index:5}.scene-gutter .guide-pointer,.scene-hold .guide-pointer{top:29%}.scene-hold.demo-holding .touch-dot{outline:5px solid #39865d44;outline-offset:5px;animation:hold-pulse .75s infinite}.scene-hold:not(.demo-holding) .guide-pointer{opacity:0}.scene-gutter .mock-wave .mock-gutter{background:#8eaa96}.scene-gutter .mock-track .mock-gutter{outline:1px solid #637368}
.scene-gutter .guide-pointer.gutter-note-pointer{top:55%}
.mock-track .mock-note{position:absolute;transform:translateX(-50%)}
.scene-move .guide-pointer{transform:translateX(calc(-50% + var(--demo-pointer-offset)));transition:transform .05s linear}
.scene-move .mock-selection{transform:translateX(-50%);transition:none}
.guide-illustration{height:auto;overflow:hidden}
.mock-menu-toolbar{position:relative;display:flex;align-items:center;gap:5px;height:38px;justify-content:space-between;padding:0 14px;border-bottom:1px solid #d9e7dc;background:#fff}
.mock-menu-toolbar .mock-file-trigger{position:relative;display:grid;place-items:center;flex:none;width:44px;height:30px;font-size:10px;font-weight:700;line-height:1;white-space:nowrap;color:#426453}
.mock-menu-toolbar>.mock-file-trigger{background:#fff;border-radius:0}
.mock-file-menu{position:absolute;top:34px;left:14px;z-index:7;width:126px;padding:4px;border:1px solid #cbd9d0;border-radius:3px;background:#fff;box-shadow:0 3px 8px #214e3822}
.mock-file-menu>span{position:relative;display:flex;align-items:center;width:auto;height:30px;padding:0 10px;border-radius:0;background:transparent;font-size:11px;line-height:1.3;white-space:nowrap;color:#426453}.mock-file-menu>span:first-child{background:#e5f1e8}
.mock-content{position:relative;inset:auto;padding:0 14px 14px}
.mock-timeline{position:relative;height:128px}
.mock-wave{height:64px;padding:0 36px}
.mock-track{height:64px;align-items:center}
.mock-lane-label{position:absolute;top:3px;left:36px;font-size:9px;line-height:1.2;color:#426453;z-index:2;pointer-events:none}
.mock-wave{overflow:hidden;padding:0 36px}
.mock-wave-bars{position:absolute;left:var(--demo-pan);top:0;display:flex;align-items:center;justify-content:space-around;width:250%;height:100%;transition:left .65s ease}
.mock-wave-bars i{flex:none}
.mock-track{overflow:hidden;background-position:var(--demo-pan) 0}
.scene-grid .mock-timeline>.demo-pointer{transition:top .05s linear}
.mock-track .mock-note{transition:left .65s ease}
.scene-wave .mock-playhead{display:block}
.scene-wheel .mock-playhead{display:block;transition:left .65s ease}
.scene-wheel .mock-selection{transition:left .65s ease}
.mock-wheel{position:absolute;left:70%;top:40%;z-index:6;display:flex;align-items:center;gap:4px;width:56px;height:44px;color:#28734e;pointer-events:none}
.wheel-mouse{position:relative;display:grid;place-items:center;width:34px;height:44px;background:#edf5efcc;border-radius:4px}
.wheel-mouse>svg{width:32px;height:40px;fill:#fff}
.mock-wheel>svg,.wheel-idle{width:18px;height:18px;flex:none}
.wheel-motion{position:absolute;left:16px;top:11px;width:3px;height:7px;border-radius:2px;background:#28734e;animation:guide-wheel .65s ease-out both}
.mock-wheel[data-direction="backward"] .wheel-motion{animation-direction:reverse}
@keyframes guide-wheel{from{transform:translateY(-3px);opacity:.4}to{transform:translateY(4px);opacity:1}}
@media(prefers-reduced-motion:reduce){.wheel-motion{animation:none}}
.scene-wave:not(.demo-playing) .mock-playhead,.scene-wave:not(.demo-playing) .mock-overview-playhead{transition:none}
.scene-wave.demo-playing .mock-playhead,.scene-wave.demo-playing .mock-overview-playhead{transition:left .45s linear}
.mock-overview-section{padding-top:8px}
.mock-overview{position:relative;display:flex;align-items:center;justify-content:space-around;height:32px;margin-top:3px;border:1px solid #c1d5c7;background:#f8fbf8}
.mock-overview>i{width:2px;background:#a5c9b3}
.mock-overview-window{position:absolute;top:0;bottom:0;width:32%;box-sizing:border-box;border:1px solid #438d64;background:#65bd8522;transition:left .65s ease}
.mock-overview-playhead{position:absolute;top:0;bottom:0;width:2px;background:#d96b3a;transition:left .3s ease}
.scene-wave .mock-wave,.scene-note .mock-track,.scene-overview .mock-overview{box-shadow:inset 0 0 0 1px #438d64}
.mock-gutter{width:32px}
.mock-playhead{bottom:0}
.mock-track .mock-note{box-sizing:border-box;top:50%;transform:translate(-50%,-50%);background:#e8674f}
.mock-note[data-note="2"],.mock-note[data-note="4"]{background:#4b9db9}
.mock-note[data-note="3"],.mock-note[data-note="4"]{width:27px;height:27px}
.mock-note[data-note="5"],.mock-note[data-note="6"]{width:36px;border-radius:5px;background:#e6b800}
.mock-note[data-note="6"]{height:27px}
.mock-note[data-note="7"]{background:#ee9344}.mock-note[data-note="9"]{background:#d976a1}
.mock-note[data-note="8"]{width:8px;height:26px;border-radius:2px;background:#7a9987}
.mock-navigation{--measure-gap:4px;--measure-height:38px;position:relative;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--measure-gap);height:auto;padding:10px 0 0}
.scene-range .mock-navigation>.demo-pointer{transition:left .05s linear}
.mock-navigation-label{grid-column:1/-1;max-width:none;min-height:18px;font-size:10px}
.mock-navigation>.mock-measure{position:relative;display:flex;align-items:center;flex-direction:column;justify-content:center;gap:4px;height:38px;min-width:0;padding:3px 0;border:1px solid #d4e2d7;background:#fff;color:#8da397;font-size:9px;font-style:normal;line-height:1;box-sizing:border-box}
.mock-navigation>.mock-measure.selected{box-shadow:inset 0 2px var(--selection)}
.mock-measure.in-view .mock-mini-notes{background:#dceee2;box-shadow:0 0 0 3px #dceee2;border-radius:2px}
.mock-mini-notes{display:flex;align-items:center;justify-content:center;gap:2px;height:9px;max-width:100%}
.mini-note{display:block;flex:none;width:3px;height:7px;border-radius:1px;background:#e8674f}
.mini-note[data-note="2"],.mini-note[data-note="4"]{background:#4b9db9}.mini-note[data-note="3"],.mini-note[data-note="4"]{height:9px}
.mini-note[data-note="5"],.mini-note[data-note="6"]{width:8px;background:#d2ae17}.mini-note[data-note="7"]{background:#ee9344}.mini-note[data-note="9"]{background:#d976a1}
.mock-palette{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;padding-top:10px}.mock-palette .mock-palette-slot{position:relative;display:flex;align-items:center;flex-direction:column;gap:5px;min-width:0;min-height:48px;padding:5px 2px;border:1px solid #d4e2d7;border-radius:3px;background:#fff}.mock-palette .mock-palette-slot.chosen{border-color:var(--green);background:#edf7f0}
.palette-name{font-size:10px;line-height:1.2;text-align:center;overflow-wrap:anywhere;max-width:100%}
.mock-palette .palette-dot{box-sizing:border-box;width:10px;height:10px;border-radius:50%;background:#e8674f}.palette-dot[data-note="2"],.palette-dot[data-note="4"]{background:#4b9db9}.palette-dot[data-note="5"],.palette-dot[data-note="6"]{border-radius:2px;background:#d2ae17}.palette-dot[data-note="7"]{background:#ee9344}.palette-dot[data-note="8"]{width:3px;background:#7a9987}.palette-dot[data-note="9"]{background:#d976a1}.palette-dot[data-note="0"]{border:1px dashed #7a9987;background:transparent}
.mock-palette .palette-dot{flex:none;margin:2px 0}
.mock-palette .palette-dot[data-note="3"],.mock-palette .palette-dot[data-note="4"]{width:14px;height:14px;margin:0}
.mock-palette .palette-dot[data-note="5"]{width:16px}.mock-palette .palette-dot[data-note="6"]{width:20px;height:14px;margin:0}
.mock-palette .palette-dot[data-note="A"],.mock-palette .palette-dot[data-note="B"]{width:14px;height:14px;margin:0;box-shadow:inset 0 0 0 2px #fff,0 0 0 1px #e8674f}
.mock-palette .palette-dot[data-note="B"]{background:#4b9db9;box-shadow:inset 0 0 0 2px #fff,0 0 0 1px #4b9db9}
.guide-key.numeric-keys{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));width:100%;gap:4px}
.guide-key.numeric-keys kbd{min-width:0;padding:0;height:28px}
.guide-key.numeric-keys .clear-key{grid-column:span 6}
.guide-key.numeric-keys .clear-key.pressed{grid-column:span 6}
@media(max-width:480px){.guide-key.numeric-keys{grid-template-columns:repeat(6,minmax(0,1fr))}.guide-key.numeric-keys .clear-key,.guide-key.numeric-keys .clear-key.pressed{grid-column:span 3}}
.scene-move :deep(.demo-pointer){transition:left .05s linear}
.scene-note :deep(.pointer-cursor){fill:#fff}
@media(max-height:600px){.mock-timeline{height:104px}.mock-wave,.mock-track{height:52px}.mock-content{padding-bottom:10px}.mock-navigation{--measure-gap:3px;--measure-height:32px;padding-top:6px}.mock-navigation>.mock-measure{height:32px}.mock-menu-toolbar{height:34px}}
@keyframes hold-pulse{from{outline-offset:1px}to{outline-offset:7px}}
@media(prefers-reduced-motion:reduce){.mock-selection,.mock-playhead,.mock-track .mock-note,.mock-wave-bars,.mock-overview-window,.mock-overview-playhead{transition:none!important}}
</style>