<script setup>
import { computed, inject, nextTick, reactive, ref } from 'vue';
import { GitBranch, ListFilter, X, LocateFixed, Plus, Trash2 } from '@lucide/vue';
import { t } from './i18n.js';
import { BRANCH_ROUTES, BRANCH_ROUTE_NAMES as names } from './chart.js';
import SectionHeading from './SectionHeading.vue';
import MeasureGrid from './MeasureGrid.vue';

const studio = inject('studio'), { state, bar } = studio;
const dialog = ref(null), list = ref(null);
const filterDialog = ref(null), filterList = ref(null);
const mode = ref(''), target = ref(null), error = ref(''), first = ref(null), last = ref(null), anchor = ref(null);
const fields = reactive({ condition: 'p', lower: 50, upper: 80, route: 'N', source: 'shared', keep: '' });
const branches = computed(() => state.chart?.branches || []);
const editedBranch = computed(() => branches.value.find(branch => branch.index === target.value));
const selectedMeasures = computed(() => first.value === null ? [] : state.chart.bars.slice(first.value, last.value + 1));
const selection = computed(() => first.value === null ? null : [first.value + 1, last.value + 1]);
const current = computed(() => branches.value.find(branch => branch.index === bar.value?.branchIndex));
const uniform = computed(() => {
  const routes = state.branchRoutes.filter(Boolean);
  return routes.length && routes.every(route => route === routes[0]) ? routes[0] : null;
});
const available = computed(() => BRANCH_ROUTES.filter(route => branches.value.some(branch => branch.routes.length) && branches.value.every(branch => !branch.routes.length || branch.routes.includes(route))));
const sortedBranches = computed(() => [...branches.value].sort((a, b) => a.firstBarIndex - b.firstBarIndex || a.index - b.index));
function branchLabel(branch) {
  return branch.barCount ? t('{p0}-{p1} 小节（共 {p2} 小节）', { p0: branch.firstBarIndex + 1, p1: branch.firstBarIndex + branch.barCount, p2: branch.barCount }) : t('空分歧');
}
function routeNoteCount(branch, route) {
  return state.chart.allBars.filter(item => item.branchIndex === branch.index && item.route === route)
    .reduce((sum, item) => sum + [...item.notes].filter(note => note !== '0').length, 0);
}
function conditionLabel(branch) {
  const { condition, lower, upper } = branchCondition(branch);
  if (condition === 'p') return t('精度：普通 < {p0}% · 玄人 {p0}%–<{p1}% · 达人 ≥ {p1}%', { p0: lower, p1: upper });
  if (condition === 'r') return t('连打数：普通 < {p0} · 玄人 {p0}–<{p1} · 达人 ≥ {p1}', { p0: lower, p1: upper });
  if (condition === 's') return t('分数：普通 < {p0} · 玄人 {p0}–<{p1} · 达人 ≥ {p1}', { p0: lower, p1: upper });
  return branch.value;
}
async function open() {
  studio.pause(); mode.value = ''; error.value = ''; dialog.value.showModal();
  await nextTick();
  const row = list.value.querySelector('[aria-current="true"]');
  if (row) list.value.scrollTop = row.offsetTop - list.value.offsetTop;
}
async function openFilter() {
  studio.pause(); filterDialog.value.showModal();
  await nextTick();
  const row = filterList.value.querySelector('[aria-current="true"]');
  if (row) filterList.value.scrollTop = row.offsetTop - filterList.value.offsetTop;
}
function create() {
  mode.value = 'create'; error.value = ''; first.value = last.value = anchor.value = null;
  Object.assign(fields, { condition: 'p', lower: 50, upper: 80, route: 'N', source: 'shared' });
}
function chooseMeasure(index) {
  error.value = '';
  if (anchor.value === null) {
    first.value = last.value = anchor.value = index;
    return;
  }
  chooseRange(Math.min(anchor.value, index) + 1, Math.max(anchor.value, index) + 1);
}
function chooseRange(start, end) {
  error.value = '';
  if (state.chart.bars.slice(start - 1, end).some(item => item.branchIndex !== null)) {
    error.value = t('所选小节已被分歧覆盖，请选择连续的共用小节。'); return;
  }
  first.value = start - 1; last.value = end - 1; anchor.value = null;
}
function branchCondition(branch) {
  const [condition, lower, upper] = branch.value.split(',').map(part => part.trim());
  return { condition, lower: Number(lower), upper: Number(upper) };
}
function updateCondition(branch, field, value) {
  error.value = '';
  const operation = { type: 'condition', ...branchCondition(branch), [field]: field === 'condition' ? value : value.trim() === '' ? NaN : Number(value) };
  if (!studio.applyMeasureBranch(operation, branch.firstBarIndex)) error.value = state.notice;
}
function edit(branch, action, route = 'N') {
  target.value = branch.index; mode.value = action; error.value = '';
  Object.assign(fields, branchCondition(branch), { route, source: branch.route, keep: branch.route ?? '' });
}
function removeRoute(branch, route) {
  const prompt = branch.routes.length === 1 ? t('删除最后一条路线将同时删除分歧，原小节保留为空白共用小节。是否继续？') : t('删除路线 {p0} 及其内容？可撤销恢复。', { p0: t(names[route]) });
  if (!confirm(prompt)) return;
  error.value = '';
  if (!studio.applyMeasureBranch({ type: 'route', route, clearLast: true }, branch.firstBarIndex)) error.value = state.notice;
}
function submit() {
  error.value = '';
  let operation, measure = editedBranch.value?.firstBarIndex;
  if (mode.value === 'create') {
    if (!selectedMeasures.value.length) { error.value = t('请先选择有效的小节。'); return; }
    measure = first.value;
    operation = { type: 'create', last: last.value, route: fields.route, empty: fields.source === '', condition: fields.condition, lower: Number(fields.lower), upper: Number(fields.upper) };
  } else if (mode.value === 'route') {
    operation = { type: 'route', route: fields.route, source: fields.source || null };
  } else if (mode.value === 'remove') {
    operation = { type: 'remove', keep: fields.keep || null };
  } else return;
  if (studio.applyMeasureBranch(operation, measure)) mode.value = '';
  else error.value = state.notice;
}
function locate(branch, owner) {
  studio.select(branch.firstBarIndex);
  if (owner) owner.close();
}
function keydown(event) {
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); event.stopPropagation();
    if (event.currentTarget === dialog.value && mode.value) { mode.value = ''; error.value = ''; }
    else event.currentTarget.close();
  }
}
</script>

<template>
  <section class="branch-context" :aria-label="t('分歧路线')" @keydown.space.stop @keydown.left.stop @keydown.right.stop>
    <SectionHeading class="branch-caption" :icon="GitBranch" :title="t('谱面分歧')">
      <span class="branch-count">{{ branches.length }}</span>
      <template #description><p class="branch-current"><template v-if="current"><span v-if="current.route" class="branch-route-tag" :data-route="current.route">{{ t(names[current.route]) }}</span> {{ branchLabel(current) }} · {{ conditionLabel(current) }}</template><template v-else>{{ t('当前位于共用段') }}</template></p></template>
    </SectionHeading>
    <div class="branch-actions">
      <button id="branch-filter" type="button" class="manage-branches" :disabled="state.invalid || !branches.length" @click="openFilter"><ListFilter aria-hidden="true" />{{ t('路线筛选') }}</button>
      <button id="branch-manage" type="button" class="manage-branches" :disabled="state.invalid" @click="open"><GitBranch aria-hidden="true" />{{ t('全局分歧管理') }}</button>
    </div>
    <dialog ref="filterDialog" class="branch-dialog branch-filter-dialog" aria-labelledby="branch-filter-title" @keydown="keydown">
      <div class="branch-dialog-heading"><div><h2 id="branch-filter-title">{{ t('路线筛选') }}</h2><p>{{ t('仅切换显示和试听路线，不修改分歧结构。') }}</p></div><button type="button" class="icon" :title="t('关闭')" :aria-label="t('关闭')" @click="filterDialog.close()"><X /></button></div>
      <fieldset class="branch-uniform">
        <legend>{{ t('统一路线') }}</legend>
        <div class="route-segments" role="radiogroup" :aria-label="t('统一路线')">
          <label v-for="route in BRANCH_ROUTES" :key="route" :title="available.includes(route) ? t(names[route]) : t('部分分歧没有路线 {p0}，请展开逐处选择。', { p0: t(names[route]) })">
            <input :id="`branch-all-${route}`" type="radio" name="branch-route-all" :checked="uniform === route" :disabled="state.invalid || !available.includes(route)" @change="studio.changeAllBranches(route)">
            <span>{{ t(names[route]) }}</span>
          </label>
        </div>
      </fieldset>
      <div ref="filterList" class="branch-route-list" role="group" :aria-label="t('逐处分歧路线')">
        <article v-for="branch in sortedBranches" :key="branch.index" class="branch-route-row" :aria-current="current?.index === branch.index ? 'true' : undefined">
          <div class="branch-row-heading">
            <button type="button" class="branch-jump" :aria-label="t('定位 {p0}', { p0: branchLabel(branch) })" @click="locate(branch, filterDialog)"><span><strong>{{ branchLabel(branch) }}</strong><small>{{ conditionLabel(branch) }}</small></span><LocateFixed /></button>
            <div class="route-segments individual-routes" role="radiogroup" :aria-label="branchLabel(branch)">
              <label v-for="route in BRANCH_ROUTES" :key="route" :title="t(names[route])"><input :id="`branch-route-${branch.index}-${route}`" type="radio" :name="`branch-route-${branch.index}`" :aria-label="`${branchLabel(branch)} · ${t(names[route])}`" :checked="branch.route === route" :disabled="state.invalid || !branch.routes.includes(route)" @change="studio.changeBranch(branch.index, route)"><span>{{ t(names[route]) }}</span></label>
            </div>
          </div>
        </article>
        <p v-if="!sortedBranches.length" class="no-branches">{{ t('暂无分歧。') }}</p>
      </div>
      <div class="branch-dialog-footer"><span>{{ t('手动选路，不模拟命中率或得分判定。') }}</span></div>
    </dialog>
    <dialog ref="dialog" class="branch-dialog" aria-labelledby="branch-dialog-title" @keydown="keydown">
      <div class="branch-dialog-heading"><div><h2 id="branch-dialog-title">{{ t('全局分歧管理') }}</h2><p>{{ t('创建、删除分歧及路线，编辑判定条件。') }} {{ t('BPM、拍号和延迟在所有路线的对应小节及落点同步；分歧小节数量与时长始终一致。') }}</p></div><button type="button" class="icon" :title="t('关闭')" :aria-label="t('关闭')" @click="dialog.close()"><X /></button></div>
      <form v-if="mode" class="branch-form" @submit.prevent="submit">
        <fieldset :disabled="state.invalid">
          <legend>{{ mode === 'create' ? t('创建分歧') : mode === 'route' ? t('创建路线 {p0}', { p0: fields.route }) : t('删除整个分歧') }}</legend>
          <template v-if="mode === 'create'">
            <p class="selection-help">{{ t('点击首尾小节、拖动或 Shift+单击选择区间；已被分歧覆盖的小节不可选。') }}</p>
            <MeasureGrid class="branch-measure-grid" role="group" :aria-label="t('选择小节')" :bars="state.chart.bars" :selection="selection" :anchor-index="anchor" :disabled="state.invalid" :unavailable="item => item.branchIndex !== null" :measure-title="item => item.branchIndex === null ? t('第 {p0} 小节', { p0: item.index + 1 }) : branchLabel(branches[item.branchIndex])" @activate="chooseMeasure" @select="chooseRange" />
            <output class="branch-selection">{{ first === null ? t('请先选择有效的小节。') : t('已选小节：{p0}–{p1}', { p0: first + 1, p1: last + 1 }) }}</output>
          </template>
          <div v-if="mode === 'create' || mode === 'route'" :class="{ 'branch-source-fields': mode === 'create' }">
            <label v-if="mode === 'create'">{{ t('首条路线') }}<select id="branch-initial-route" v-model="fields.route"><option v-for="route in BRANCH_ROUTES" :key="route" :value="route">{{ route }} · {{ t(names[route]) }}</option></select></label>
            <label>{{ t('音符来源') }}<select id="branch-source" v-model="fields.source"><option value="">{{ t('空白（保留小节和指令）') }}</option><option v-if="mode === 'create'" value="shared">{{ t('复制所选共用小节') }}</option><template v-else><option v-for="route in editedBranch.routes" :key="route" :value="route">{{ t('复制路线 {p0}', { p0: route }) }} · {{ t(names[route]) }}</option></template></select></label>
          </div>
          <div v-if="mode === 'create'" class="branch-condition-fields">
            <label>{{ t('分歧条件') }}<select id="branch-condition" v-model="fields.condition"><option value="p">{{ t('精度（p）') }}</option><option value="r">{{ t('连打数（r）') }}</option><option value="s">{{ t('分数（s）') }}</option></select></label>
            <label>{{ t('第一阈值') }}<input id="branch-lower" v-model.number="fields.lower" type="number" step="any" required></label>
            <label>{{ t('第二阈值') }}<input id="branch-upper" v-model.number="fields.upper" type="number" step="any" required></label>
          </div>
          <template v-if="mode === 'remove'">
            <p>{{ t('删除分歧后保留小节和指令，可选择保留一条路线的音符，或全部清空。') }}</p>
            <label>{{ t('保留音符') }}<select id="branch-keep" v-model="fields.keep"><option value="">{{ t('不保留任何路线的音符') }}</option><option v-for="route in editedBranch.routes" :key="route" :value="route">{{ route }} · {{ t(names[route]) }}</option></select></label>
          </template>
          <p v-if="error || state.error" class="branch-route-error" role="alert">{{ error || state.notice }}</p>
          <div class="branch-form-actions"><button type="button" @click="mode = ''; error = ''">{{ t('取消') }}</button><button id="branch-apply" type="submit" :disabled="mode === 'create' && !selectedMeasures.length">{{ mode === 'remove' ? t('删除整个分歧') : t('确定') }}</button></div>
        </fieldset>
      </form>
      <div v-show="!mode">
      <button id="branch-create" type="button" class="branch-create" :disabled="state.invalid" @click="create"><Plus />{{ t('创建分歧') }}</button>
      <div ref="list" class="branch-route-list">
        <article v-for="branch in sortedBranches" :key="branch.index" class="branch-route-row" :aria-current="current?.index === branch.index ? 'true' : undefined">
          <div class="branch-row-heading">
          <button type="button" class="branch-jump" :aria-label="t('定位 {p0}', { p0: branchLabel(branch) })" @click="locate(branch)"><span><strong>{{ branchLabel(branch) }}</strong><small>{{ conditionLabel(branch) }}</small></span><LocateFixed /></button>
          <button type="button" class="icon" :disabled="state.invalid || !branch.barCount" :title="t('删除整个分歧')" :aria-label="t('删除整个分歧')" @click="edit(branch, 'remove')"><Trash2 /></button>
          </div>
          <fieldset class="branch-condition-fields inline-condition" :aria-label="t('分歧条件')" :disabled="state.invalid || !branch.barCount">
            <label>{{ t('分歧条件') }}<select :value="branchCondition(branch).condition" @change="updateCondition(branch, 'condition', $event.target.value)"><option value="p">{{ t('精度（p）') }}</option><option value="r">{{ t('连打数（r）') }}</option><option value="s">{{ t('分数（s）') }}</option></select></label>
            <label>{{ t('第一阈值') }}<input :value="branchCondition(branch).lower" type="number" step="any" required @change="updateCondition(branch, 'lower', $event.target.value)"></label>
            <label>{{ t('第二阈值') }}<input :value="branchCondition(branch).upper" type="number" step="any" required @change="updateCondition(branch, 'upper', $event.target.value)"></label>
          </fieldset>
          <div class="branch-route-cards">
            <component :is="branch.routes.includes(route) ? 'div' : 'button'" v-for="route in BRANCH_ROUTES" :key="route" class="branch-route-card" :data-route="route" :class="{ missing: !branch.routes.includes(route) }" :type="branch.routes.includes(route) ? undefined : 'button'" :disabled="!branch.routes.includes(route) && (state.invalid || !branch.barCount)" :aria-label="branch.routes.includes(route) ? undefined : t('创建路线 {p0}', { p0: route })" @click="!branch.routes.includes(route) && edit(branch, 'route', route)">
              <strong>{{ route }} · {{ t(names[route]) }}<span v-if="branch.routes.includes(route)" class="route-note-count">{{ t('音符数：{p0}', { p0: routeNoteCount(branch, route) }) }}</span><span v-else class="route-status">{{ t('点击创建') }}</span></strong>
              <button v-if="branch.routes.includes(route)" type="button" class="route-remove" :disabled="state.invalid || !branch.barCount" :title="t('删除路线 {p0}', { p0: route })" :aria-label="t('删除路线 {p0}', { p0: route })" @click="removeRoute(branch, route)"><X /></button>
              <Plus v-else aria-hidden="true" />
            </component>
          </div>
        </article>
        <p v-if="!sortedBranches.length" class="no-branches">{{ t('暂无分歧。') }}</p>
      </div>
      </div>
      <p v-if="!mode && (error || state.error)" class="branch-route-error" role="alert">{{ error || state.notice }}</p>
    </dialog>
  </section>
</template>

<style scoped>
.branch-actions{display:flex;flex-basis:100%;flex-wrap:wrap;gap:8px}
.branch-actions>.manage-branches{min-height:32px;padding:5px 10px}
.branch-caption .branch-current{margin:0}
.branch-dialog-heading>.icon{border:0}
.branch-source-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.branch-source-fields select{box-sizing:border-box;max-width:none}
.branch-form .branch-route-error{color:#bd3b30}
.branch-condition-fields select{max-width:none}
.inline-condition{border:0;padding:0;margin:0;min-width:0}.inline-condition label{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px}.inline-condition input,.inline-condition select{box-sizing:border-box;width:100%;min-width:0;height:34px}
.branch-route-cards{border-top:1px solid var(--line);padding-top:12px}
.branch-route-tag[data-route=N],.branch-route-card[data-route=N]{--route-color:#50565d;--route-missing-border:#9aa0a6;--route-hover-background:#f1f2f3}
.branch-route-tag[data-route=E],.branch-route-card[data-route=E]{--route-color:#245c91;--route-missing-border:#81a6cd;--route-hover-background:#eaf3fc}
.branch-route-tag[data-route=M],.branch-route-card[data-route=M]{--route-color:#983968;--route-missing-border:#cb87aa;--route-hover-background:#fbeaf4}
.branch-route-tag{display:inline-block;padding:0 5px;border-radius:4px;color:var(--route-color);background:var(--route-hover-background);font-weight:600}
.branch-route-card[data-route=N]:not(.missing){background:#f1f2f3;border-color:#a3a8ae;color:var(--route-color)}
.branch-route-card[data-route=E]:not(.missing){background:#eaf3fc;border-color:#96b9df;color:var(--route-color)}
.branch-route-card[data-route=M]:not(.missing){background:#fbeaf4;border-color:#d99abd;color:var(--route-color)}
.branch-route-card.missing{text-align:left}
.branch-route-card.missing:is(:hover,:focus-visible):not(:disabled){background:var(--route-hover-background);border-color:var(--route-color)}
.branch-route-card .route-remove{width:28px;min-height:28px;border:0;background:transparent;color:inherit}
.branch-route-card .route-remove:hover:not(:disabled){background:#ffffff80}
.branch-route-card:not(.missing){border-style:solid;box-shadow:inset 3px 0 currentColor}
.route-note-count,.route-status{display:block;margin-top:4px;font-size:10px;font-weight:400}
.branch-uniform{border:0;padding:0;margin:0 0 16px;min-width:0}.branch-uniform legend{font-size:12px;font-weight:600;margin-bottom:8px}.branch-uniform .route-segments span{min-width:0}.branch-row-heading{flex-wrap:wrap}.branch-row-heading>.branch-jump{min-width:130px}
.branch-route-row{flex-direction:column;align-items:stretch!important}.branch-row-heading{display:flex;align-items:center;gap:6px;min-width:0}.branch-row-heading>.icon{flex-shrink:0}.branch-route-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:8px}.branch-route-card{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff}.branch-route-card.missing{border-style:dashed;background:#fdfdfd;border-color:var(--route-missing-border);color:var(--route-color)}.branch-route-card.missing strong{font-weight:400}.branch-route-card strong{font-size:12px;overflow-wrap:anywhere}.branch-route-card button{flex-shrink:0;font-size:11px;padding:5px}.branch-route-card svg,.branch-create svg{width:14px;height:14px}.branch-jump .branch-measures{display:flex;flex-wrap:wrap;gap:4px 12px}.branch-measures>span{white-space:nowrap}.branch-create{margin-bottom:12px}.branch-form fieldset{border:0;padding:0;margin:0;min-width:0}.branch-form legend{font-weight:600;margin-bottom:12px}.branch-form label{display:flex;flex-direction:column;gap:6px;font-size:12px;margin:12px 0;min-width:0}.branch-form input,.branch-form select{width:100%;min-width:0;height:34px}.branch-form p{font-size:12px;line-height:1.6;color:var(--muted)}.branch-condition-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.branch-measure-grid{max-height:32vh;overflow:auto;padding:4px;border:1px solid var(--line);border-radius:8px}.branch-selection{display:block;font-size:12px;margin-top:10px;color:var(--green)}.branch-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.branch-caption>div{min-width:0}.branch-caption .branch-current{overflow-wrap:anywhere}
.branch-context{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin:0;padding:8px 12px;border-bottom:1px solid var(--line);background:#fff}.branch-caption{display:flex;align-items:center;gap:10px;flex:1;min-width:215px}.branch-emblem{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--green);background:#e2eee5;flex-shrink:0}.branch-emblem svg{width:18px;height:18px}.branch-heading{display:flex;align-items:center;gap:8px}.branch-heading strong{font-size:13px;font-weight:600}.branch-count{font-size:10px;padding:1px 6px;border-radius:9px;background:#e4ece6;color:#55715e}.branch-caption p{font-size:11px;color:var(--muted);margin:4px 0 0}.mixed-route{font-size:10px;color:#946d28;background:#f9edcf;padding:2px 6px;border-radius:4px}.route-segments{display:flex;gap:3px;padding:3px;background:#e4ece6;border:1px solid #d6e2d9;border-radius:8px}.route-segments label{position:relative;cursor:pointer;flex:1}.route-segments input{position:absolute;width:1px;height:1px;opacity:0}.route-segments span{display:flex;gap:6px;align-items:center;justify-content:center;min-width:74px;padding:6px 12px;font-size:12px;border-radius:5px;color:#687b6c;white-space:nowrap}.route-segments b{font-size:10px;opacity:.7}.route-segments input:checked+span{color:#fff;background:var(--green);box-shadow:0 1px 3px #174a2d24}.route-segments input:focus-visible+span{outline:2px solid #2457d6;outline-offset:2px}.route-segments input:disabled+span{opacity:.35;cursor:not-allowed}.manage-branches{font-size:12px;background:#fff}.manage-branches svg{width:15px;height:15px}.branch-context-foot{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;flex-basis:100%;font-size:10px;color:var(--muted);padding-top:2px}.branch-context-foot>span:first-child{color:#5d7464}
.branch-dialog{width:min(660px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;border:1px solid var(--line);border-radius:12px;padding:22px;color:var(--ink)}.branch-dialog::backdrop{background:#202a2870}.branch-dialog-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.branch-dialog h2{margin:0;font-size:18px}.branch-dialog-heading p{margin:8px 0 16px;font-size:12px;line-height:1.6;color:var(--muted)}.branch-route-list{position:relative;max-height:min(50vh,420px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--line);border-radius:8px}.branch-route-row{display:flex;align-items:center;gap:10px;padding:9px 10px}.branch-route-row+.branch-route-row{border-top:1px solid #edf1ed}.branch-route-row[aria-current=true]{background:#edf5ee;box-shadow:inset 3px 0 var(--green)}.branch-jump{display:flex;flex:1;gap:10px;border:0;background:transparent;padding:4px;text-align:left;justify-content:flex-start;min-width:0}.branch-jump>span:nth-child(2){min-width:0}.branch-jump strong{display:block;font-size:12px;font-weight:500}.branch-jump small{display:block;margin-top:3px;color:var(--muted);font-size:10px;overflow-wrap:anywhere}.branch-jump>svg{width:14px;height:14px;color:#98aa9d;margin-left:auto;flex-shrink:0}.branch-number{display:grid;place-items:center;border:1px solid #dce5de;background:#fff;border-radius:7px;min-width:29px;height:29px;font-size:11px;color:var(--green)}.individual-routes{flex-shrink:0}.individual-routes span{min-width:30px;padding:5px 8px;font-size:11px}.branch-dialog-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px}.branch-dialog-footer>span{font-size:11px;color:var(--muted)}.no-branches{padding:24px;text-align:center;color:var(--muted)}.branch-route-error{font-size:12px;color:#bd3b30}
@media(max-width:600px){.branch-caption{flex-basis:100%}.branch-context>.route-segments{flex:1}.branch-context>.route-segments span{min-width:0;padding:7px 8px;font-size:11px}.manage-branches{padding:8px}.branch-context-foot{font-size:10px}.branch-dialog{padding:16px}.branch-route-row{padding:8px;gap:5px}.branch-jump{gap:7px}.branch-number{min-width:25px;height:25px}.branch-jump>svg{display:none}.individual-routes span{min-width:25px;padding:5px}.branch-dialog-footer{align-items:flex-start}}
</style>
