<script setup lang="ts">
// 中岛顶部的生命周期轨道（issue #217）：设计 → 发放 → 数据 → 分析。
// stepper 语义用自绘轨道承载——每段要挂自己的状态徽标（dirty / 采集状态 /
// 已完成数）与整段置灰门控（未发布时后三段不可点），PrimeVue Stepper 的
// 步骤头挂不下这些。置灰段保留 tooltip 引导（先发布），不让用户猜。
// 视觉层级：段名是主文字，状态/计数是段内次级小徽标（更小字号、弱色）。
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { SurveyStatus } from "../../contracts/index.js";

const props = defineProps<{
  stage: string;
  /** 从未发布过（无 revision）时后三段锁定。 */
  hasRevision: boolean;
  status: SurveyStatus;
  completedCount: number;
  /** 设计草稿相对当前采集版本有未发布修改。 */
  dirty: boolean;
}>();
const emit = defineEmits<{ change: [stage: string] }>();
const { t } = useI18n();

function activate(segment: string) {
  emit("change", segment);
}

const segments = [
  { id: "design", key: "surveys.stage.design" },
  { id: "distribute", key: "surveys.stage.distribute" },
  { id: "data", key: "surveys.stage.data" },
  { id: "analysis", key: "surveys.stage.analysis" },
] as const;

const statusText = computed(() => t(`surveys.status.${props.status}`));
</script>
<template>
  <nav class="lifecycle-track" :aria-label="t('surveys.trackLabel')">
    <template v-for="(segment, index) in segments" :key="segment.id">
      <span v-if="index > 0" class="track-connector" aria-hidden="true" />
      <button
        type="button"
        class="track-segment"
        :class="[
          stage === segment.id && 'track-segment--active',
          hasRevision === false && segment.id !== 'design' && 'track-segment--locked',
        ]"
        :disabled="hasRevision === false && segment.id !== 'design'"
        :aria-current="stage === segment.id ? 'step' : undefined"
        v-tooltip.top="
          hasRevision === false && segment.id !== 'design'
            ? t('surveys.publishFirst')
            : null
        "
        @click="activate(segment.id)"
        @keydown.enter.prevent="activate(segment.id)"
        @keydown.space.prevent="activate(segment.id)"
      >
        <span class="segment-label">{{ t(segment.key) }}</span>
        <span
          v-if="segment.id === 'design' && dirty"
          class="segment-badge segment-badge--dirty"
          v-tooltip.top="t('surveys.dirtyBadge')"
        >{{ t("surveys.dirtyBadge") }}</span>
        <span
          v-else-if="segment.id === 'distribute' && hasRevision"
          class="segment-badge"
        >{{ statusText }}</span>
        <span
          v-else-if="segment.id === 'data' && hasRevision"
          class="segment-badge segment-badge--count"
        >{{ completedCount }}</span>
      </button>
    </template>
  </nav>
</template>
<style scoped>
.lifecycle-track {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  padding: 2px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill, 999px);
  background: var(--color-bg-soft);
}
.track-connector {
  flex-shrink: 0;
  width: 12px;
  height: 1px;
  background: var(--color-border-strong);
}
.track-segment {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-pill, 999px);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.track-segment:hover:not(:disabled):not(.track-segment--active) {
  color: var(--color-text-primary);
  background: var(--material-hover);
}
.track-segment--active {
  color: var(--color-brand-700);
  background: var(--color-brand-50);
}
.track-segment--locked {
  color: var(--color-text-faint, var(--color-text-tertiary));
  cursor: not-allowed;
  opacity: 0.6;
}
.segment-label {
  /* 段名 = 主文字；色随段状态（secondary / hover primary / active brand）继承。 */
  font-weight: 600;
}
.segment-badge {
  display: inline-flex;
  align-items: center;
  max-width: 11em;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 5px;
  height: 15px;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-surface-muted);
  color: var(--color-text-tertiary);
  font-size: 10.5px;
  font-weight: 500;
}
.segment-badge--dirty {
  color: var(--color-warning-600);
  background: var(--color-warning-surface);
}
.segment-badge--count {
  font-variant-numeric: tabular-nums;
}
</style>
