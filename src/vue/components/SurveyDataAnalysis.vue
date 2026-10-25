<script setup lang="ts">
// 数据段（issue #223 拆分边界）。包内保留：版本选择、原始数据导出/变量字典、
// 逐题摘要视图（SurveyResponseSummary）与答卷列表（搜索、样本排除与恢复），
// 数据由 responses + codebook 在客户端投影（../lib/dataset.js）。划给宿主扩展：
// 研究分析（analyses/runs/chart、结果表、图表预览、用于论文）——经
// ../research-host.js 的 SurveysResearchPanelKey 注入面板组件，本组件只提供
// 挂载点与激活状态（context + select-revision 回传），包内不含 research API 调用。
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Select from "primevue/select";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Message from "primevue/message";
import SelectButton from "primevue/selectbutton";
import type { SurveyDetail } from "../../contracts/index.js";
import { AsyncSlot } from "@mango-write/ui";
import { useSurveysApi } from "../api.js";
import type {
  SurveyDataset,
  SurveyDatasetRow,
  SurveyDatasetValue,
  SurveySampleExclusion,
} from "../lib/dataset.js";
import { buildSurveyDataset, toDatasetVariables } from "../lib/dataset.js";
import {
  useSurveysResearchPanel,
  type SurveysResearchContext,
} from "../research-host.js";
import SurveyResponseSummary from "./SurveyResponseSummary.vue";
const props = defineProps<{
  survey: SurveyDetail;
  mode: "data" | "analysis";
}>();
// 生命周期徽标与数据段的口径同步：答卷列表每次加载/换版本后，把「选中版本的
// 答卷数」上报给工作台，由宿主刷新 detail 的 completedCount。
const emit = defineEmits<{
  "responses-loaded": [info: { revisionId: string; count: number }];
}>();
const { t } = useI18n();
const api = useSurveysApi();
const revisionId = ref(props.survey.currentRevisionId ?? ""),
  dataset = ref<SurveyDataset | null>(null),
  selectedRows = ref<SurveyDatasetRow[]>([]),
  excludeOpen = ref(false),
  reason = ref(""),
  exclusions = ref<SurveySampleExclusion[]>([]);
const loading = ref(true),
  busy = ref(false),
  failed = ref(false);
const tableSearch = ref("");
// 数据段双视图（issue #217）：默认逐题摘要（信息密度高，一眼看结论），
// 答卷列表是记录级下钻（搜索/排除样本在工作在这里）。
const dataView = ref<"summary" | "table">("summary");
const dataViewOptions = computed(() => [
  { value: "summary" as const, label: t("surveys.summaryTab") },
  { value: "table" as const, label: t("surveys.responsesTab") },
]);
const revisionNumber = computed(
  () =>
    props.survey.revisions.find((r) => r.id === revisionId.value)?.revision ??
    null,
);
const revisionOptions = computed(() =>
  props.survey.revisions.map((r) => ({
    value: r.id,
    label: t("surveys.revisionNumber", { n: r.revision }),
  })),
);
const tableRows = computed(() => {
  const term = tableSearch.value.trim().toLocaleLowerCase();
  return (
    dataset.value?.rows.filter(
      (row) =>
        !term ||
        dataset.value!.variables.some((v) =>
          (row.missing[v.id]
            ? t(`surveys.missingKind.${row.missing[v.id]}`)
            : displayValue(v.id, row.values[v.id])
          )
            .toLocaleLowerCase()
            .includes(term),
        ),
    ) ?? []
  );
});
// 研究扩展缝：面板由宿主注入（缺省 null = 独立站，不出分析挂载点）。
const researchPanel = useSurveysResearchPanel();
const researchContext = computed<SurveysResearchContext>(() => ({
  surveyId: props.survey.id,
  revisionId: revisionId.value,
  canWrite: props.survey.canWrite,
  exclusions: exclusions.value,
}));
let generation = 0;
async function load() {
  const own = ++generation;
  loading.value = true;
  failed.value = false;
  try {
    if (!revisionId.value) {
      dataset.value = null;
      return;
    }
    const [views, codebook] = await Promise.all([
      api.responses(props.survey.id, revisionId.value),
      api.codebook(props.survey.id, revisionId.value),
    ]);
    if (own !== generation) return;
    dataset.value = buildSurveyDataset({
      surveyId: props.survey.id,
      revisionId: revisionId.value,
      title: props.survey.title,
      definition: codebook.definition,
      variables: toDatasetVariables(codebook.variables),
      responses: views.items,
    });
    emit("responses-loaded", {
      revisionId: revisionId.value,
      count: dataset.value.responseCount,
    });
  } catch {
    if (own === generation) failed.value = true;
  } finally {
    if (own === generation) loading.value = false;
  }
}
async function perform(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  try {
    await fn();
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
function displayValue(id: string, value: SurveyDatasetValue | undefined) {
  const variable = dataset.value?.variables.find((v) => v.id === id);
  const one = (v: string | number) =>
    variable?.options?.find((o) => o.id === v)?.label ?? String(v);
  return value === null || value === undefined
    ? t("surveys.missing")
    : Array.isArray(value)
      ? value.map(one).join(" / ")
      : one(value);
}
function exclusion(id: string) {
  return exclusions.value.find((e) => e.responseId === id);
}
function exclude() {
  for (const row of selectedRows.value) {
    if (!exclusion(row.responseId))
      exclusions.value.push({
        responseId: row.responseId,
        reason: reason.value.trim(),
      });
  }
  excludeOpen.value = false;
  selectedRows.value = [];
  reason.value = "";
}
async function exportCsv() {
  await perform(() =>
    api.downloadExport(props.survey.id, "survey.csv", revisionId.value),
  );
}
async function exportCodebook() {
  await perform(async () => {
    if (!revisionId.value) return;
    const codebook = await api.codebook(props.survey.id, revisionId.value);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(codebook, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "codebook.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
onMounted(() => {
  void load();
});
watch(revisionId, () => {
  selectedRows.value = [];
  exclusions.value = [];
  void load();
});
watch(
  () => props.survey.currentRevisionId,
  (value) => {
    if (!revisionId.value && value) revisionId.value = value;
  },
);
</script>
<template>
  <section class="data-analysis">
    <div class="data-toolbar mw-toolbar">
      <label
        >{{ t("surveys.dataVersion")
        }}<Select
          v-model="revisionId"
          fluid
          :options="revisionOptions"
          option-label="label"
          option-value="value"
          :disabled="busy"
      /></label>
      <div class="data-actions">
        <Button
          :label="t('surveys.refresh')"
          icon="pi pi-refresh"
          text
          :disabled="busy || !revisionId"
          @click="load"
        /><Button
          v-if="mode === 'data'"
          :label="t('surveys.exportData')"
          icon="pi pi-download"
          severity="secondary"
          :disabled="!revisionId"
          @click="exportCsv"
        /><Button
          v-if="mode === 'data'"
          :label="t('surveys.codebook')"
          severity="secondary"
          :disabled="!revisionId"
          @click="exportCodebook"
        />
      </div>
    </div>
    <Message v-if="failed" severity="error" :closable="false">{{
      t("surveys.analysisFailed")
    }}</Message>
    <AsyncSlot
      :status="
        loading
          ? 'loading'
          : failed && !dataset
            ? 'error'
            : !revisionId
              ? 'empty'
              : 'ready'
      "
      skeleton="list"
      empty-title="surveys.publishFirst"
      empty-hint="surveys.publishFirstHint"
      error-title="surveys.requestFailed"
      @retry="load"
    >
      <template #empty-action
        ><span class="tw:text-muted">{{
          t("surveys.returnToDesign")
        }}</span></template
      >
      <template v-if="dataset">
        <template v-if="mode === 'data'">
          <div class="data-toolbar">
            <SelectButton
              v-model="dataView"
              :options="dataViewOptions"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              :aria-label="t('surveys.dataViewLabel')"
            />
            <p class="tw:text-muted">
              {{ t("surveys.responsesCount", { n: dataset.responseCount }) }}
            </p>
            <Button
              v-if="dataView === 'table'"
              :label="t('surveys.excludeSelected', { n: selectedRows.length })"
              severity="secondary"
              :disabled="!selectedRows.length || !survey.canWrite"
              @click="excludeOpen = true"
            />
          </div>
          <!-- 逐题摘要：纯客户端聚合，口径 = 当前加载的发布版本。 -->
          <SurveyResponseSummary
            v-if="dataView === 'summary'"
            :dataset="dataset"
            :revision-number="revisionNumber"
          />
          <template v-else>
            <label
              >{{ t("surveys.searchData")
              }}<InputText
                v-model="tableSearch"
                fluid
                :placeholder="t('surveys.searchData')"
                :aria-label="t('surveys.searchData')"
              /><small class="tw:text-muted">{{
                t("surveys.searchDataHint")
              }}</small></label
            >
          <!-- 横滚只发生在表自己的容器里，工具条与分页留在视区内不随宽表走。 -->
          <DataTable
            v-model:selection="selectedRows"
            :value="tableRows"
            data-key="responseId"
            paginator
            :rows="20"
            scrollable
            size="small"
            :empty-message="t('surveys.noResponses')"
            ><Column
              selection-mode="multiple"
              header-style="width:3rem"
            /><Column
              v-for="v in dataset.variables"
              :key="v.id"
              :field="`values.${v.id}`"
              :header="v.label"
              sortable
              ><template #body="{ data }"
                ><span
                  :class="{ 'tw:text-muted': data.values[v.id] == null }"
                  >{{
                    data.missing[v.id]
                      ? t(`surveys.missingKind.${data.missing[v.id]}`)
                      : displayValue(v.id, data.values[v.id])
                  }}</span
                ></template
              ></Column
            ><Column :header="t('surveys.sampleState')"
              ><template #body="{ data }"
                ><span
                  v-if="exclusion(data.responseId)"
                  class="tw:text-muted"
                  :title="exclusion(data.responseId)?.reason"
                  >{{ t("surveys.excluded") }}</span
                ><span v-else>{{ t("surveys.included") }}</span></template
              ></Column
            ><template #empty>{{
              t("surveys.noResponses")
            }}</template></DataTable
          >
          <!-- 样本排除留包内（独立站可用）；已排除的记录可就地恢复。 -->
          <details v-if="exclusions.length" class="codebook">
            <summary>
              {{ t("surveys.excludedCount", { n: exclusions.length }) }}
            </summary>
            <div
              v-for="(item, index) in exclusions"
              :key="item.responseId"
              class="exclusion-row"
            >
              <span class="tw:text-muted">{{ item.reason }}</span
              ><Button
                icon="pi pi-undo"
                text
                :aria-label="t('surveys.restoreSample')"
                @click="exclusions.splice(index, 1)"
              />
            </div>
          </details>
          <details class="codebook">
            <summary>{{ t("surveys.variableDictionary") }}</summary>
            <p class="codebook-hint tw:text-muted">
              {{ t("surveys.variableDictionaryHint") }}
            </p>
            <dl>
              <template v-for="v in dataset.variables" :key="v.id"
                ><dt>
                  {{ v.label }} <code class="tw:text-muted">{{ v.id }}</code>
                </dt>
                <dd class="tw:text-muted">
                  {{ t(`surveys.variableKind.${v.kind}`)
                  }}<span v-for="o in v.options" :key="o.id">
                    · {{ o.id }} = {{ o.label }}</span
                  >
                </dd></template
              >
            </dl>
          </details>
          </template>
        </template>
        <!-- 研究分析挂载点：面板组件由宿主注入，select-revision 回传深链定位。 -->
        <KeepAlive>
          <component
            :is="researchPanel"
            v-if="mode === 'analysis' && researchPanel"
            :context="researchContext"
            @select-revision="revisionId = $event"
            @update-exclusions="exclusions = $event"
          />
        </KeepAlive>
      </template>
    </AsyncSlot>
    <Dialog
      v-model:visible="excludeOpen"
      modal
      :header="t('surveys.excludeSamples')"
      class="survey-dialog"
      ><label
        >{{ t("surveys.exclusionReason")
        }}<Textarea v-model="reason" fluid :maxlength="200" rows="3" /></label
      ><template #footer
        ><Button
          :label="t('surveys.cancel')"
          text
          severity="secondary"
          @click="excludeOpen = false" /><Button
          :label="t('surveys.excludeSamples')"
          :disabled="!reason.trim()"
          @click="exclude" /></template
    ></Dialog>
  </section>
</template>
<style scoped>
.data-analysis {
  display: grid;
  /* 单列轨道钳在容器宽度内：答卷宽表的横滚交给表自己的滚动容器（PrimeVue
     不默认给 overflow），工具条与版本选择不再被 1946px 的表格撑出视区右端。 */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--layout-card-padding);
}
/* 宽表横向滚动收在 DataTable 容器内：表头/表体一起滚，分页器固定不随滚。 */
.data-analysis :deep(.p-datatable-table-container) {
  overflow-x: auto;
}
.data-toolbar,
.data-actions,
.exclusion-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
label {
  display: grid;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
}
.data-toolbar > label {
  width: min(100%, 22rem);
}
.codebook {
  margin-top: var(--layout-card-padding);
}
.codebook-hint {
  margin: 0 0 0.5rem;
}
.codebook dd {
  margin: 0.5rem 0 1rem;
}
code {
  overflow-wrap: anywhere;
}
@media (max-width: 767.98px) {
  .data-toolbar > label {
    width: 100%;
  }
  .data-actions {
    justify-content: flex-start;
  }
}
</style>
