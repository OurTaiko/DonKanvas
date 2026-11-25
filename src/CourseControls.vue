<script setup>
import { computed, inject, reactive, ref } from 'vue';
import { ChevronDown, Layers, Plus, UserRound, UsersRound, X } from '@lucide/vue';
import { t } from './i18n.js';
import { COURSE_NAMES, courseLabel, variantLabel, courseLevel, courseLevelLimit } from './courses.js';
import StarRating from './StarRating.vue';
import DifficultyIcon from './DifficultyIcon.vue';

const studio = inject('studio'), { state } = studio;
const dialog = ref(null), tree = ref(null), list = ref(null), mode = ref('create'), error = ref('');
const draft = reactive({ course: 'Oni', player: 'single', index: 0 });
const groups = computed(() => {
  const result = new Map();
  for (const variant of state.chart?.variants || []) {
    if (!result.has(variant.key)) result.set(variant.key, { key: variant.key, course: variant.course, variants: [] });
    result.get(variant.key).variants.push(variant);
  }
  return [...result.values()];
});
const courseOptions = computed(() => [
  ...COURSE_NAMES.map(course => groups.value.find(group => group.course === course) || { key: course.toLowerCase(), course, variants: [] }),
  ...groups.value.filter(group => !COURSE_NAMES.includes(group.course))
]);
const active = computed(() => state.chart?.variant);
const ratings = computed(() => new Map((state.chart?.variants || []).map(variant => [variant.index, courseLevel(state.text, variant.index)])));
const level = computed(() => active.value && !state.invalid ? ratings.value.get(state.course) : 0);
const deletionTarget = computed(() => state.chart?.variants[draft.index]);
const title = computed(() => mode.value === 'create' ? t('创建谱面') : t('删除所选谱面'));
const ratingLabel = entry => !entry.variant ? t('谱面不存在') : entry.level === null ? t('未设置星级') : t('{p0} 星', { p0: entry.level });
function entries(group) {
  return ['single', 'P1', 'P2', 'shared'].flatMap(player => {
    const variants = group.variants.filter(variant => variant.player === player);
    return variants.length ? variants.map(variant => {
      const rating = ratings.value.get(variant.index);
      return { player, variant, level: Number.isFinite(rating) && rating > 0 ? rating : null };
    }) : player === 'shared' ? [] : [{ player, variant: null, level: null }];
  });
}
function chooseEntry(group, entry) {
  if (entry.variant) { studio.changeCourse(entry.variant.index); return; }
  draft.course = group.course; draft.player = entry.player; open('create');
}
function beginDelete(variant) { draft.index = variant.index; open('delete'); }
function open(next) { studio.pause(); mode.value = next; error.value = ''; dialog.value.showModal(); }
function focusTree() {
  list.value.open = true;
  const target = tree.value.querySelector('.tree-mode.selected') ?? tree.value.querySelector('.tree-mode:not(:disabled)') ?? tree.value.querySelector('.tree-course-name');
  target.closest('.difficulty-group').open = true;
  target.scrollIntoView({ block: 'nearest' }); target.focus({ preventScroll: true });
}
defineExpose({ focusTree });
function apply() {
  const success = mode.value === 'create'
    ? studio.createCourse({ course: draft.course, player: draft.player, style: draft.player === 'single' ? 'Single' : 'Double', level: 1 })
    : studio.removeCourse(draft.index);
  if (success) { dialog.value.close(); return true; }
  error.value = state.notice; return false;
}
function keydown(event) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopPropagation();
    if (mode.value === 'delete') { error.value = t('请使用确认按钮删除难度。'); return; }
    if (!event.repeat && apply()) void studio.saveChart(event.shiftKey);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.stopPropagation();
  } else if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); event.stopPropagation(); dialog.value.close();
  }
}
</script>

<template>
  <section class="course-context" :aria-label="t('难度与模式')" @keydown.space.stop @keydown.left.stop @keydown.right.stop @keydown.up.stop @keydown.down.stop @keydown.delete.stop @keydown.backspace.stop>
    <details ref="list" class="course-list" open>
    <summary class="workspace-section-summary"><Layers aria-hidden="true" /><b>{{ t('难度与模式') }}</b><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
    <div class="course-list-content">
    <div v-if="active" class="tree-rating"><StarRating id="course-level" :key="`${state.activeId}:${state.course}`" :model-value="level" :max="courseLevelLimit(active.course)" :disabled="state.invalid" @update:model-value="studio.setLevel"><template #default="{ value }"><div class="tree-rating-label"><span>{{ courseLabel(active.course) }} · {{ variantLabel(active) }}</span><output class="tree-rating-value" :aria-label="t('星级')">★{{ Number.isFinite(value) && value > 0 ? value : '—' }}</output></div></template></StarRating></div>
    <nav ref="tree" :aria-label="t('难度与模式')">
      <ul class="difficulty-tree">
        <li v-for="group in courseOptions" :key="group.key" class="tree-course">
          <details class="difficulty-group" open>
          <summary class="tree-course-name" :class="{ missing: !group.variants.length }"><ChevronDown aria-hidden="true" /><DifficultyIcon :course="group.course" /><b>{{ courseLabel(group.course) }}</b></summary>
          <ul>
            <li v-for="entry in entries(group)" :key="entry.variant?.index ?? entry.player" class="tree-row">
              <button class="tree-mode" :class="{ missing: !entry.variant, selected: entry.variant && state.course === entry.variant.index }" :data-course="group.key" :data-player="entry.player" :aria-current="entry.variant && state.course === entry.variant.index ? 'true' : undefined" :aria-label="`${courseLabel(group.course)} · ${variantLabel(entry)} · ${ratingLabel(entry)}`" :disabled="state.invalid" @click="chooseEntry(group, entry)">
                <UserRound v-if="entry.player === 'single'" /><UsersRound v-else /><span class="tree-mode-label">{{ variantLabel(entry) }}</span><span v-if="entry.variant" class="tree-level" :title="ratingLabel(entry)" aria-hidden="true">★{{ entry.level ?? '—' }}</span><Plus v-if="!entry.variant" class="missing-mark" :aria-label="t('谱面不存在')" />
              </button>
              <button v-if="entry.variant" class="tree-remove" :data-course="group.key" :data-player="entry.player" :title="t('删除 {p0} 的 {p1} 谱面', { p0: courseLabel(group.course), p1: variantLabel(entry) })" :aria-label="t('删除 {p0} 的 {p1} 谱面', { p0: courseLabel(group.course), p1: variantLabel(entry) })" :disabled="state.invalid" @click.stop="beginDelete(entry.variant)"><X aria-hidden="true" /></button>
            </li>
          </ul>
          </details>
        </li>
      </ul>
    </nav>
    </div>
    </details>
    <dialog ref="dialog" class="course-dialog" aria-labelledby="course-dialog-title" @keydown="keydown">
      <form @submit.prevent="apply">
        <h2 id="course-dialog-title">{{ title }}</h2>
        <p v-if="mode === 'create'">{{ t('是否创建 {p0} 的 {p1} 谱面？将创建空白谱面，多人星级沿用同难度已有多人谱，否则默认为 1 星。', { p0: courseLabel(draft.course), p1: variantLabel(draft) }) }}</p>
        <p v-else>{{ t('是否删除 {p0} 的 {p1} 谱面？仅删除这张谱面，其他模式不变，可撤销恢复。', { p0: courseLabel(deletionTarget?.course), p1: deletionTarget ? variantLabel(deletionTarget) : '' }) }}</p>
        <p v-if="error" class="course-error" role="alert">{{ error }}</p>
        <div class="course-dialog-actions"><button type="button" @click="dialog.close()">{{ t('取消') }}</button><button id="course-confirm" type="submit" :class="mode === 'delete' ? 'danger' : 'primary'" :disabled="mode === 'delete' && !deletionTarget">{{ mode === 'delete' ? t('确认删除') : t('创建谱面') }}</button></div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.course-context{padding:0;border-bottom:1px solid var(--line)}.course-list-content{padding:0 14px 14px}.tree-course-name{list-style:none}.tree-course-name::-webkit-details-marker{display:none}.difficulty-group:not([open])>.tree-course-name>svg{transform:rotate(-90deg)}.tree-course-name:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.tree-rating{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-bottom:12px;padding:10px 0;border-bottom:1px solid var(--line)}.tree-rating-label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:11px;color:var(--green)}.tree-rating-label>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-rating-value{flex-shrink:0;font-variant-numeric:tabular-nums}
.difficulty-tree,.difficulty-tree ul{list-style:none;padding:0;margin:0}.difficulty-tree ul{margin-left:10px;padding-left:9px;border-left:1px solid #dfe7e1}.tree-course+.tree-course{margin-top:8px}.tree-course-name{display:flex;align-items:center;gap:6px;min-height:28px;font-size:12px;cursor:pointer}.tree-course-name>svg{width:13px;height:13px}.tree-course-name.missing{color:#8e9b93}.tree-course-name.missing .difficulty-icon{opacity:.5}
.tree-row{position:relative}.tree-mode{display:flex;align-items:center;justify-content:flex-start;gap:7px;width:100%;min-height:29px;padding:5px 30px 5px 8px;border:0;border-radius:5px;background:transparent;text-align:left;font-size:12px}.tree-mode svg{width:14px;height:14px;flex-shrink:0}.tree-mode-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-level{font-size:11px;white-space:nowrap;flex-shrink:0;font-variant-numeric:tabular-nums}.tree-mode.missing{color:#96a49b;padding-right:8px}.tree-mode .missing-mark{width:12px;height:12px;margin-left:auto}.tree-row:hover .tree-mode:not(:disabled){background:#e8efea;color:var(--green)}.tree-mode.selected{background:#e0ede4;color:var(--green);font-weight:600}.tree-mode:focus-visible{outline:2px solid var(--green);outline-offset:1px}
.tree-remove{position:absolute;right:2px;top:2px;min-height:24px;width:24px;padding:4px;border:0;background:transparent;color:var(--muted);opacity:0;pointer-events:none}.tree-remove svg{width:13px;height:13px}.tree-row:hover .tree-remove,.tree-row:focus-within .tree-remove{opacity:1;pointer-events:auto}.tree-remove:hover:not(:disabled){background:#fae7e4;color:#bd3b30}.tree-remove:focus-visible{outline:2px solid var(--green);outline-offset:-1px}
@media(hover:none){.tree-remove{opacity:1;pointer-events:auto}}
.course-dialog{--dialog-width:480px}.course-error{color:#bd3b30!important}
</style>
