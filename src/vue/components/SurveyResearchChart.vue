<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import { Download, ImageDown, Maximize2, Palette, RotateCcw } from "lucide-vue-next";
import Button from "@mango-write/ui-vue/components/Button";
import Dialog from "@mango-write/ui-vue/components/Dialog";
import ToggleSwitch from "@mango-write/ui-vue/components/ToggleSwitch";

import {
  SURVEY_CHART_THEMES,
  resolveSurveyChartTheme,
  type ResearchChartSpec,
  type SurveyChartFontScale,
  type SurveyChartSurface,
  type SurveyChartThemeId,
  type SurveyChartViewStyle,
} from "../../research/chart-spec.js";

use([
  BarChart,
  CustomChart,
  HeatmapChart,
  ScatterChart,
  AriaComponent,
  GridComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
  SVGRenderer,
]);

const props = withDefaults(
  defineProps<{
    spec: ResearchChartSpec;
    viewStyle?: SurveyChartViewStyle;
    defaultStyle?: SurveyChartViewStyle;
    showToolbar?: boolean;
    isWordCloud?: boolean;
  }>(),
  {
    viewStyle: undefined,
    defaultStyle: undefined,
    showToolbar: true,
    isWordCloud: false,
  },
);

const emit = defineEmits<{
  "update:viewStyle": [value: SurveyChartViewStyle];
}>();

const { t } = useI18n();
const element = ref<HTMLElement | null>(null);
const lightboxElement = ref<HTMLElement | null>(null);
const styleOpen = ref(false);
const lightboxOpen = ref(false);

let chart: EChartsType | null = null;
let lightboxChart: EChartsType | null = null;
let observer: ResizeObserver | null = null;
let lightboxObserver: ResizeObserver | null = null;

const isSvg = computed(
  () => !props.isWordCloud && props.spec.id !== "text-word-cloud",
);

const themeChoices = computed<
  Array<{ value: SurveyChartThemeId; label: string; dots: string[] }>
>(() => [
  {
    value: "screen",
    label: t("surveys.research.chart.themeScreen"),
    dots: SURVEY_CHART_THEMES.screen.categoryColors.slice(0, 3),
  },
  {
    value: "okabe-ito",
    label: t("surveys.research.chart.themeOkabeIto"),
    dots: SURVEY_CHART_THEMES["okabe-ito"].categoryColors.slice(0, 3),
  },
  {
    value: "cn-journal",
    label: t("surveys.research.chart.themeCnJournal"),
    dots: SURVEY_CHART_THEMES["cn-journal"].categoryColors.slice(0, 2),
  },
  {
    value: "journal-gray",
    label: t("surveys.research.chart.themeJournalGray"),
    dots: [
      SURVEY_CHART_THEMES["journal-gray"].categoryColors[0]!,
      SURVEY_CHART_THEMES["journal-gray"].categoryColors[2]!,
    ],
  },
]);

const surfaceChoices = computed<Array<{ value: SurveyChartSurface; label: string }>>(
  () => [
    { value: "auto", label: t("surveys.research.chart.surfaceAuto") },
    { value: "paper", label: t("surveys.research.chart.surfacePaper") },
    { value: "dark", label: t("surveys.research.chart.surfaceDark") },
    { value: "transparent", label: t("surveys.research.chart.surfaceTransparent") },
  ],
);

const fontChoices = computed<Array<{ value: SurveyChartFontScale; label: string }>>(
  () => [
    { value: "sm", label: t("surveys.research.chart.fontSm") },
    { value: "md", label: t("surveys.research.chart.fontMd") },
    { value: "lg", label: t("surveys.research.chart.fontLg") },
  ],
);

function patchStyle(next: Partial<SurveyChartViewStyle>) {
  if (!props.viewStyle) return;
  emit("update:viewStyle", { ...props.viewStyle, ...next });
}

function resetStyle() {
  if (props.defaultStyle) {
    emit("update:viewStyle", { ...props.defaultStyle });
  }
}

function applyResponsiveOption(target: EChartsType | null, el: HTMLElement | null) {
  if (!target || !el) return;
  target.setOption(props.spec.option, true);
  target.resize();
  if (
    el.clientWidth < 600 &&
    props.spec.id !== "efa-variance" &&
    props.spec.id !== "text-word-cloud"
  ) {
    target.setOption({ yAxis: { axisLabel: { width: 88 } } });
  }
}

function render() {
  applyResponsiveOption(chart, element.value);
  if (lightboxOpen.value) {
    applyResponsiveOption(lightboxChart, lightboxElement.value);
  }
}

function disposeLightbox() {
  lightboxObserver?.disconnect();
  lightboxObserver = null;
  lightboxChart?.dispose();
  lightboxChart = null;
}

async function initLightboxChart() {
  await nextTick();
  const el = lightboxElement.value;
  if (!el || !lightboxOpen.value) return;
  disposeLightbox();
  lightboxChart = init(el, undefined, {
    renderer: isSvg.value ? "svg" : "canvas",
  });
  applyResponsiveOption(lightboxChart, el);
  if (typeof ResizeObserver !== "undefined") {
    lightboxObserver = new ResizeObserver(() => {
      applyResponsiveOption(lightboxChart, lightboxElement.value);
    });
    lightboxObserver.observe(el);
  }
}

watch(lightboxOpen, (open) => {
  if (open) {
    void initLightboxChart();
  } else {
    disposeLightbox();
  }
});

function fileBaseName(): string {
  const cleaned = props.spec.title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 48);
  return cleaned || props.spec.id || "chart";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function activeRootElement(): HTMLElement | null {
  return lightboxOpen.value && lightboxElement.value
    ? lightboxElement.value
    : element.value;
}

function extractSvg(): { markup: string; width: number; height: number } | null {
  const root = activeRootElement();
  const svg = root?.querySelector("svg");
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox?.baseVal;
  const width = Math.max(
    Math.round(rect.width || vb?.width || Number(svg.getAttribute("width")) || 640),
    120,
  );
  const height = Math.max(
    Math.round(rect.height || vb?.height || Number(svg.getAttribute("height")) || 360),
    80,
  );
  if (!clone.getAttribute("width")) clone.setAttribute("width", String(width));
  if (!clone.getAttribute("height")) clone.setAttribute("height", String(height));
  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

function downloadSvg() {
  const payload = extractSvg();
  if (!payload) return;
  const blob = new Blob([payload.markup], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, `${fileBaseName()}.svg`);
}

async function downloadPng() {
  const active = lightboxOpen.value && lightboxChart ? lightboxChart : chart;
  if (!isSvg.value && active) {
    const dataUrl = active.getDataURL({ type: "png", pixelRatio: 2 });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    triggerDownload(blob, `${fileBaseName()}.png`);
    return;
  }
  const payload = extractSvg();
  if (!payload) return;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = payload.width * scale;
  canvas.height = payload.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const bg = String(
    (props.spec.option as Record<string, unknown>).backgroundColor ??
      resolveSurveyChartTheme().backgroundColor,
  );
  if (bg !== "transparent") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload.markup)}`;
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = () => reject(new Error("svg image load failed"));
    img.src = dataUrl;
  });
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (blob) triggerDownload(blob, `${fileBaseName()}.png`);
}

onMounted(() => {
  if (!element.value) return;
  chart = init(element.value, undefined, {
    renderer: isSvg.value ? "svg" : "canvas",
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
  disposeLightbox();
});
</script>

<template>
  <div class="research-chart-wrap">
    <div v-if="showToolbar" class="research-chart__toolbar mw-size-sm">
      <Button
        v-if="viewStyle"
        type="button"
        :variant="styleOpen ? 'tinted' : 'outlined'"
        severity="secondary"
        :icon="Palette"
        :label="t('surveys.research.chart.style')"
        data-survey-chart-style=""
        @click="styleOpen = !styleOpen"
      />
      <Button
        type="button"
        variant="outlined"
        severity="secondary"
        :icon="Maximize2"
        :label="t('surveys.research.chart.zoomButton')"
        data-survey-chart-zoom=""
        @click="lightboxOpen = true"
      />
      <Button
        v-if="isSvg"
        type="button"
        variant="outlined"
        severity="secondary"
        :icon="Download"
        :label="t('surveys.research.chart.downloadSvg')"
        data-survey-chart-svg=""
        @click="downloadSvg"
      />
      <Button
        type="button"
        variant="outlined"
        severity="secondary"
        :icon="ImageDown"
        :label="t('surveys.research.chart.downloadPng')"
        data-survey-chart-png=""
        @click="downloadPng"
      />
    </div>

    <div
      v-if="showToolbar && styleOpen && viewStyle"
      class="research-chart__style-bar"
      data-survey-chart-style-bar=""
    >
      <div v-if="!isWordCloud" class="survey-style__group">
        <span class="survey-style__label">{{ t("surveys.research.chart.theme") }}</span>
        <div class="survey-style__pills">
          <button
            v-for="item in themeChoices"
            :key="item.value"
            type="button"
            class="survey-style__pill"
            :class="{ 'is-active': viewStyle.theme === item.value }"
            @click="patchStyle({ theme: item.value })"
          >
            <span class="survey-style__dots">
              <span
                v-for="(c, i) in item.dots"
                :key="i"
                class="survey-style__dot"
                :style="{ background: c }"
              />
            </span>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>

      <div class="survey-style__group">
        <span class="survey-style__label">{{ t("surveys.research.chart.surface") }}</span>
        <div class="survey-style__pills">
          <button
            v-for="item in surfaceChoices"
            :key="item.value"
            type="button"
            class="survey-style__pill"
            :class="{ 'is-active': viewStyle.surface === item.value }"
            @click="patchStyle({ surface: item.value })"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <div v-if="!isWordCloud" class="survey-style__group">
        <span class="survey-style__label">{{ t("surveys.research.chart.fontScale") }}</span>
        <div class="survey-style__pills">
          <button
            v-for="item in fontChoices"
            :key="item.value"
            type="button"
            class="survey-style__pill"
            :class="{ 'is-active': viewStyle.fontScale === item.value }"
            @click="patchStyle({ fontScale: item.value })"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <label v-if="!isWordCloud" class="survey-style__switch">
        <span>{{ t("surveys.research.chart.showGrid") }}</span>
        <ToggleSwitch
          :model-value="viewStyle.showGrid"
          @update:model-value="patchStyle({ showGrid: Boolean($event) })"
        />
      </label>

      <label class="survey-style__switch">
        <span>{{ t("surveys.research.chart.showHeader") }}</span>
        <ToggleSwitch
          :model-value="viewStyle.showHeader"
          @update:model-value="patchStyle({ showHeader: Boolean($event) })"
        />
      </label>

      <button
        v-if="defaultStyle"
        type="button"
        class="survey-style__reset"
        @click="resetStyle"
      >
        <RotateCcw :size="12" />
        <span>{{ t("surveys.research.chart.resetStyle") }}</span>
      </button>
    </div>

    <div
      ref="element"
      class="research-chart research-chart--zoomable"
      role="img"
      :aria-label="spec.title"
      :style="{ height: `${spec.height}px` }"
      @click="lightboxOpen = true"
    />

    <Dialog
      v-if="lightboxOpen"
      v-model:visible="lightboxOpen"
      modal
      maximizable
      dismissable-mask
      :header="spec.title || t('surveys.research.chart.lightboxTitle')"
      :style="{ width: 'min(1080px, 94vw)', height: 'min(780px, 90vh)' }"
      data-survey-chart-lightbox=""
    >
      <div class="research-chart-lightbox">
        <div v-if="viewStyle" class="research-chart__style-bar">
          <div v-if="!isWordCloud" class="survey-style__group">
            <span class="survey-style__label">{{ t("surveys.research.chart.theme") }}</span>
            <div class="survey-style__pills">
              <button
                v-for="item in themeChoices"
                :key="item.value"
                type="button"
                class="survey-style__pill"
                :class="{ 'is-active': viewStyle.theme === item.value }"
                @click="patchStyle({ theme: item.value })"
              >
                <span class="survey-style__dots">
                  <span
                    v-for="(c, i) in item.dots"
                    :key="i"
                    class="survey-style__dot"
                    :style="{ background: c }"
                  />
                </span>
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>

          <div class="survey-style__group">
            <span class="survey-style__label">{{ t("surveys.research.chart.surface") }}</span>
            <div class="survey-style__pills">
              <button
                v-for="item in surfaceChoices"
                :key="item.value"
                type="button"
                class="survey-style__pill"
                :class="{ 'is-active': viewStyle.surface === item.value }"
                @click="patchStyle({ surface: item.value })"
              >
                {{ item.label }}
              </button>
            </div>
          </div>

          <div v-if="!isWordCloud" class="survey-style__group">
            <span class="survey-style__label">{{ t("surveys.research.chart.fontScale") }}</span>
            <div class="survey-style__pills">
              <button
                v-for="item in fontChoices"
                :key="item.value"
                type="button"
                class="survey-style__pill"
                :class="{ 'is-active': viewStyle.fontScale === item.value }"
                @click="patchStyle({ fontScale: item.value })"
              >
                {{ item.label }}
              </button>
            </div>
          </div>

          <label v-if="!isWordCloud" class="survey-style__switch">
            <span>{{ t("surveys.research.chart.showGrid") }}</span>
            <ToggleSwitch
              :model-value="viewStyle.showGrid"
              @update:model-value="patchStyle({ showGrid: Boolean($event) })"
            />
          </label>

          <label class="survey-style__switch">
            <span>{{ t("surveys.research.chart.showHeader") }}</span>
            <ToggleSwitch
              :model-value="viewStyle.showHeader"
              @update:model-value="patchStyle({ showHeader: Boolean($event) })"
            />
          </label>
        </div>

        <div ref="lightboxElement" class="research-chart-lightbox__canvas" />
      </div>

      <template #footer>
        <div class="research-chart-lightbox__footer">
          <Button
            v-if="isSvg"
            type="button"
            variant="outlined"
            severity="secondary"
            :icon="Download"
            :label="t('surveys.research.chart.downloadSvg')"
            @click="downloadSvg"
          />
          <Button
            type="button"
            variant="outlined"
            severity="secondary"
            :icon="ImageDown"
            :label="t('surveys.research.chart.downloadPng')"
            @click="downloadPng"
          />
          <Button
            type="button"
            severity="secondary"
            :label="t('surveys.research.chart.close')"
            class="tw:ml-auto"
            @click="lightboxOpen = false"
          />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.research-chart-wrap {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.research-chart__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.research-chart__style-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 8px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  background: var(--color-surface-muted);
}
.survey-style__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.survey-style__label {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}
.survey-style__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.survey-style__pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.survey-style__pill.is-active {
  border-color: var(--color-brand-500);
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  font-weight: 500;
}
.survey-style__dots {
  display: inline-flex;
  gap: 2px;
}
.survey-style__dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
}
.survey-style__switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.survey-style__reset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  cursor: pointer;
}
.research-chart {
  display: block;
  width: 100%;
  min-width: 0;
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
}
.research-chart--zoomable {
  cursor: zoom-in;
}
.research-chart-lightbox {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.research-chart-lightbox__canvas {
  flex: 1 1 auto;
  min-height: 320px;
  width: 100%;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
}
.research-chart-lightbox__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}
</style>
