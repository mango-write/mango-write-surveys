<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import type {
  SurveyDataset,
  SurveyDatasetRow,
  SurveyDatasetValue,
  SurveySampleExclusion,
} from "../lib/dataset.js";

const props = defineProps<{
  dataset: SurveyDataset;
  exclusions: SurveySampleExclusion[];
  canWrite: boolean;
}>();
const emit = defineEmits<{
  "update:exclusions": [items: SurveySampleExclusion[]];
}>();
const { t } = useI18n();
const search = ref("");
const selectedRows = ref<SurveyDatasetRow[]>([]);
const excludeOpen = ref(false);
const reason = ref("");
const first = ref(0);
const rowsPerPage = 20;
const recordNumbers = computed(
  () => new Map(props.dataset.rows.map((row, index) => [row.responseId, index + 1])),
);
const tableRows = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  return props.dataset.rows.filter(
    (row) =>
      !term ||
      props.dataset.variables.some((variable) =>
        (row.missing[variable.id]
          ? t(`surveys.missingKind.${row.missing[variable.id]}`)
          : displayValue(variable.id, row.values[variable.id])
        )
          .toLocaleLowerCase()
          .includes(term),
      ),
  );
});
function displayValue(id: string, value: SurveyDatasetValue | undefined) {
  const variable = props.dataset.variables.find((item) => item.id === id);
  const one = (entry: string | number) =>
    variable?.options?.find((option) => option.id === entry)?.label ?? String(entry);
  return value === null || value === undefined
    ? t("surveys.missing")
    : Array.isArray(value)
      ? value.map(one).join(" / ")
      : one(value);
}
function exclusion(id: string) {
  return props.exclusions.find((item) => item.responseId === id);
}
function exclude() {
  const next = [...props.exclusions];
  for (const row of selectedRows.value) {
    if (!next.some((item) => item.responseId === row.responseId)) {
      next.push({ responseId: row.responseId, reason: reason.value.trim() });
    }
  }
  emit("update:exclusions", next);
  selectedRows.value = [];
  reason.value = "";
  excludeOpen.value = false;
}
function restore(responseId: string) {
  emit(
    "update:exclusions",
    props.exclusions.filter((item) => item.responseId !== responseId),
  );
}
function rowClass(row: SurveyDatasetRow) {
  return `response-record-${recordNumbers.value.get(row.responseId)}`;
}
async function locateResponse(responseId: string) {
  const index = props.dataset.rows.findIndex((row) => row.responseId === responseId);
  if (index < 0) return;
  search.value = "";
  first.value = Math.floor(index / rowsPerPage) * rowsPerPage;
  await nextTick();
  document
    .querySelector(`.response-record-${index + 1}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
defineExpose({ locateResponse });
</script>

<template>
  <section class="response-table-view">
    <div class="response-toolbar mw-toolbar">
      <label class="response-search">
        <i class="pi pi-search" aria-hidden="true" />
        <InputText
          v-model="search"
          :placeholder="t('surveys.searchData')"
          :aria-label="t('surveys.searchData')"
        />
      </label>
      <span class="response-count">{{ t("surveys.responsesCount", { n: dataset.responseCount }) }}</span>
    </div>
    <div v-if="selectedRows.length" class="selection-bar">
      <span>{{ t("surveys.selectedCount", { n: selectedRows.length }) }}</span>
      <Button
        :label="t('surveys.excludeSelected', { n: selectedRows.length })"
        icon="pi pi-filter-slash"
        severity="secondary"
        :disabled="!canWrite"
        @click="excludeOpen = true"
      />
    </div>
    <DataTable
      v-model:selection="selectedRows"
      v-model:first="first"
      :value="tableRows"
      data-key="responseId"
      paginator
      :rows="rowsPerPage"
      scrollable
      :row-class="rowClass"
      :empty-message="t('surveys.noResponses')"
    >
      <Column selection-mode="multiple" header-style="width:3rem" />
      <Column :header="t('surveys.responseRecordLabel')" frozen>
        <template #body="{ data }">
          <span class="record-label">{{ t("surveys.responseRecord", { n: recordNumbers.get(data.responseId) }) }}</span>
        </template>
      </Column>
      <Column
        v-for="variable in dataset.variables"
        :key="variable.id"
        :field="`values.${variable.id}`"
        :header="variable.label"
        sortable
      >
        <template #body="{ data }">
          <span :class="{ 'tw:text-muted': data.values[variable.id] == null }">
            {{ data.missing[variable.id]
              ? t(`surveys.missingKind.${data.missing[variable.id]}`)
              : displayValue(variable.id, data.values[variable.id]) }}
          </span>
        </template>
      </Column>
      <Column :header="t('surveys.sampleState')">
        <template #body="{ data }">
          <span
            :class="exclusion(data.responseId) ? 'sample-state is-excluded' : 'sample-state'"
            :title="exclusion(data.responseId)?.reason"
          >{{ exclusion(data.responseId) ? t("surveys.excluded") : t("surveys.included") }}</span>
        </template>
      </Column>
      <template #empty>{{ t("surveys.noResponses") }}</template>
    </DataTable>
    <details v-if="exclusions.length" class="excluded-samples">
      <summary>{{ t("surveys.excludedCount", { n: exclusions.length }) }}</summary>
      <div v-for="item in exclusions" :key="item.responseId" class="exclusion-row">
        <span>{{ item.reason }}</span>
        <Button
          icon="pi pi-undo"
          text
          :aria-label="t('surveys.restoreSample')"
          @click="restore(item.responseId)"
        />
      </div>
    </details>
    <Dialog
      v-model:visible="excludeOpen"
      modal
      :header="t('surveys.excludeSamples')"
      class="survey-dialog"
    >
      <label class="exclusion-field">
        {{ t("surveys.exclusionReason") }}
        <Textarea v-model="reason" fluid :maxlength="200" rows="3" />
      </label>
      <template #footer>
        <Button :label="t('surveys.cancel')" text severity="secondary" @click="excludeOpen = false" />
        <Button :label="t('surveys.excludeSamples')" :disabled="!reason.trim()" @click="exclude" />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.response-table-view {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
}
.response-toolbar,
.selection-bar,
.exclusion-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.response-toolbar {
  justify-content: space-between;
}
.response-search {
  position: relative;
  width: min(100%, 24rem);
}
.response-search > i {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
}
.response-search :deep(input) {
  width: 100%;
  padding-left: 36px;
}
.response-count,
.selection-bar span,
.exclusion-row span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.selection-bar {
  justify-content: space-between;
  padding: 12px 16px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
}
.record-label {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.sample-state {
  white-space: nowrap;
}
.sample-state.is-excluded {
  color: var(--color-warning-600);
}
.excluded-samples {
  padding: 12px 16px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.excluded-samples summary {
  cursor: pointer;
  font-weight: 500;
}
.exclusion-row {
  justify-content: space-between;
  padding-top: 8px;
}
.exclusion-field {
  display: grid;
  gap: 8px;
}
.response-table-view :deep(.p-datatable-table-container) {
  overflow-x: auto;
}
@media (max-width: 767.98px) {
  .response-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .response-search {
    width: 100%;
  }
}
</style>
