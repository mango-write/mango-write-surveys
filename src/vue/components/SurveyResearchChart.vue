<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { init, use, type EChartsType } from "echarts/core";
import {
  BarChart,
  CustomChart,
  HeatmapChart,
  ScatterChart,
} from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";

import type { ResearchChartSpec } from "../../research/chart-spec.js";

use([
  BarChart,
  CustomChart,
  HeatmapChart,
  ScatterChart,
  AriaComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
  SVGRenderer,
]);

const props = defineProps<{ spec: ResearchChartSpec }>();
const element = ref<HTMLElement | null>(null);
let chart: EChartsType | null = null;
let observer: ResizeObserver | null = null;

function render() {
  if (!chart) return;
  chart.setOption(props.spec.option, true);
  chart.resize();
  if (
    element.value &&
    element.value.clientWidth < 600 &&
    props.spec.id !== "efa-variance" &&
    props.spec.id !== "text-word-cloud"
  ) {
    chart.setOption({ yAxis: { axisLabel: { width: 88 } } });
  }
}

onMounted(() => {
  if (!element.value) return;
  chart = init(element.value, undefined, {
    renderer: props.spec.id === "text-word-cloud" ? "canvas" : "svg",
  });
  render();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(render);
    observer.observe(element.value);
  }
});

watch(() => props.spec, render, { deep: true });

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div
    ref="element"
    class="research-chart"
    role="img"
    :aria-label="spec.title"
    :style="{ height: `${spec.height}px` }"
  />
</template>

<style scoped>
.research-chart {
  display: block;
  width: 100%;
  min-width: 0;
}
</style>
