<script setup>
import { inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Info, CircleAlert, X, AudioLines } from '@lucide/vue';
import { t, formatMessage } from './i18n.js';

const { notifications } = inject('studio');
const emit = defineEmits(['load-audio']);
const host = ref(null);
const target = ref(document.body);
function updateTarget() {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  target.value = document.activeElement?.closest('dialog[open]') || dialogs.at(-1) || document.body;
}
// Native modals make elements outside their DOM subtree inert, including popovers.
const dialogObserver = new MutationObserver(updateTarget);
onMounted(() => { updateTarget(); dialogObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] }); });
onUnmounted(() => dialogObserver.disconnect());
watch([() => notifications.items.at(-1)?.id, target], async ([id]) => {
  if (id === undefined) return;
  await nextTick();
  const element = host.value?.$el;
  if (!element?.showPopover) return;
  if (element.matches(':popover-open') && document.querySelector('dialog[open]')) element.hidePopover();
  if (!element.matches(':popover-open')) element.showPopover();
}, { flush: 'post', immediate: true });
function resumeAfterPointer(event, id) {
  if (!event.currentTarget.contains(document.activeElement)) notifications.resume(id);
}
function resumeAfterFocus(event, id) {
  if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover')) notifications.resume(id);
}
</script>

<template>
  <Teleport :to="target">
    <TransitionGroup ref="host" name="global-message" tag="div" class="global-messages" popover="manual">
      <div v-for="item in notifications.items" :key="item.id" class="global-message" :class="{ error: item.error }" :role="item.error ? 'alert' : 'status'" :aria-live="item.error ? 'assertive' : 'polite'" aria-atomic="true" @mouseenter="notifications.pause(item.id)" @mouseleave="resumeAfterPointer($event, item.id)" @focusin="notifications.pause(item.id)" @focusout="resumeAfterFocus($event, item.id)">
        <CircleAlert v-if="item.error" aria-hidden="true" /><Info v-else aria-hidden="true" />
        <div class="global-message-content">
          <p>{{ formatMessage(item.message) }}</p>
          <button v-if="item.action?.type === 'load-audio'" type="button" class="message-action" @click="emit('load-audio', item.action.documentId)"><AudioLines aria-hidden="true" />{{ t('载入音频') }}</button>
        </div>
        <button type="button" class="icon message-dismiss" :title="t('关闭提示')" :aria-label="t('关闭提示')" @click="notifications.dismiss(item.id)"><X aria-hidden="true" /></button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.global-messages{position:fixed;left:auto;top:auto;right:0;bottom:env(safe-area-inset-bottom,0px);z-index:1000;display:flex;flex-direction:column;gap:10px;width:min(452px,100vw);max-height:calc(100dvh - 16px);margin:0;padding:16px;border:0;background:transparent;overflow:auto;pointer-events:none}
.global-messages[popover]:not(:popover-open){display:none}
.global-message{--message-control-size:28px;display:flex;align-items:flex-start;gap:10px;flex-shrink:0;min-width:0;max-height:min(360px,60dvh);overflow:auto;padding:12px;border:1px solid #b9d2c2;border-radius:8px;background:#edf5ef;color:var(--ink);box-shadow:0 4px 20px #202a2826;pointer-events:auto;font-size:12px;line-height:1.6}
.global-message.error{border-color:#efb9b2;background:#fff0ed;color:#bd352b}
.global-message>svg{flex-shrink:0;width:18px;height:18px;margin-top:calc((var(--message-control-size) - 18px)/2)}
.global-message-content{flex:1;min-width:0;padding-block:calc((var(--message-control-size) - 1lh)/2)}.global-message-content p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:inherit;font:inherit}
.global-message .message-dismiss{flex-shrink:0;width:var(--message-control-size);min-width:var(--message-control-size);height:var(--message-control-size);min-height:var(--message-control-size);padding:5px;border:0;background:transparent;color:inherit}
.global-message .message-dismiss>svg{width:18px;height:18px}
.global-message .message-action{position:relative;margin-top:6px;min-height:28px;padding:2px 8px;border:1px solid #95b9a9;border-radius:4px;background:transparent;color:var(--green);font:inherit}
.global-message .message-action>svg{width:14px;height:14px}
.global-message-move,.global-message-enter-active,.global-message-leave-active{transition:transform .25s ease,opacity .25s ease}
.global-message-enter-from,.global-message-leave-to{opacity:0;transform:translateY(30px)}
.global-message-leave-active{position:absolute;right:16px;width:calc(100% - 32px)}
@media(prefers-reduced-motion:reduce){.global-message-move,.global-message-enter-active,.global-message-leave-active{transition:none}}
/* Expand the touch target without enlarging the visible action button. */
@media(pointer:coarse){.global-message{--message-control-size:44px}.global-message .message-action::after{content:"";position:absolute;top:50%;left:0;right:0;height:44px;transform:translateY(-50%)}}
</style>
