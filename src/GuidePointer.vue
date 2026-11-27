<script setup>
import { MousePointer2 } from '@lucide/vue';

defineProps({ touch: Boolean, pressed: Boolean, pressId: { type: Number, default: 0 } });
</script>

<template>
  <span class="demo-pointer" :class="{ touch, pressed }" aria-hidden="true">
    <span v-if="pressed" :key="pressId" class="pointer-ripple"></span>
    <span v-if="touch" class="pointer-finger"></span><MousePointer2 v-else class="pointer-cursor" />
  </span>
</template>

<style scoped>
.demo-pointer{position:absolute;left:calc(var(--pointer-x,50%) + var(--pointer-offset,0px));top:var(--pointer-y,50%);z-index:6;width:24px;height:24px;transform:translate(-3px,-3px);transition:left .35s ease,top .35s ease;pointer-events:none;color:#214e38}
.demo-pointer.touch{transform:translate(-50%,-50%)}
.pointer-cursor{display:block;width:24px;height:24px;fill:#fff;filter:drop-shadow(0 2px 2px #4c6c5a55);transform-origin:3px 3px}
.pointer-finger{position:absolute;inset:2px;box-sizing:border-box;border:3px solid #fff;border-radius:50%;background:#39865d;box-shadow:0 0 0 2px #39865d}
.pressed .pointer-cursor{transform:scale(.84)}.pressed .pointer-finger{background:#1b603d;transform:scale(.85)}
.pointer-ripple{position:absolute;left:3px;top:3px;width:36px;height:36px;box-sizing:border-box;border:2px solid #28734e;border-radius:50%;background:#65bd8533;animation:guide-click .65s ease-out both}
.touch .pointer-ripple{left:12px;top:12px}
@keyframes guide-click{from{transform:translate(-50%,-50%) scale(.3);opacity:1}to{transform:translate(-50%,-50%) scale(1.25);opacity:0}}
@media(prefers-reduced-motion:reduce){.demo-pointer{transition:none!important}.pointer-ripple{animation:none;transform:translate(-50%,-50%);opacity:.65}}
</style>