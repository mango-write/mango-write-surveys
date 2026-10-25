<script setup lang="ts">
// 固定运行结果视图：来源与指纹、有效 n/缺失、警告与限制、全部结果表；
// 调节中介的条件间接效应与简单斜率额外给中文解读并高亮。数字 4 位有效数字，
// 不可计算显示文案而不是空白。报告/下载走固定 run 的只读端点。
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type { ResearchRunDetail, SurveyResearchTable } from "../../contracts/index.js";
import { useSurveysApi } from "../api.js";
import { formatResearchNumber } from "../lib/research-format.js";

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
const isModeratedMediation = computed(() => recipe.value.type === "moderatedMediation");
const highlightedTableIds = new Set(["conditional_indirect", "simple_slopes"]);

function cellText(value: string | number | null) {
  return formatResearchNumber(value) ?? t("surveys.research.notComputable");
}
function shortHash(hash: string) {
  return hash.slice(0, 10);
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
    <p class="result-meta">
      <span>{{ t("surveys.research.effectiveN", { n: run.result.effectiveN }) }}</span>
      <span>{{
        t("surveys.research.missingRows", { n: run.result.missingRows })
      }}</span>
      <span>{{ t("surveys.resultRecordedAt", { time: new Date(run.createdAt).toLocaleString() }) }}</span>
    </p>
    <Message
      v-for="warning in run.result.warnings"
      :key="warning"
      severity="warn"
      :closable="false"
      >{{ warning }}</Message
    >
    <template v-if="isModeratedMediation">
      <div class="mm-guide">
        <p>{{ t("surveys.research.mmIndirectGuide") }}</p>
        <p>{{ t("surveys.research.mmSlopeGuide") }}</p>
      </div>
    </template>
    <section
      v-for="table in run.result.tables"
      :key="table.id"
      class="result-table"
      :class="{ 'result-table--key': highlightedTableIds.has(table.id) }"
    >
      <h5>{{ table.title }}</h5>
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
    <details v-if="run.result.limitations.length" class="limitations">
      <summary>{{ t("surveys.research.limitations") }}</summary>
      <ul>
        <li v-for="item in run.result.limitations" :key="item">{{ item }}</li>
      </ul>
    </details>
    <details class="provenance">
      <summary>{{ t("surveys.research.provenanceTitle") }}</summary>
      <dl>
        <dt>{{ t("surveys.inputHash") }}</dt>
        <dd><code>{{ shortHash(run.inputHash) }}</code>（{{ run.inputHash }}）</dd>
        <dt>{{ t("surveys.resultHash") }}</dt>
        <dd><code>{{ shortHash(run.resultHash) }}</code>（{{ run.resultHash }}）</dd>
        <dt>{{ t("surveys.research.sourceSha") }}</dt>
        <dd><code>{{ shortHash(run.sourceSha256) }}</code>（{{ run.sourceSha256 }}）</dd>
        <dt>{{ t("surveys.research.engineVersion") }}</dt>
        <dd>{{ run.engineVersion }}</dd>
      </dl>
    </details>
  </article>
</template>
<style scoped>
.run-result {
  display: grid;
  gap: var(--layout-card-padding);
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
}
.result-actions {
  margin-left: auto;
}
.result-summary,
.result-meta {
  margin: 0;
}
.result-meta {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
}
.mm-guide {
  border-left: 3px solid var(--color-border-strong);
  padding-left: 0.75rem;
  display: grid;
  gap: 0.25rem;
}
.mm-guide p {
  margin: 0;
}
.result-table--key h5 {
  color: var(--color-brand-600);
}
.result-table h5 {
  margin: 0 0 0.5rem;
  font-weight: 600;
}
.run-result :deep(.p-datatable-table-container) {
  overflow-x: auto;
}
.limitations,
.provenance {
  margin-top: 0.25rem;
}
.limitations ul {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
}
.provenance dl {
  margin: 0.5rem 0 0;
}
.provenance dd {
  margin: 0 0 0.5rem;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
</style>
