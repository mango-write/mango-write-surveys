<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { use } from "echarts/core";
import type { EChartsOption } from "echarts";

import {
  createSurveyChartStyle,
  resolveSurveyChartTheme,
  type ResearchChartSpec,
  type SurveyChartViewStyle,
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
const defaultStyle = createSurveyChartStyle({
  theme: "screen",
  surface: "auto",
  fontScale: "md",
  showGrid: false,
  showHeader: false,
});
const chartStyle = ref<SurveyChartViewStyle>({ ...defaultStyle });
const isDarkTheme = ref(
  typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark",
);
let themeObserver: MutationObserver | null = null;

onMounted(async () => {
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    themeObserver = new MutationObserver(() => {
      isDarkTheme.value = document.documentElement.getAttribute("data-theme") === "dark";
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  try {
    if (!document.createElement("canvas").getContext("2d")) return;
    use((await import("@echarts-x/custom-word-cloud")).default);
    ready.value = true;
  } catch {
    ready.value = false;
  }
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});

const words = computed(() =>
  extractTextWords(props.entries, { locale: props.locale }),
);
const spec = computed<ResearchChartSpec | null>(() => {
  if (!ready.value || !words.value.length) return null;
  const resolved = resolveSurveyChartTheme(chartStyle.value, isDarkTheme.value);
  const titleText = t("surveys.summary.wordCloudTitle");
  const option = {
    animation: false,
    backgroundColor: resolved.backgroundColor,
    ...(chartStyle.value.showHeader
      ? {
          title: {
            show: true,
            text: titleText,
            left: 16,
            top: 12,
            textStyle: {
              color: resolved.textColor,
              fontFamily: resolved.fontFamily,
              fontSize: 15,
              fontWeight: 600,
            },
          },
        }
      : {}),
    tooltip: { trigger: "item" },
    series: [
      {
        type: "custom",
        renderItem: "wordCloud",
        coordinateSystem: "none",
        top: chartStyle.value.showHeader ? 44 : 8,
        itemPayload: {
          shape: "circle",
          keepAspect: false,
          gridSize: 8,
          sizeRange: [14, 38],
          rotationRange: [0, 0],
          drawOutOfBound: false,
        },
        label: {
          fontFamily: resolved.fontFamily,
        },
        emphasis: { label: { fontWeight: 600 } },
        data: words.value.map((word, index) => ({
          name: word.name,
          value: [word.name, word.value],
          itemStyle: {
            color: resolved.colors[index % resolved.colors.length],
          },
        })),
      },
    ],
  } as EChartsOption;
  return {
    id: "text-word-cloud",
    title: titleText,
    description: t("surveys.summary.wordCloudHint"),
    height: chartStyle.value.showHeader ? 320 : 280,
    option,
  };
});
</script>

<template>
  <section v-if="spec" class="text-word-cloud">
    <h4>{{ spec.title }}</h4>
    <p class="tw:text-muted tw:text-sm">{{ spec.description }}</p>
    <SurveyResearchChart
      v-model:view-style="chartStyle"
      :spec="spec"
      :default-style="defaultStyle"
      is-word-cloud
    />
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
