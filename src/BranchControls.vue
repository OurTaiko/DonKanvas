<script setup>
import { computed, inject, nextTick, ref } from 'vue';
import { GitBranch, ListFilter, Search, X, LocateFixed } from '@lucide/vue';
import { t } from './i18n.js';
import { BRANCH_ROUTES, BRANCH_ROUTE_NAMES as names } from './chart.js';

const studio = inject('studio'), { state, bar } = studio;
const dialog = ref(null), search = ref(null), list = ref(null), query = ref('');
const branches = computed(() => state.chart?.branches || []);
const current = computed(() => branches.value.find(branch => branch.index === bar.value?.branchIndex));
const uniform = computed(() => {
  const routes = state.branchRoutes.filter(Boolean);
  return routes.length && routes.every(route => route === routes[0]) ? routes[0] : null;
});
const available = computed(() => BRANCH_ROUTES.filter(route => branches.value.some(branch => branch.routes.length) && branches.value.every(branch => !branch.routes.length || branch.routes.includes(route))));
const filtered = computed(() => {
  const value = query.value.trim().toLowerCase();
  return branches.value.filter(branch => `${t('分歧 {p0}', { p0: branch.index + 1 })} #${branch.index + 1} ${branch.value}`.toLowerCase().includes(value));
});
async function open() {
  studio.pause(); query.value = ''; dialog.value.showModal();
  await nextTick(); search.value.focus();
  const row = list.value.querySelector('[aria-current="true"]');
  if (row) list.value.scrollTop = row.offsetTop - list.value.offsetTop;
}
function locate(branch) { studio.select(branch.firstBarIndex); dialog.value.close(); }
function keydown(event) {
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); event.stopPropagation(); dialog.value.close();
  }
}
</script>

<template>
  <section v-if="branches.length" class="branch-context" :aria-label="t('分歧路线')" @keydown.space.stop @keydown.left.stop @keydown.right.stop>
    <div class="branch-caption">
      <span class="branch-emblem"><GitBranch /></span>
      <div><div class="branch-heading"><strong>{{ t('分歧路线') }}</strong><span class="branch-count">{{ branches.length }}</span><span v-if="!uniform" class="mixed-route">{{ t('自定义路线') }}</span></div><p class="branch-current">{{ current ? `${t('分歧 {p0}', { p0: current.index + 1 })} · ${current.route ? t(names[current.route]) : '—'} · ${current.value}` : t('当前位于共用段') }}</p></div>
    </div>
    <div class="route-segments" role="radiogroup" :aria-label="t('统一路线')">
      <label v-for="route in BRANCH_ROUTES" :key="route" :title="available.includes(route) ? t(names[route]) : t('部分分歧没有路线 {p0}，请展开逐处选择。', { p0: t(names[route]) })">
        <input :id="`branch-all-${route}`" type="radio" name="branch-route-all" :checked="uniform === route" :disabled="state.invalid || !available.includes(route)" @change="studio.changeAllBranches(route)">
        <span>{{ t(names[route]) }}</span>
      </label>
    </div>
    <button id="branch-manage" class="manage-branches" :disabled="state.invalid" @click="open"><ListFilter />{{ t('逐处设置') }}</button>
    <dialog ref="dialog" class="branch-dialog" aria-labelledby="branch-dialog-title" @keydown="keydown">
      <div class="branch-dialog-heading"><div><h2 id="branch-dialog-title">{{ t('逐处分歧路线') }}</h2><p>{{ t('更改路线立即生效；点击定位可跳到对应小节。') }}</p></div><button type="button" class="icon" :title="t('关闭')" :aria-label="t('关闭')" @click="dialog.close()"><X /></button></div>
      <label class="branch-search"><Search /><input ref="search" v-model="query" type="search" :placeholder="t('搜索编号或判定条件')" :aria-label="t('搜索编号或判定条件')"></label>
      <div ref="list" class="branch-route-list">
        <article v-for="branch in filtered" :key="branch.index" class="branch-route-row" :aria-current="current?.index === branch.index ? 'true' : undefined">
          <button type="button" class="branch-jump" :aria-label="t('定位分歧 {p0}', { p0: branch.index + 1 })" @click="locate(branch)"><span class="branch-number">{{ branch.index + 1 }}</span><span><strong>{{ t('分歧 {p0}', { p0: branch.index + 1 }) }}</strong><small>{{ t('从第 {p0} 小节开始', { p0: branch.firstBarIndex + 1 }) }} · {{ branch.value }}</small></span><LocateFixed /></button>
          <div class="route-segments individual-routes" role="radiogroup" :aria-label="t('分歧 {p0}', { p0: branch.index + 1 })">
            <label v-for="route in BRANCH_ROUTES" :key="route" :title="t(names[route])"><input :id="`branch-route-${branch.index}-${route}`" type="radio" :name="`branch-route-${branch.index}`" :aria-label="`${t('分歧 {p0}', { p0: branch.index + 1 })} · ${t(names[route])}`" :checked="branch.route === route" :disabled="state.invalid || !branch.routes.includes(route)" @change="studio.changeBranch(branch.index, route)"><span>{{ t(names[route]) }}</span></label>
          </div>
        </article>
        <p v-if="!filtered.length" class="no-branches">{{ t('没有匹配的分歧。') }}</p>
      </div>
      <p v-if="state.error" class="branch-route-error" role="alert">{{ state.notice }}</p>
      <div class="branch-dialog-footer"><span>{{ t('手动选路，不模拟命中率或得分判定。') }}</span><button type="button" @click="dialog.close()">{{ t('完成') }}</button></div>
    </dialog>
  </section>
</template>

<style scoped>
.branch-caption>div{min-width:0}.branch-caption .branch-current{overflow-wrap:anywhere}
.branch-context{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin:0;padding:8px 12px;border-bottom:1px solid var(--line);background:#fff}.branch-caption{display:flex;align-items:center;gap:10px;flex:1;min-width:215px}.branch-emblem{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--green);background:#e2eee5;flex-shrink:0}.branch-emblem svg{width:18px;height:18px}.branch-heading{display:flex;align-items:center;gap:8px}.branch-heading strong{font-size:13px;font-weight:600}.branch-count{font-size:10px;padding:1px 6px;border-radius:9px;background:#e4ece6;color:#55715e}.branch-caption p{font-size:11px;color:var(--muted);margin:4px 0 0}.mixed-route{font-size:10px;color:#946d28;background:#f9edcf;padding:2px 6px;border-radius:4px}.route-segments{display:flex;gap:3px;padding:3px;background:#e4ece6;border:1px solid #d6e2d9;border-radius:8px}.route-segments label{position:relative;cursor:pointer;flex:1}.route-segments input{position:absolute;width:1px;height:1px;opacity:0}.route-segments span{display:flex;gap:6px;align-items:center;justify-content:center;min-width:74px;padding:6px 12px;font-size:12px;border-radius:5px;color:#687b6c;white-space:nowrap}.route-segments b{font-size:10px;opacity:.7}.route-segments input:checked+span{color:#fff;background:var(--green);box-shadow:0 1px 3px #174a2d24}.route-segments input:focus-visible+span{outline:2px solid #2457d6;outline-offset:2px}.route-segments input:disabled+span{opacity:.35;cursor:not-allowed}.manage-branches{font-size:12px;background:#fff}.manage-branches svg{width:15px;height:15px}.branch-context-foot{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;flex-basis:100%;font-size:10px;color:var(--muted);padding-top:2px}.branch-context-foot>span:first-child{color:#5d7464}
.branch-dialog{width:min(660px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;border:1px solid var(--line);border-radius:12px;padding:22px;color:var(--ink)}.branch-dialog::backdrop{background:#202a2870}.branch-dialog-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.branch-dialog h2{margin:0;font-size:18px}.branch-dialog-heading p{margin:8px 0 16px;font-size:12px;line-height:1.6;color:var(--muted)}.branch-search{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:7px;padding:8px 10px;margin-bottom:12px}.branch-search svg{width:16px;height:16px;color:var(--muted);flex-shrink:0}.branch-search input{border:0;outline:0;min-width:0;width:100%;background:transparent;font-size:13px}.branch-search:focus-within{outline:2px solid var(--green);outline-offset:1px}.branch-route-list{position:relative;max-height:min(50vh,420px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--line);border-radius:8px}.branch-route-row{display:flex;align-items:center;gap:10px;padding:9px 10px}.branch-route-row+.branch-route-row{border-top:1px solid #edf1ed}.branch-route-row[aria-current=true]{background:#edf5ee;box-shadow:inset 3px 0 var(--green)}.branch-jump{display:flex;flex:1;gap:10px;border:0;background:transparent;padding:4px;text-align:left;justify-content:flex-start;min-width:0}.branch-jump>span:nth-child(2){min-width:0}.branch-jump strong{display:block;font-size:12px;font-weight:500}.branch-jump small{display:block;margin-top:3px;color:var(--muted);font-size:10px;overflow-wrap:anywhere}.branch-jump>svg{width:14px;height:14px;color:#98aa9d;margin-left:auto;flex-shrink:0}.branch-number{display:grid;place-items:center;border:1px solid #dce5de;background:#fff;border-radius:7px;min-width:29px;height:29px;font-size:11px;color:var(--green)}.individual-routes{flex-shrink:0}.individual-routes span{min-width:30px;padding:5px 8px;font-size:11px}.branch-dialog-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px}.branch-dialog-footer>span{font-size:11px;color:var(--muted)}.no-branches{padding:24px;text-align:center;color:var(--muted)}.branch-route-error{font-size:12px;color:#bd3b30}
@media(max-width:600px){.branch-caption{flex-basis:100%}.branch-context>.route-segments{flex:1}.branch-context>.route-segments span{min-width:0;padding:7px 8px;font-size:11px}.manage-branches{padding:8px}.branch-context-foot{font-size:10px}.branch-dialog{padding:16px}.branch-route-row{padding:8px;gap:5px}.branch-jump{gap:7px}.branch-number{min-width:25px;height:25px}.branch-jump>svg{display:none}.individual-routes span{min-width:25px;padding:5px}.branch-dialog-footer{align-items:flex-start}}
</style>
