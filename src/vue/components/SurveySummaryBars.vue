<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  buckets: Array<{ label: string; count: number }>;
  /** 占比分母（作答人数）；0 时条形归零、只显示计数。 */
  base: number;
  colorMode?: "categorical" | "single";
}>(), {
  colorMode: "single",
});

const colors = [
  "--color-brand-500",
  "--color-info-500",
  "--color-success-500",
  "--color-warning-500",
  "--color-danger-500",
  "--color-text-tertiary",
];
const rows = computed(() =>
  props.buckets.map((bucket, index) => ({
    ...bucket,
    color: props.colorMode === "categorical" ? colors[index % colors.length] : colors[0],
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
    <div
      v-for="row in rows"
      :key="row.label"
      class="bar-row"
      :style="{ '--bar-color': `var(${row.color})` }"
    >
      <dt class="bar-label">{{ row.label }}</dt>
      <dd class="bar-value">
        <span class="bar-track" aria-hidden="true">
          <span class="bar-fill" :style="{ width: `${Math.min(100, row.percent)}%` }" />
        </span>
        <span class="bar-num">{{ row.count }} · <strong>{{ percentText(row.percent) }}</strong></span>
      </dd>
    </div>
  </dl>
</template>
<style scoped>
.summary-bars {
  display: grid;
  gap: 16px;
  margin: 0;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(6rem, 10rem) minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}
.bar-label {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: var(--line-height-body);
}
.bar-value {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  min-width: 0;
}
.bar-track {
  flex: 1;
  height: 18px;
  min-width: 5rem;
  border-radius: var(--radius-pill);
  background: var(--color-bg-soft);
  box-shadow: inset 0 0 0 1px var(--color-border-soft);
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  background: var(--bar-color);
}
.bar-num {
  flex: none;
  min-width: 7em;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-body-sm);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.bar-num strong {
  color: var(--color-text-primary);
  font-size: var(--font-size-title-sm);
  font-weight: 600;
}
@media (max-width: 767.98px) {
  .bar-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .bar-value { gap: 12px; }
  .bar-track { height: 16px; }
}
</style>
