<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type { ResearchRunDetail, SurveyResearchTable } from "../../contracts/index.js";
import {
  buildResearchChartSpecs,
  type ResearchChartLabels,
} from "../../research/chart-spec.js";
import { useSurveysApi } from "../api.js";
import { formatResearchNumber } from "../lib/research-format.js";
import SurveyResearchChart from "./SurveyResearchChart.vue";

const props = defineProps<{
  surveyId: string;
  run: ResearchRunDetail;
  /** `construct:<id>` / `variable:<id>` → 展示名（构念名/变量 label）。 */
  refLabels: Record<string, string>;
}>();
const { t } = useI18n();
const api = useSurveysApi();

const recipe = computed(() => props.run.recipe);
const recipeLabel = computed(() => t(`surveys.research.recipe.${recipe.value.type}`));
const recipeSummary = computed(() => {
  const value = recipe.value;
  if (value.type === "reliability" || value.type === "efa") {
    return value.constructIds
      .map((id) => refLabel(`construct:${id}`))
      .join("、");
  }
  if (value.type === "ols") {
    return [
      `${t("surveys.research.roleOutcome")}: ${refLabel(value.outcome)}`,
      `${t("surveys.research.rolePredictors")}: ${value.predictors.map(refLabel).join("、")}`,
    ].join(" · ");
  }
  return [
    `X: ${refLabel(value.x)}`,
    `M: ${refLabel(value.m)}`,
    `Y: ${refLabel(value.y)}`,
    `W: ${refLabel(value.w)}`,
    value.covariates.length
      ? `${t("surveys.research.roleCovariates")}: ${value.covariates.map(refLabel).join("、")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
});
function refLabel(ref: string) {
  return props.refLabels[ref] ?? ref.replace(/^(construct|variable):/, "");
}
const chartLabels = computed<Partial<ResearchChartLabels>>(() => ({
  reliabilityTitle: t("surveys.research.chart.reliabilityTitle"),
  reliabilityDescription: t("surveys.research.chart.reliabilityDescription"),
  alphaAxis: t("surveys.research.chart.alphaAxis"),
  efaVarianceTitle: t("surveys.research.chart.efaVarianceTitle"),
  efaVarianceDescription: t("surveys.research.chart.efaVarianceDescription"),
  varianceAxis: t("surveys.research.chart.varianceAxis"),
  efaLoadingsTitle: t("surveys.research.chart.efaLoadingsTitle"),
  efaLoadingsDescription: t("surveys.research.chart.efaLoadingsDescription"),
  olsCoefficientsTitle: t("surveys.research.chart.olsCoefficientsTitle"),
  olsCoefficientsDescription: t("surveys.research.chart.olsCoefficientsDescription"),
  conditionalIndirectTitle: t("surveys.research.chart.conditionalIndirectTitle"),
  conditionalIndirectDescription: t("surveys.research.chart.conditionalIndirectDescription"),
  conditionalEffects: [
    t("surveys.research.chart.effectLow"),
    t("surveys.research.chart.effectMean"),
    t("surveys.research.chart.effectHigh"),
    t("surveys.research.chart.effectDifference"),
    t("surveys.research.chart.effectIndex"),
  ],
  simpleSlopesTitle: t("surveys.research.chart.simpleSlopesTitle"),
  simpleSlopesDescription: t("surveys.research.chart.simpleSlopesDescription"),
  estimateAxis: t("surveys.research.chart.estimateAxis"),
  confidenceInterval: t("surveys.research.chart.confidenceInterval"),
  estimate: t("surveys.research.chart.estimate"),
}));
const charts = computed(() =>
  buildResearchChartSpecs(props.run, { labels: chartLabels.value }),
);
const keyTableIds = computed(() => {
  switch (recipe.value.type) {
    case "reliability":
      return new Set(["reliability"]);
    case "efa":
      return new Set(["efa_fit", "efa_variance"]);
    case "ols":
      return new Set(["coefficients", "model_fit"]);
    case "moderatedMediation":
      return new Set(["conditional_indirect", "simple_slopes"]);
  }
});
const keyTables = computed(() =>
  props.run.result.tables.filter((table) => keyTableIds.value.has(table.id)),
);
const otherTables = computed(() =>
  props.run.result.tables.filter((table) => !keyTableIds.value.has(table.id)),
);

function cellText(value: string | number | null) {
  return formatResearchNumber(value) ?? t("surveys.research.notComputable");
}
function openReport() {
  window.open(
    api.research.runFileUrl(props.surveyId, props.run.id, "report.html"),
    "_blank",
    "noopener",
  );
}
async function download(file: "result.json" | "result.csv") {
  await api.research.downloadRunFile(
    props.surveyId,
    props.run.id,
    file,
    `run-${props.run.id}.${file === "result.json" ? "result.json" : "result.csv"}`,
  );
}
function tableRows(table: SurveyResearchTable) {
  return table.rows.map((row, index) => ({ ...row, __key: index }));
}
</script>
<template>
  <article class="run-result">
    <header class="result-head">
      <div class="result-title">
        <h4>{{ recipeLabel }}</h4>
        <Tag
          :value="
            run.sourceKind === 'synthetic'
              ? t('surveys.research.sourceSynthetic')
              : t('surveys.research.sourcePublic')
          "
          :severity="run.sourceKind === 'synthetic' ? 'warn' : 'secondary'"
        />
      </div>
      <div class="result-actions">
        <Button
          :label="t('surveys.research.openReport')"
          icon="pi pi-external-link"
          severity="secondary"
          @click="openReport"
        /><Button
          :label="t('surveys.research.downloadJson')"
          icon="pi pi-download"
          text
          severity="secondary"
          @click="download('result.json')"
        /><Button
          :label="t('surveys.research.downloadCsv')"
          icon="pi pi-download"
          text
          severity="secondary"
          @click="download('result.csv')"
        />
      </div>
    </header>
    <p class="result-summary tw:text-muted">{{ recipeSummary }}</p>
    <dl class="result-metrics">
      <div>
        <dt>{{ t("surveys.research.effectiveNLabel") }}</dt>
        <dd>{{ run.result.effectiveN }}</dd>
      </div>
      <div>
        <dt>{{ t("surveys.research.missingRowsLabel") }}</dt>
        <dd>{{ run.result.missingRows }}</dd>
      </div>
      <div>
        <dt>{{ t("surveys.research.recordedAtLabel") }}</dt>
        <dd>{{ new Date(run.createdAt).toLocaleString() }}</dd>
      </div>
    </dl>
    <Message
      v-for="warning in run.result.warnings"
      :key="warning"
      severity="warn"
      :closable="false"
      >{{ warning }}</Message
    >
    <p v-if="!charts.length" class="tw:text-muted">{{ t("surveys.research.chartUnavailable") }}</p>
    <section v-for="chart in charts" :key="chart.id" class="result-chart">
      <h5>{{ chart.title }}</h5>
      <p class="chart-description tw:text-muted">{{ chart.description }}</p>
      <SurveyResearchChart :spec="chart" />
    </section>
    <section v-if="keyTables.length" class="result-tables">
      <h5>{{ t("surveys.research.keyTablesTitle") }}</h5>
      <section v-for="table in keyTables" :key="table.id" class="result-table">
        <h6>{{ table.title }}</h6>
        <DataTable :value="tableRows(table)" scrollable>
          <Column
            v-for="column in table.columns"
            :key="column.key"
            :field="column.key"
            :header="column.label"
          >
            <template #body="{ data }">
              <span :class="{ 'tw:text-muted': data[column.key] == null }">{{
                table.id === 'model_fit' && data.statistic === 'Bootstrap seed'
                  ? data[column.key]
                  : cellText(data[column.key])
              }}</span>
            </template>
          </Column>
        </DataTable>
      </section>
    </section>
    <details v-if="otherTables.length" class="result-other">
      <summary>{{ t("surveys.research.otherTablesTitle") }}</summary>
      <section v-for="table in otherTables" :key="table.id" class="result-table">
        <h6>{{ table.title }}</h6>
        <DataTable :value="tableRows(table)" scrollable>
          <Column
            v-for="column in table.columns"
            :key="column.key"
            :field="column.key"
            :header="column.label"
          >
            <template #body="{ data }">
              <span :class="{ 'tw:text-muted': data[column.key] == null }">{{
                table.id === 'model_fit' && data.statistic === 'Bootstrap seed'
                  ? data[column.key]
                  : cellText(data[column.key])
              }}</span>
            </template>
          </Column>
        </DataTable>
      </section>
    </details>
    <details v-if="run.result.limitations.length" class="limitations">
      <summary>{{ t("surveys.research.limitations") }}</summary>
      <ul>
        <li v-for="item in run.result.limitations" :key="item">{{ item }}</li>
      </ul>
    </details>
    <details class="method-detail">
      <summary>{{ t("surveys.research.methodTitle") }}</summary>
      <p>{{ run.result.method }}</p>
    </details>
    <details class="provenance">
      <summary>{{ t("surveys.research.provenanceTitle") }}</summary>
      <p class="provenance-hint tw:text-muted">{{ t("surveys.provenanceHashHint") }}</p>
      <dl>
        <dt>{{ t("surveys.inputHash") }}</dt>
        <dd><code>{{ run.inputHash }}</code></dd>
        <dt>{{ t("surveys.resultHash") }}</dt>
        <dd><code>{{ run.resultHash }}</code></dd>
        <dt>{{ t("surveys.research.sourceSha") }}</dt>
        <dd><code>{{ run.sourceSha256 }}</code></dd>
        <dt>{{ t("surveys.research.engineVersion") }}</dt>
        <dd>{{ run.engineVersion }}</dd>
      </dl>
    </details>
  </article>
</template>
<style scoped>
.run-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--layout-card-padding);
  min-width: 0;
}
.result-head,
.result-title,
.result-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.result-title,
.result-actions {
  justify-content: flex-start;
}
.result-title h4 {
  margin: 0;
  font-size: 1.125rem;
}
.result-actions {
  margin-left: auto;
}
.result-summary {
  margin: 0;
  overflow-wrap: anywhere;
}
.result-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.result-metrics > div {
  min-width: 0;
  padding: 12px 16px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
}
.result-metrics dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.result-metrics dd {
  margin: 4px 0 0;
  font-size: 1.5rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.result-chart,
.result-tables,
.result-table {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
}
.result-chart {
  gap: 8px;
  padding: 16px 0;
  border-top: 1px solid var(--color-border-subtle);
}
.result-chart h5,
.result-tables > h5,
.result-table h6 {
  margin: 0;
  font-weight: 600;
}
.result-tables {
  gap: 16px;
}
.result-table {
  gap: 8px;
}
.chart-description {
  max-width: var(--layout-max-width-content);
  margin: 0;
  font-size: 13px;
}
.result-other,
.limitations,
.method-detail,
.provenance {
  min-width: 0;
}
.result-other > summary,
.limitations > summary,
.method-detail > summary,
.provenance > summary {
  cursor: pointer;
  color: var(--color-text-secondary);
}
.result-other[open] > summary {
  margin-bottom: 16px;
}
.result-other .result-table + .result-table {
  margin-top: 16px;
}
.run-result :deep(.p-datatable-table-container) {
  overflow-x: auto;
}
.limitations ul {
  margin: 8px 0 0;
  padding-left: 20px;
}
.method-detail p {
  max-width: var(--layout-max-width-content);
  margin: 8px 0 0;
}
.provenance dl {
  margin: 8px 0 0;
}
.provenance-hint {
  margin: 8px 0 0;
  font-size: 12.5px;
}
.provenance dd {
  margin: 0 0 8px;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
/* 哈希单行等宽 + 截断：64 位串换行占半屏，复查比对时完整值走导出。 */
.provenance dd code {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-family: var(--font-family-mono, ui-monospace, monospace);
}
@media (max-width: 767.98px) {
  .result-actions {
    width: 100%;
    margin-left: 0;
  }
  .result-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .result-metrics > div:last-child { grid-column: 1 / -1; padding: 8px 12px; }
  .result-metrics > div:last-child dd { font-size: 1rem; }
}
</style>
