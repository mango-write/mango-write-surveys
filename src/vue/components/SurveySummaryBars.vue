<script setup lang="ts">
// 逐题摘要的计数条形（纯 CSS，不依赖 chart-engine）：一份「标签 + 条 + 计数/占比」
// 的只读呈现，被选择题、量表分布、数字分桶与矩阵行共用。
import { computed } from "vue";

const props = defineProps<{
  buckets: Array<{ label: string; count: number }>;
  /** 占比分母（作答人数）；0 时条形归零、只显示计数。 */
  base: number;
}>();

const rows = computed(() =>
  props.buckets.map((bucket) => ({
    ...bucket,
    percent: props.base > 0 ? (bucket.count / props.base) * 100 : 0,
  })),
);
function percentText(percent: number): string {
  if (!percent) return "0%";
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
</script>
<template>
  <dl class="summary-bars">
    <div v-for="row in rows" :key="row.label" class="bar-row">
      <dt class="bar-label">{{ row.label }}</dt>
      <dd class="bar-value">
        <span class="bar-track" aria-hidden="true"
          ><span
            class="bar-fill"
            :style="{ width: `${Math.min(100, row.percent)}%` }"
        /></span>
        <span class="bar-num">{{ row.count }} · {{ percentText(row.percent) }}</span>
      </dd>
    </div>
  </dl>
</template>
<style scoped>
.summary-bars {
  display: grid;
  gap: 8px;
  margin: 0;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(5rem, 11rem) minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.bar-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.bar-value {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  min-width: 0;
}
.bar-track {
  flex: 1;
  height: 10px;
  min-width: 4rem;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-bg-soft);
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-brand-500);
}
.bar-num {
  flex: none;
  min-width: 5.5em;
  font-size: 12px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
