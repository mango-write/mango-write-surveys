<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { EChartsOption } from "echarts";

import {
  RESEARCH_CHART_COLORS,
  type ResearchChartSpec,
} from "../../research/chart-spec.js";
import { extractTextWords } from "../lib/text-words.js";
import type { TextEntry } from "../lib/summary.js";
import SurveyResearchChart from "./SurveyResearchChart.vue";

const props = defineProps<{
  entries: TextEntry[];
  locale?: string;
}>();
const { t } = useI18n();

const ready = ref(false);
onMounted(async () => {
  try {
    if (!document.createElement("canvas").getContext("2d")) return;
    await import("echarts-wordcloud");
    ready.value = true;
  } catch {
    ready.value = false;
  }
});

const words = computed(() =>
  extractTextWords(props.entries, { locale: props.locale }),
);
const spec = computed<ResearchChartSpec | null>(() => {
  if (!ready.value || !words.value.length) return null;
  const option = {
    animation: false,
    backgroundColor: "transparent",
    tooltip: { trigger: "item" },
    series: [
      {
        type: "wordCloud",
        shape: "circle",
        keepAspect: false,
        gridSize: 8,
        sizeRange: [14, 38],
        rotationRange: [0, 0],
        drawOutOfBound: false,
        layoutAnimation: false,
        textStyle: {
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: (params: { dataIndex: number }) =>
            RESEARCH_CHART_COLORS[
              params.dataIndex % RESEARCH_CHART_COLORS.length
            ],
        },
        emphasis: { textStyle: { fontWeight: 600 } },
        data: words.value,
      },
    ],
  } as EChartsOption;
  return {
    id: "text-word-cloud",
    title: t("surveys.summary.wordCloudTitle"),
    description: t("surveys.summary.wordCloudHint"),
    height: 280,
    option,
  };
});
</script>

<template>
  <section v-if="spec" class="text-word-cloud">
    <h4>{{ spec.title }}</h4>
    <p class="tw:text-muted tw:text-sm">{{ spec.description }}</p>
    <SurveyResearchChart :spec="spec" />
  </section>
</template>

<style scoped>
.text-word-cloud {
  min-width: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.text-word-cloud h4 {
  margin: 0;
  font-size: 13px;
}
.text-word-cloud p {
  margin: 4px 0 0;
}
</style>
