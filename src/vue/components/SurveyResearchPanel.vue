<script setup lang="ts">
// 研究分析面板（宿主注入面，issue #223 扩展缝的独立站/主站共用实现）：
// 数据来源（导入/选择）→ 研究计划（一键或极简角色选择）→ 固定运行结果。
// 用户不需要懂 SPSS：统计口径（HC3/bootstrap/EFA）由固定配方承担，界面只让
// 用户确认「数据从哪来、X/M/Y/W 是什么」。所有 research API 访问经 ../api.js
// 的 research 子面；权威契约见 ../contracts（SurveyResearchRecipe 判别联合）。
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import MultiSelect from "primevue/multiselect";
import Select from "primevue/select";
import Tag from "primevue/tag";
import type {
  ResearchDatasetDetail,
  ResearchDatasetSummary,
  SurveyResearchRecipe,
  ResearchRunDetail,
  ResearchRunSummary,
  SurveyCodebook,
} from "../../contracts/index.js";
import { AsyncSlot } from "@mango-write/ui";
import { useSurveysApi } from "../api.js";
import { useSurveysNotify } from "../notify.js";
import {
  buildModeratedMediationRecipe,
  buildResearchPlan,
  parseAnalysisModels,
  planHasModeratedMediation,
  usableConstructIds,
} from "../lib/research-plan.js";
import type { SurveysResearchContext } from "../research-host.js";
import SurveyResearchImportDialog from "./SurveyResearchImportDialog.vue";
import SurveyResearchRunResult from "./SurveyResearchRunResult.vue";

const props = defineProps<{
  context: SurveysResearchContext;
}>();
const { t, locale } = useI18n();
const api = useSurveysApi();
const notify = useSurveysNotify();

const loading = ref(true);
const failed = ref(false);
const codebook = ref<SurveyCodebook | null>(null);
const datasets = ref<ResearchDatasetSummary[]>([]);
const runs = ref<ResearchRunSummary[]>([]);
const activeDatasetId = ref("");
const datasetDetail = ref<ResearchDatasetDetail | null>(null);
const importOpen = ref(false);
const selectedRunId = ref("");
const runDetail = ref<ResearchRunDetail | null>(null);
const runLoading = ref(false);
const planBusy = ref(false);
const planProgress = ref("");

// 极简角色选择（无结构化模型时的兜底）：X/M/Y/W + 协变量 + 折叠的 bootstrap。
const roleX = ref<string>("");
const roleM = ref<string>("");
const roleY = ref<string>("");
const roleW = ref<string>("");
const roleCovariates = ref<string[]>([]);
const bootstrapResamples = ref<number>(1000);
const bootstrapSeed = ref<number>(20260902);

let generation = 0;
let runRequest = 0;
let datasetRequest = 0;
const runFailed = ref(false);
async function load() {
  const own = ++generation;
  loading.value = true;
  failed.value = false;
  datasetDetail.value = null;
  runDetail.value = null;
  selectedRunId.value = "";
  if (!props.context.revisionId) {
    codebook.value = null;
    datasets.value = [];
    runs.value = [];
    loading.value = false;
    return;
  }
  try {
    const [book, datasetItems, runItems] = await Promise.all([
      api.codebook(props.context.surveyId, props.context.revisionId),
      api.research.listDatasets(props.context.surveyId),
      api.research.listRuns(props.context.surveyId),
    ]);
    if (own !== generation) return;
    codebook.value = book;
    datasets.value = datasetItems.items;
    runs.value = runItems.items;
    if (datasets.value.length > 0) {
      await selectDataset(datasets.value[0]!.id, own);
    }
    if (own !== generation) return;
    if (runs.value.length > 0) {
      await selectRun(runs.value[0]!.id, own);
    }
  } catch {
    if (own === generation) failed.value = true;
  } finally {
    if (own === generation) loading.value = false;
  }
}

async function selectDataset(datasetId: string, own = generation) {
  const request = ++datasetRequest;
  activeDatasetId.value = datasetId;
  datasetDetail.value = null;
  try {
    const detail = await api.research.getDataset(
      props.context.surveyId,
      datasetId,
    );
    if (own === generation && request === datasetRequest)
      datasetDetail.value = detail;
  } catch {
    // 详情缺失不阻断主流程：计划与运行只依赖 datasetId。
    if (own === generation)
      notify.warn(t("surveys.research.datasetDetailFailed"));
  }
}

async function selectRun(runId: string, own = generation) {
  const request = ++runRequest;
  selectedRunId.value = runId;
  runFailed.value = false;
  runLoading.value = true;
  runDetail.value = null;
  try {
    const detail = await api.research.getRun(props.context.surveyId, runId);
    if (own === generation && request === runRequest) runDetail.value = detail;
  } catch {
    if (own === generation && request === runRequest) {
      runFailed.value = true;
      notify.error(t("surveys.research.runLoadFailed"));
    }
  } finally {
    if (own === generation && request === runRequest) runLoading.value = false;
  }
}

watch(
  () => [props.context.surveyId, props.context.revisionId] as const,
  () => void load(),
  { immediate: true },
);

// ── 计划推导 ────────────────────────────────────────────────────────────────
const constructs = computed(
  () => codebook.value?.definition.researchDesign?.constructs ?? [],
);
// analysisModels 现为 core 的结构化字段（SurveyAnalysisModel，kind 判别）；
// parseAnalysisModels 内部仍做防御式解析，契约漂移时跳过而不是崩溃。
const analysisModels = computed<unknown>(
  () => codebook.value?.definition.researchDesign?.analysisModels ?? null,
);
const hasStructuredModels = computed(
  () => Array.isArray(analysisModels.value) && analysisModels.value.length > 0,
);
const ignoredModels = computed(
  () => parseAnalysisModels(analysisModels.value).ignored,
);
const usableIds = computed(() =>
  usableConstructIds(
    constructs.value,
    codebook.value?.variables ?? [],
    datasetDetail.value?.columns ?? [],
  ),
);
const plan = computed<SurveyResearchRecipe[]>(() =>
  buildResearchPlan({
    usableConstructIds: usableIds.value,
    analysisModels: analysisModels.value,
  }),
);
const planNeedsManualMediation = computed(
  () => !planHasModeratedMediation(plan.value),
);

const refLabels = computed<Record<string, string>>(() => {
  const labels: Record<string, string> = {};
  for (const construct of constructs.value) {
    labels[`construct:${construct.id}`] = construct.label;
  }
  for (const variable of codebook.value?.variables ?? []) {
    labels[`variable:${variable.id}`] = variable.label;
  }
  return labels;
});

const numericVariables = computed(() =>
  (codebook.value?.variables ?? []).filter(
    (variable) => variable.kind === "number" || variable.kind === "ordinal",
  ),
);
const roleOptions = computed(() => [
  ...constructs.value.map((construct) => ({
    label: t("surveys.research.refConstruct", { label: construct.label }),
    value: `construct:${construct.id}`,
  })),
  ...numericVariables.value.map((variable) => ({
    label: t("surveys.research.refVariable", { label: variable.label }),
    value: `variable:${variable.id}`,
  })),
]);
const covariateOptions = computed(() =>
  roleOptions.value.filter(
    (option) =>
      option.value !== roleX.value &&
      option.value !== roleM.value &&
      option.value !== roleY.value &&
      option.value !== roleW.value,
  ),
);
const manualRolesIncomplete = computed(
  () =>
    !roleX.value ||
    !roleM.value ||
    !roleY.value ||
    !roleW.value ||
    new Set([roleX.value, roleM.value, roleY.value, roleW.value]).size < 4,
);

async function executeRecipes(recipes: SurveyResearchRecipe[]) {
  const datasetId = activeDatasetId.value;
  let lastRunId = "";
  planBusy.value = true;
  planProgress.value = "";
  try {
    for (let index = 0; index < recipes.length; index += 1) {
      planProgress.value = t("surveys.research.planProgress", {
        current: index + 1,
        total: recipes.length,
      });
      const run = await api.research.createRun(props.context.surveyId, {
        datasetId,
        recipe: recipes[index]!,
      });
      lastRunId = run.id;
    }
    const refreshed = await api.research.listRuns(props.context.surveyId);
    runs.value = refreshed.items;
    notify.success(t("surveys.research.planDone"));
    await selectRun(lastRunId);
  } catch {
    notify.error(t("surveys.research.planFailed"));
  } finally {
    planBusy.value = false;
    planProgress.value = "";
  }
}

function runPlan() {
  if (
    !props.context.canWrite ||
    planBusy.value ||
    !activeDatasetId.value ||
    plan.value.length === 0
  )
    return;
  void executeRecipes(plan.value);
}

function runManualMediation() {
  if (
    !props.context.canWrite ||
    !activeDatasetId.value ||
    planBusy.value ||
    manualRolesIncomplete.value
  )
    return;
  void executeRecipes([
    buildModeratedMediationRecipe({
      x: roleX.value,
      m: roleM.value,
      y: roleY.value,
      w: roleW.value,
      covariates: roleCovariates.value,
      resamples: bootstrapResamples.value,
      seed: bootstrapSeed.value,
    }),
  ]);
}

function onDatasetCreated(datasetId: string) {
  void (async () => {
    try {
      const refreshed = await api.research.listDatasets(props.context.surveyId);
      datasets.value = refreshed.items;
    } catch {
      notify.error(t("surveys.research.loadFailed"));
    }
    await selectDataset(datasetId);
  })();
}

function duplicateRowCount(detail: ResearchDatasetDetail) {
  // 契约已提供去重计数；旧服务实例缺该字段时按行哈希现算兜底。
  if (typeof detail.duplicateRowCount === "number")
    return detail.duplicateRowCount;
  return (
    detail.normalizedRowHashes.length - new Set(detail.normalizedRowHashes).size
  );
}
function runOptionLabel(run: ResearchRunSummary) {
  return new Date(run.createdAt).toLocaleString(locale.value, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
const resultDataset = computed(() =>
  datasets.value.find((dataset) => dataset.id === runDetail.value?.datasetId),
);
function shortHash(hash: string) {
  return hash.slice(0, 10);
}
const activeDataset = computed(
  () =>
    datasets.value.find((dataset) => dataset.id === activeDatasetId.value) ??
    null,
);
</script>
<template>
  <section class="research-panel">
    <div v-if="!context.revisionId" class="research-empty">
      <Message severity="info" :closable="false">
        <p class="empty-title">{{ t("surveys.research.unpublished") }}</p>
        <p class="empty-hint">{{ t("surveys.research.unpublishedHint") }}</p>
      </Message>
    </div>
    <AsyncSlot
      v-else
      :status="loading ? 'loading' : failed && !codebook ? 'error' : 'ready'"
      skeleton="list"
      error-title="surveys.research.loadFailed"
      @retry="load"
    >
      <div
        class="research-flow"
        :class="{ 'research-flow--has-results': runs.length > 0 }"
      >
        <div v-if="runs.length" class="panel-block results-block">
          <header class="block-head">
            <div>
              <h3>{{ t("surveys.research.runsTitle") }}</h3>
              <p class="tw:text-muted">{{ t("surveys.research.runsHint") }}</p>
            </div>
          </header>
          <nav
            class="run-history"
            :aria-label="t('surveys.research.runsTitle')"
          >
            <Button
              v-for="run in runs"
              :key="run.id"
              :severity="run.id === selectedRunId ? 'primary' : 'secondary'"
              :outlined="run.id !== selectedRunId"
              :aria-pressed="run.id === selectedRunId"
              @click="selectRun(run.id)"
            >
              <span class="run-tab"
                ><span>{{
                  t(`surveys.research.recipe.${run.recipe.type}`)
                }}</span
                ><time :datetime="run.createdAt">{{
                  runOptionLabel(run)
                }}</time></span
              >
            </Button>
          </nav>
          <p v-if="resultDataset" class="result-dataset tw:text-muted">
            {{ resultDataset.name }} ·
            {{
              t("surveys.research.datasetRowCount", {
                n: resultDataset.rowCount,
              })
            }}
          </p>
          <AsyncSlot
            :status="
              runLoading
                ? 'loading'
                : runFailed
                  ? 'error'
                  : runDetail
                    ? 'ready'
                    : 'empty'
            "
            skeleton="list"
            error-title="surveys.research.runLoadFailed"
            @retry="selectRun(selectedRunId)"
            empty-title="surveys.research.noRuns"
            empty-hint="surveys.research.noRunsHint"
          >
            <SurveyResearchRunResult
              v-if="runDetail"
              :survey-id="context.surveyId"
              :run="runDetail"
              :ref-labels="refLabels"
            />
          </AsyncSlot>
        </div>
        <details class="research-settings" :open="!runs.length">
          <summary>
            <span>{{ t("surveys.research.settingsTitle") }}</span>
            <span v-if="activeDataset" class="settings-context">{{
              activeDataset.name
            }}</span>
          </summary>
          <div class="settings-sections">
            <div class="panel-block">
              <header class="block-head">
                <div>
                  <h3>
                    <span v-if="!runs.length" class="step-number">1</span
                    >{{ t("surveys.research.datasetsTitle") }}
                  </h3>
                  <p class="tw:text-muted">
                    {{ t("surveys.research.datasetsHint") }}
                  </p>
                </div>
                <Button
                  :label="t('surveys.research.importDataset')"
                  icon="pi pi-upload"
                  severity="secondary"
                  :disabled="!context.canWrite"
                  @click="importOpen = true"
                />
              </header>
              <div v-if="datasets.length" class="dataset-list">
                <div
                  v-for="dataset in datasets"
                  :key="dataset.id"
                  class="dataset-row"
                  :class="{
                    'dataset-row--active': dataset.id === activeDatasetId,
                  }"
                >
                  <button
                    type="button"
                    class="dataset-main"
                    :disabled="planBusy"
                    :aria-pressed="dataset.id === activeDatasetId"
                    @click="selectDataset(dataset.id)"
                  >
                    <span class="dataset-name">
                      {{ dataset.name }}
                      <Tag
                        :value="
                          dataset.source.kind === 'synthetic'
                            ? t('surveys.research.sourceSynthetic')
                            : t('surveys.research.sourcePublic')
                        "
                        :severity="
                          dataset.source.kind === 'synthetic'
                            ? 'warn'
                            : 'secondary'
                        "
                      />
                      <span
                        v-if="dataset.id === activeDatasetId"
                        class="dataset-active tw:text-muted"
                        >{{ t("surveys.research.inUse") }}</span
                      >
                    </span>
                    <span class="dataset-meta tw:text-muted">
                      {{
                        t("surveys.research.datasetRowCount", {
                          n: dataset.rowCount,
                        })
                      }}
                      · {{ t("surveys.research.sourceSha") }}
                      {{ shortHash(dataset.sourceSha256) }} ·
                      {{ new Date(dataset.createdAt).toLocaleString() }}
                    </span>
                    <span
                      v-if="dataset.source.kind === 'public'"
                      class="dataset-source tw:text-muted"
                    >
                      {{ dataset.source.citation }} ·
                      {{ dataset.source.license }}
                    </span>
                    <span
                      v-else-if="dataset.source.kind === 'synthetic'"
                      class="dataset-source dataset-source--synthetic"
                    >
                      {{ t("surveys.research.syntheticNotice") }}
                    </span>
                  </button>
                </div>
                <p v-if="datasetDetail" class="dataset-quality tw:text-muted">
                  <template v-if="duplicateRowCount(datasetDetail) > 0"
                    >{{
                      t("surveys.research.duplicateRows", {
                        n: duplicateRowCount(datasetDetail),
                      })
                    }}
                    · </template
                  >{{
                    t("surveys.research.columnCount", {
                      n: datasetDetail.columns.length,
                    })
                  }}
                </p>
              </div>
              <div v-else class="dataset-empty">
                <p>{{ t("surveys.research.noDatasets") }}</p>
                <p class="tw:text-muted">
                  {{ t("surveys.research.noDatasetsHint") }}
                </p>
                <Button
                  :label="t('surveys.research.importDataset')"
                  icon="pi pi-upload"
                  :disabled="!context.canWrite"
                  @click="importOpen = true"
                />
              </div>
            </div>

            <div class="panel-block">
              <header class="block-head">
                <div>
                  <h3>
                    <span v-if="!runs.length" class="step-number">2</span
                    >{{ t("surveys.research.planTitle") }}
                  </h3>
                  <p class="tw:text-muted">
                    {{ t("surveys.research.planHint") }}
                  </p>
                </div>
              </header>
              <Message
                v-if="!activeDatasetId"
                severity="info"
                :closable="false"
                >{{ t("surveys.research.pickDatasetFirst") }}</Message
              >
              <template v-else>
                <ol v-if="plan.length" class="plan-preview">
                  <li v-for="(recipe, index) in plan" :key="index">
                    {{ t(`surveys.research.recipe.${recipe.type}`) }}
                  </li>
                </ol>
                <div v-if="plan.length > 0" class="plan-run">
                  <Button
                    :label="t('surveys.research.runPlan')"
                    icon="pi pi-play"
                    :disabled="planBusy || !context.canWrite"
                    :loading="planBusy"
                    @click="runPlan"
                  />
                  <span v-if="planProgress" class="tw:text-muted">{{
                    planProgress
                  }}</span>
                  <span
                    v-else-if="planNeedsManualMediation"
                    class="tw:text-muted"
                    >{{ t("surveys.research.planMissingMediation") }}</span
                  >
                </div>
                <Message
                  v-if="ignoredModels > 0"
                  severity="warn"
                  :closable="false"
                  >{{
                    t("surveys.research.modelsIgnored", { n: ignoredModels })
                  }}</Message
                >
                <div v-if="planNeedsManualMediation" class="manual-plan">
                  <p class="manual-title">
                    {{ t("surveys.research.manualTitle") }}
                  </p>
                  <div class="role-grid">
                    <label
                      >{{ t("surveys.research.roleX")
                      }}<Select
                        v-model="roleX"
                        :options="roleOptions"
                        option-label="label"
                        option-value="value"
                        :placeholder="t('surveys.research.rolePick')"
                        fluid
                        :aria-label="t('surveys.research.roleX')"
                    /></label>
                    <label
                      >{{ t("surveys.research.roleM")
                      }}<Select
                        v-model="roleM"
                        :options="roleOptions"
                        option-label="label"
                        option-value="value"
                        :placeholder="t('surveys.research.rolePick')"
                        fluid
                        :aria-label="t('surveys.research.roleM')"
                    /></label>
                    <label
                      >{{ t("surveys.research.roleY")
                      }}<Select
                        v-model="roleY"
                        :options="roleOptions"
                        option-label="label"
                        option-value="value"
                        :placeholder="t('surveys.research.rolePick')"
                        fluid
                        :aria-label="t('surveys.research.roleY')"
                    /></label>
                    <label
                      >{{ t("surveys.research.roleW")
                      }}<Select
                        v-model="roleW"
                        :options="roleOptions"
                        option-label="label"
                        option-value="value"
                        :placeholder="t('surveys.research.rolePick')"
                        fluid
                        :aria-label="t('surveys.research.roleW')"
                    /></label>
                    <label
                      >{{ t("surveys.research.roleCovariates")
                      }}<MultiSelect
                        v-model="roleCovariates"
                        :options="covariateOptions"
                        option-label="label"
                        option-value="value"
                        :placeholder="t('surveys.research.rolePick')"
                        fluid
                        :aria-label="t('surveys.research.roleCovariates')"
                    /></label>
                  </div>
                  <details class="advanced">
                    <summary>{{ t("surveys.research.advancedTitle") }}</summary>
                    <div class="role-grid">
                      <label
                        >{{ t("surveys.research.bootstrapResamples")
                        }}<InputNumber
                          v-model="bootstrapResamples"
                          :min="100"
                          :max="5000"
                          :step="100"
                          fluid
                          :aria-label="
                            t('surveys.research.bootstrapResamples')
                          "
                      /></label>
                      <label
                        >{{ t("surveys.research.bootstrapSeed")
                        }}<InputNumber
                          v-model="bootstrapSeed"
                          :min="0"
                          :max="4294967295"
                          fluid
                          :aria-label="t('surveys.research.bootstrapSeed')"
                      /></label>
                    </div>
                  </details>
                  <div class="plan-run">
                    <Button
                      :label="t('surveys.research.runMediation')"
                      icon="pi pi-play"
                      severity="secondary"
                      :disabled="
                        planBusy || manualRolesIncomplete || !context.canWrite
                      "
                      :loading="planBusy"
                      @click="runManualMediation"
                    />
                    <span
                      v-if="manualRolesIncomplete && !planBusy"
                      class="tw:text-muted"
                      >{{ t("surveys.research.roleIncomplete") }}</span
                    >
                  </div>
                </div>
              </template>
            </div>
          </div>
        </details>
        <Message v-if="!runs.length" severity="info" :closable="false">{{
          t("surveys.research.noRunsHint")
        }}</Message>
      </div>
    </AsyncSlot>
    <SurveyResearchImportDialog
      v-model:visible="importOpen"
      :survey-id="context.surveyId"
      :revision-id="context.revisionId"
      :can-write="context.canWrite"
      :variables="codebook?.variables ?? []"
      @created="onDatasetCreated"
    />
  </section>
</template>
<style scoped>
.research-panel {
  display: grid;
  gap: var(--layout-card-padding);
}
.empty-title {
  margin: 0;
  font-weight: 600;
}
.empty-hint {
  margin: 0.25rem 0 0;
}
.panel-block {
  display: grid;
  gap: 0.75rem;
}
.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.block-head h3 {
  margin: 0;
  font-size: 1rem;
}
.block-head p {
  margin: 0.25rem 0 0;
}
.block-head .run-select {
  max-width: 22rem;
}
.dataset-list,
.dataset-empty,
.plan-run,
.manual-plan {
  display: grid;
  gap: 0.75rem;
}
.dataset-row {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
}
.dataset-row--active {
  border-color: var(--color-border-strong);
}
.dataset-main {
  display: grid;
  gap: 0.25rem;
  width: 100%;
  padding: 0.75rem;
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dataset-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-weight: 500;
}
.dataset-source--synthetic {
  color: var(--color-warning-600);
}
.dataset-quality {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.dataset-empty p {
  margin: 0;
}
.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
}
.role-grid label {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}
.manual-plan {
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 0.75rem;
}
.manual-title {
  margin: 0;
  font-weight: 500;
}
.advanced summary {
  cursor: pointer;
  color: var(--color-text-secondary);
}
.plan-run {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.research-flow,
.settings-sections {
  display: grid;
  gap: 28px;
  min-width: 0;
}
.research-settings {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  min-width: 0;
}
.research-settings > summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  cursor: pointer;
  font-weight: 600;
}
.research-settings > summary::before {
  content: "+";
  color: var(--color-brand-600);
}
.research-settings[open] > summary::before {
  content: "−";
}
.settings-context {
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}
.settings-sections {
  padding: 4px 20px 20px;
}
.settings-sections > .panel-block + .panel-block {
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 24px;
}
.step-number {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: 8px;
  color: var(--color-brand-600);
  background: var(--color-bg-soft);
  border-radius: var(--radius-sm);
}
.plan-preview {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 22px;
  color: var(--color-text-secondary);
}
.run-history {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.run-history :deep(.p-button) {
  flex: none;
  text-align: left;
}
.run-tab {
  display: grid;
  gap: 3px;
}
.run-tab time {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.8;
}
.result-dataset {
  margin: 0;
  overflow-wrap: anywhere;
}
.panel-block {
  min-width: 0;
}
@media (max-width: 600px) {
  .role-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .research-settings > summary {
    flex-wrap: wrap;
    padding: 14px;
  }
  .settings-sections {
    padding: 0 14px 14px;
  }
  .dataset-meta,
  .dataset-source {
    overflow-wrap: anywhere;
  }
}
</style>
