<script setup lang="ts">
// 题型菜单（issue #217）：分组展示，图标 + 名称 + 一句话说明。加题入口与卡片
// 换题型共用；单份 markup，手机档 CSS 换形为底部弹层（不 v-if 双实例），弹层
// 加高可滚动（15 种题型一屏放不下）。
// 浮层由宿主容器自绘（isolation 内 1–99 层），不与 PrimeVue 浮层抢 z-index。
// 悬挂菜单是误触根源：打开期间监听全局 pointerdown（锚点外）/Esc/滚动（捕获，
// 画布内滚动也算）即关；手机档底部弹层带 scrim，点 scrim 关闭。
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlignLeft,
  CalendarDays,
  ChevronsUpDown,
  Clock,
  Circle,
  Hash,
  Image,
  Images,
  ListChecks,
  ListOrdered,
  Rows3,
  SlidersHorizontal,
  SquareCheck,
  Star,
  StickyNote,
  Table,
  Table2,
  ThumbsUp,
} from "lucide-vue-next";
import type { Component } from "vue";

import type { SurveyQuestion } from "../../contracts/index.js";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ select: [type: SurveyQuestion["type"]]; close: [] }>();
const { t } = useI18n();

type TypeItem = {
  value: SurveyQuestion["type"];
  icon: Component;
  key: string;
  hintKey: string;
};
const GROUPS: Array<{ labelKey: string; items: TypeItem[] }> = [
  {
    labelKey: "surveys.typeGroup.choice",
    items: [
      { value: "single", icon: Circle, key: "surveys.type.single", hintKey: "surveys.typeHint.single" },
      { value: "multiple", icon: SquareCheck, key: "surveys.type.multiple", hintKey: "surveys.typeHint.multiple" },
      { value: "image_single", icon: Image, key: "surveys.type.image_single", hintKey: "surveys.typeHint.image_single" },
      { value: "image_multiple", icon: Images, key: "surveys.type.image_multiple", hintKey: "surveys.typeHint.image_multiple" },
      { value: "dropdown", icon: ChevronsUpDown, key: "surveys.type.dropdown", hintKey: "surveys.typeHint.dropdown" },
      { value: "ranking", icon: ListOrdered, key: "surveys.type.ranking", hintKey: "surveys.typeHint.ranking" },
    ],
  },
  {
    labelKey: "surveys.typeGroup.text",
    items: [
      { value: "text", icon: AlignLeft, key: "surveys.type.text", hintKey: "surveys.typeHint.text" },
      { value: "multi_text", icon: ListChecks, key: "surveys.type.multi_text", hintKey: "surveys.typeHint.multi_text" },
      { value: "number", icon: Hash, key: "surveys.type.number", hintKey: "surveys.typeHint.number" },
    ],
  },
  {
    labelKey: "surveys.typeGroup.scale",
    items: [
      { value: "scale", icon: SlidersHorizontal, key: "surveys.type.scale", hintKey: "surveys.typeHint.scale" },
      { value: "rating", icon: Star, key: "surveys.type.rating", hintKey: "surveys.typeHint.rating" },
      { value: "nps", icon: ThumbsUp, key: "surveys.type.nps", hintKey: "surveys.typeHint.nps" },
    ],
  },
  {
    labelKey: "surveys.typeGroup.matrix",
    items: [
      { value: "matrix_single", icon: Table, key: "surveys.type.matrix_single", hintKey: "surveys.typeHint.matrix_single" },
      { value: "matrix_multiple", icon: Table2, key: "surveys.type.matrix_multiple", hintKey: "surveys.typeHint.matrix_multiple" },
      { value: "matrix_text", icon: Rows3, key: "surveys.type.matrix_text", hintKey: "surveys.typeHint.matrix_text" },
    ],
  },
  {
    labelKey: "surveys.typeGroup.datetime",
    items: [
      { value: "date", icon: CalendarDays, key: "surveys.type.date", hintKey: "surveys.typeHint.date" },
      { value: "time", icon: Clock, key: "surveys.type.time", hintKey: "surveys.typeHint.time" },
    ],
  },
  {
    labelKey: "surveys.typeGroup.other",
    items: [
      { value: "statement", icon: StickyNote, key: "surveys.type.statement", hintKey: "surveys.typeHint.statement" },
    ],
  },
];

const rootRef = ref<HTMLElement | null>(null);

// max-height 内部滚动无可视提示（PM 审判）：按 scrollTop 挂上/下渐隐，滚动
// 到底后撤掉，用户看得出清单还能滚。
const fadeTop = ref(false);
const fadeBottom = ref(false);
function updateFades() {
  const el = rootRef.value;
  if (!el) return;
  fadeTop.value = el.scrollTop > 1;
  fadeBottom.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

// role=menu 的键盘义务：方向键在 menuitem 间移动焦点，Home/End 跳首尾
// （Enter/Space 是原生按钮行为，不接管）。焦点已在菜单内才响应，不抢焦点。
function onMenuKeydown(event: KeyboardEvent) {
  const el = rootRef.value;
  if (!el) return;
  const items = Array.from(
    el.querySelectorAll<HTMLButtonElement>(".type-item"),
  );
  const current = document.activeElement instanceof Element
    ? items.indexOf(document.activeElement as HTMLButtonElement)
    : -1;
  if (current === -1) return;
  let next = -1;
  if (event.key === "ArrowDown") next = (current + 1) % items.length;
  else if (event.key === "ArrowUp")
    next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return;
  event.preventDefault();
  items[next]!.focus();
  // 焦点滚动后更新渐隐。
  requestAnimationFrame(updateFades);
}

// 点外关闭的区域是整个 .menu-anchor（含触发按钮）：按钮上的 pointerdown 交给
// 宿主的 toggle，不在这里抢先关闭。PrimeVue 浮层（确认弹窗等）里的 pointerdown
// 不参与关闭判定：弹窗盖在菜单上方，关掉弹窗应回到原菜单。
function onDocPointerDown(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest(".p-dialog-mask,.p-overlay-mask"))
    return;
  const region = rootRef.value?.closest(".menu-anchor") ?? rootRef.value;
  if (region && !region.contains(event.target as Node)) emit("close");
}
function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}
// 捕获阶段收滚动：菜单定位不随滚动重算，滚走即关，不留悬空浮层。
// 菜单自身内容超出 max-height 可滚（18 种题型一屏放不下）：滚动源在菜单内
// 是读清单的正常操作，不能当成「滚走」关掉。
function onDocScroll(event: Event) {
  if (event.target instanceof Node && rootRef.value?.contains(event.target)) return;
  emit("close");
}
function listen(listen_: boolean) {
  if (typeof document === "undefined") return;
  if (listen_) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeydown, true);
    document.addEventListener("scroll", onDocScroll, true);
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
    document.removeEventListener("scroll", onDocScroll, true);
  }
}
watch(
  () => props.open,
  (open) => {
    listen(open);
    if (open) void nextTick(updateFades);
    else {
      fadeTop.value = false;
      fadeBottom.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => listen(false));
</script>
<template>
  <template v-if="open">
    <div class="type-menu-scrim" aria-hidden="true" @click="emit('close')" />
    <div
      ref="rootRef"
      class="survey-type-menu"
      role="menu"
      @scroll.passive="updateFades"
      @keydown="onMenuKeydown"
    >
      <span
        v-if="fadeTop"
        class="type-menu-fade type-menu-fade--top"
        aria-hidden="true"
      />
      <span
        v-if="fadeBottom"
        class="type-menu-fade type-menu-fade--bottom"
        aria-hidden="true"
      />
      <div v-for="group in GROUPS" :key="group.labelKey" class="type-group">
        <span class="type-group__label" role="presentation">{{
          t(group.labelKey)
        }}</span>
        <button
          v-for="item in group.items"
          :key="item.value"
          type="button"
          role="menuitem"
          class="type-item"
          @click="emit('select', item.value)"
        >
          <component :is="item.icon" :size="16" class="type-icon" />
          <span class="type-text"
            ><strong>{{ t(item.key) }}</strong>
            <small>{{ t(item.hintKey) }}</small
          ></span>
        </button>
      </div>
    </div>
  </template>
</template>
<style scoped>
.type-menu-scrim {
  display: none;
}
.survey-type-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 250px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-overlay, var(--color-surface-base));
  box-shadow: var(--shadow-md);
}
/* 滚动渐隐：钉在菜单可视区上下缘，提示清单还没滚到底（内部滚动的可视提示）。 */
.type-menu-fade {
  position: sticky;
  flex: none;
  display: block;
  height: 14px;
  pointer-events: none;
  z-index: 1;
}
.type-menu-fade--top {
  top: 0;
  margin-bottom: -14px;
  background: linear-gradient(
    to bottom,
    var(--color-surface-overlay, var(--color-surface-base)),
    transparent
  );
}
.type-menu-fade--bottom {
  bottom: 0;
  margin-top: -14px;
  background: linear-gradient(
    to top,
    var(--color-surface-overlay, var(--color-surface-base)),
    transparent
  );
}
.type-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-block: 3px;
}
.type-group + .type-group {
  border-top: 1px solid var(--color-border-subtle);
  margin-top: 3px;
  padding-top: 6px;
}
.type-group__label {
  padding: 0 9px 3px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-quaternary, var(--color-text-tertiary));
}
.type-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text-secondary);
  text-align: start;
  cursor: pointer;
}
.type-item:hover,
.type-item:focus-visible {
  background: var(--color-bg-soft);
  color: var(--color-text-primary);
}
.type-icon {
  flex: none;
  margin-top: 2px;
  color: var(--color-text-tertiary);
}
.type-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.type-text strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.type-text small {
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-tertiary);
}
@media (max-width: 767.98px) {
  .type-menu-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 19;
    background: var(--material-mask);
  }
  .survey-type-menu {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    position: fixed;
    z-index: 20;
    min-width: 0;
    max-height: min(72vh, 620px);
    border-radius: var(--radius-lg, 14px) var(--radius-lg, 14px) 0 0;
    padding-bottom: max(5px, env(safe-area-inset-bottom));
  }
}
</style>
