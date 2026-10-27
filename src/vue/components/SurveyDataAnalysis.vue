<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Menu from "primevue/menu";
import Message from "primevue/message";
import { AsyncSlot } from "@mango-write/ui";
import type { SurveyDetail } from "../../contracts/index.js";
import { useSurveysApi } from "../api.js";
import type { SurveyDataset, SurveySampleExclusion } from "../lib/dataset.js";
import { buildSurveyDataset, toDatasetVariables } from "../lib/dataset.js";
import { summarizeDataset } from "../lib/summary.js";
import {
  useSurveysResearchPanel,
  type SurveysResearchContext,
} from "../research-host.js";
import type { SurveyStageNavigation } from "../workspace-navigation.js";
import SurveyResponseSummary from "./SurveyResponseSummary.vue";
import SurveyResponseTable from "./SurveyResponseTable.vue";
import SurveyVariableDictionary from "./SurveyVariableDictionary.vue";

const props = defineProps<{
  survey: SurveyDetail;
  mode: "data" | "analysis";
  revisionId?: string;
}>();
const emit = defineEmits<{
  "responses-loaded": [info: { revisionId: string; count: number }];
  "revision-change": [revisionId: string];
  "navigation-change": [model: SurveyStageNavigation];
  "run-change": [runId: string];
}>();
const { t } = useI18n();
const api = useSurveysApi();
const revisionId = ref(
  props.revisionId && props.survey.revisions.some((item) => item.id === props.revisionId)
    ? props.revisionId
    : (props.survey.currentRevisionId ?? ""),
);
const dataset = ref<SurveyDataset | null>(null);
const exclusions = ref<SurveySampleExclusion[]>([]);
const loading = ref(true);
const busy = ref(false);
const failed = ref(false);
const dataView = ref<"summary" | "table" | "variables">("summary");
const exportMenu = ref<InstanceType<typeof Menu> | null>(null);
const responseTableRef = ref<InstanceType<typeof SurveyResponseTable> | null>(null);
const variableDictionaryRef = ref<InstanceType<typeof SurveyVariableDictionary> | null>(null);
const researchPanelRef = ref<{ selectStageNavigation?: (id: string) => void } | null>(null);
const revisionNumber = computed(
  () => props.survey.revisions.find((item) => item.id === revisionId.value)?.revision ?? null,
);
const revisionOptions = computed(() =>
  props.survey.revisions.map((item) => ({
    value: item.id,
    label: t("surveys.revisionNumber", { n: item.revision }),
  })),
);
const dataViewOptions = computed(() => [
  { value: "summary" as const, label: t("surveys.summaryTab") },
  { value: "table" as const, label: t("surveys.responsesTab") },
  { value: "variables" as const, label: t("surveys.variableDictionary") },
]);
const exportItems = computed(() => [
  {
    label: t("surveys.exportData"),
    icon: "pi pi-download",
    command: () => void exportCsv(),
  },
  {
    label: t("surveys.codebook"),
    icon: "pi pi-book",
    command: () => void exportCodebook(),
  },
]);
const researchPanel = useSurveysResearchPanel();
const researchContext = computed<SurveysResearchContext>(() => ({
  surveyId: props.survey.id,
  revisionId: revisionId.value,
  canWrite: props.survey.canWrite,
  exclusions: exclusions.value,
}));
const navigation = computed<SurveyStageNavigation | null>(() => {
  if (!dataset.value || props.mode !== "data") return null;
  if (dataView.value === "summary") {
    return {
      title: t("surveys.summaryTab"),
      groups: [{
        id: "questions",
        items: summarizeDataset(dataset.value).map((summary) => ({
          id: `question:${summary.questionId}`,
          label: summary.title,
          meta: `${summary.answered}/${dataset.value!.responseCount}`,
        })),
      }],
    };
  }
  if (dataView.value === "table") {
    return {
      title: t("surveys.responsesTab"),
      groups: [{
        id: "responses",
        items: dataset.value.rows.map((row, index) => ({
          id: `response:${row.responseId}`,
          label: t("surveys.responseRecord", { n: index + 1 }),
          meta: exclusions.value.some((item) => item.responseId === row.responseId)
            ? t("surveys.excluded")
            : undefined,
        })),
      }],
    };
  }
  return {
    title: t("surveys.variableDictionary"),
    groups: [{
      id: "variables",
      items: dataset.value.variables.map((variable) => ({
        id: `variable:${variable.id}`,
        label: variable.label,
        meta: t(`surveys.variableKind.${variable.kind}`),
      })),
    }],
  };
});
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
async function exportCsv() {
  await perform(() => api.downloadExport(props.survey.id, "survey.csv", revisionId.value));
}
async function exportCodebook() {
  await perform(async () => {
    if (!revisionId.value) return;
    const codebook = await api.codebook(props.survey.id, revisionId.value);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(codebook, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "codebook.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
async function selectStageNavigation(id: string) {
  const [kind, ...rest] = id.split(":");
  const target = rest.join(":");
  if (kind === "question") {
    dataView.value = "summary";
    await nextTick();
    document.getElementById(`survey-summary-${target}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (kind === "response") {
    dataView.value = "table";
    await nextTick();
    await responseTableRef.value?.locateResponse(target);
    return;
  }
  if (kind === "variable") {
    dataView.value = "variables";
    await nextTick();
    await variableDictionaryRef.value?.locateVariable(target);
    return;
  }
  researchPanelRef.value?.selectStageNavigation?.(id);
}
defineExpose({ selectStageNavigation });
onMounted(() => void load());
watch(revisionId, () => {
  exclusions.value = [];
  emit("revision-change", revisionId.value);
  void load();
});
watch(
  () => props.revisionId,
  (value) => {
    if (value && value !== revisionId.value) revisionId.value = value;
  },
);
watch(
  () => props.survey.currentRevisionId,
  (value) => {
    if (!revisionId.value && value) revisionId.value = value;
  },
);
watch(navigation, (value) => {
  if (value) emit("navigation-change", value);
}, { immediate: true });
</script>

<template>
  <section class="data-analysis">
    <div class="data-context mw-toolbar">
      <div class="data-context__scope">
        <label>
          <span>{{ t("surveys.dataVersion") }}</span>
          <Select
            v-model="revisionId"
            :options="revisionOptions"
            option-label="label"
            option-value="value"
            :disabled="busy"
          />
        </label>
        <span v-if="dataset" class="data-context__count">
          {{ t("surveys.responsesCount", { n: dataset.responseCount }) }}
        </span>
      </div>
      <div class="data-context__actions">
        <Button
          icon="pi pi-refresh"
          text
          :aria-label="t('surveys.refresh')"
          v-tooltip.bottom="t('surveys.refresh')"
          :loading="busy"
          :disabled="!revisionId"
          @click="load"
        />
        <Button
          v-if="mode === 'data'"
          :label="t('surveys.export')"
          icon="pi pi-download"
          severity="secondary"
          :disabled="!revisionId"
          @click="exportMenu?.toggle($event)"
        />
        <Menu ref="exportMenu" :model="exportItems" popup />
      </div>
    </div>
    <Message v-if="failed" severity="error" :closable="false">
      {{ t("surveys.analysisFailed") }}
    </Message>
    <AsyncSlot
      :status="loading ? 'loading' : failed && !dataset ? 'error' : !revisionId ? 'empty' : 'ready'"
      skeleton="list"
      empty-title="surveys.publishFirst"
      empty-hint="surveys.publishFirstHint"
      error-title="surveys.requestFailed"
      @retry="load"
    >
      <template #empty-action>
        <span class="tw:text-muted">{{ t("surveys.returnToDesign") }}</span>
      </template>
      <template v-if="dataset">
        <template v-if="mode === 'data'">
          <div class="data-view-switch">
            <SelectButton
              v-model="dataView"
              :options="dataViewOptions"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              :aria-label="t('surveys.dataViewLabel')"
            />
          </div>
          <SurveyResponseSummary
            v-if="dataView === 'summary'"
            :dataset="dataset"
            :revision-number="revisionNumber"
          />
          <SurveyResponseTable
            v-else-if="dataView === 'table'"
            ref="responseTableRef"
            :dataset="dataset"
            :exclusions="exclusions"
            :can-write="survey.canWrite"
            @update:exclusions="exclusions = $event"
          />
          <SurveyVariableDictionary
            v-else
            ref="variableDictionaryRef"
            :dataset="dataset"
          />
        </template>
        <KeepAlive>
          <component
            :is="researchPanel"
            v-if="mode === 'analysis' && researchPanel"
            ref="researchPanelRef"
            :context="researchContext"
            @select-revision="revisionId = $event"
            @update-exclusions="exclusions = $event"
            @navigation-change="emit('navigation-change', $event)"
            @run-change="emit('run-change', $event)"
          />
        </KeepAlive>
      </template>
    </AsyncSlot>
  </section>
</template>

<style scoped>
.data-analysis {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--layout-card-padding);
  min-width: 0;
}
.data-context,
.data-context__scope,
.data-context__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.data-context {
  justify-content: space-between;
  min-height: 40px;
}
.data-context__scope {
  min-width: 0;
}
.data-context label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  white-space: nowrap;
}
.data-context__count {
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.data-view-switch {
  display: flex;
}
@media (max-width: 767.98px) {
  .data-context {
    align-items: flex-start;
  }
  .data-context__scope {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .data-context__actions {
    flex: none;
  }
  .data-context__actions :deep(.p-button) {
    padding-right: 8px;
    padding-left: 8px;
  }
}
</style>
