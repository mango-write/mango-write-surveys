<script setup lang="ts">
// 问卷工作台三岛壳（主站 ModuleShell + WorkspaceShell 的包内轻量承接）：
// 左岛 = tab 行 + 面板槽，中岛原位渲染，右岛 = 宿主注入的 Copilot 岛组件
// （无 copilot 宿主不出右栏）。栏几何/激活 tab 走 useSurveysLayoutPrefs——
// 宿主实现了持久化就交给宿主，缺省包内本地单例。
import { computed, ref, watch } from "vue";
import type { Component } from "vue";

import { useSurveysHost, useSurveysLayoutPrefs } from "../host.js";

export interface SurveyShellTab {
  id: string;
  label: string;
  icon?: Component;
}

const props = defineProps<{ tabs: SurveyShellTab[] }>();
const host = useSurveysHost();
const prefs = useSurveysLayoutPrefs({
  activeLeftTab: props.tabs[0]?.id ?? "",
  leftRailWidth: 300,
  rightRailWidth: 360,
});

// tab 集变化时激活 tab 不在集内（首挂/热切换）：回落第一项。
const activeTab = ref(
  props.tabs.some((tab) => tab.id === prefs.activeLeftTab.value)
    ? prefs.activeLeftTab.value
    : (props.tabs[0]?.id ?? ""),
);
watch(
  () => props.tabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.id === activeTab.value))
      activeTab.value = tabs[0]?.id ?? "";
  },
);
function selectTab(id: string) {
  activeTab.value = id;
  prefs.activeLeftTab.value = id;
}
const leftWidthStyle = computed(() => ({ width: `${prefs.leftRailWidth.value}px` }));
</script>
<template>
  <div class="survey-workbench-shell">
    <aside
      v-if="tabs.length"
      class="shell-left"
      :style="leftWidthStyle"
      v-show="!prefs.leftCollapsed.value"
    >
      <nav class="shell-left__tabs" aria-label="surveys">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="shell-tab"
          :class="{ 'shell-tab--active': activeTab === tab.id }"
          :aria-current="activeTab === tab.id ? 'page' : undefined"
          @click="selectTab(tab.id)"
        >
          <component :is="tab.icon" v-if="tab.icon" :size="14" />
          <span class="shell-tab__label">{{ tab.label }}</span>
        </button>
      </nav>
      <div class="shell-left__panel">
        <slot name="left" :active-tab="activeTab" />
      </div>
    </aside>
    <section class="shell-center">
      <slot name="center" />
    </section>
    <aside v-if="host.copilot?.island" class="shell-right">
      <component :is="host.copilot.island" />
    </aside>
  </div>
</template>
<style scoped>
.survey-workbench-shell {
  display: flex;
  align-items: stretch;
  height: 100%;
  min-height: 0;
}
.shell-left {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--color-border-subtle);
  background: var(--color-surface-base);
}
.shell-left__tabs {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--color-border-subtle);
}
.shell-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px 7px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.shell-tab:hover {
  color: var(--color-text-primary);
}
.shell-tab--active {
  color: var(--color-brand-700);
  border-bottom-color: var(--color-brand-500);
}
.shell-left__panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.shell-center {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.shell-right {
  flex: none;
  width: 360px;
  min-height: 0;
  border-left: 1px solid var(--color-border-subtle);
  background: var(--color-surface-base);
}
@media (max-width: 767.98px) {
  .survey-workbench-shell {
    flex-direction: column;
  }
  .shell-left {
    width: 100% !important;
    border-right: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .shell-right {
    display: none;
  }
}
</style>
