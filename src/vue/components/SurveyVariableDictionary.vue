<script setup lang="ts">
import { nextTick } from "vue";
import { useI18n } from "vue-i18n";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import type { SurveyDataset } from "../lib/dataset.js";

const props = defineProps<{ dataset: SurveyDataset }>();
const { t } = useI18n();
function optionsText(variable: SurveyDataset["variables"][number]) {
  return variable.options?.map((option) => `${option.id} = ${option.label}`).join(" · ") || "—";
}
function rowClass(variable: SurveyDataset["variables"][number]) {
  return `variable-record-${props.dataset.variables.indexOf(variable) + 1}`;
}
async function locateVariable(variableId: string) {
  const index = props.dataset.variables.findIndex((item) => item.id === variableId);
  if (index < 0) return;
  await nextTick();
  document
    .querySelector(`.variable-record-${index + 1}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
defineExpose({ locateVariable });
</script>

<template>
  <section class="variable-dictionary">
    <DataTable :value="dataset.variables" data-key="id" scrollable :row-class="rowClass">
      <Column field="label" :header="t('surveys.variable')" />
      <Column field="id" :header="t('surveys.variableId')">
        <template #body="{ data }"><code>{{ data.id }}</code></template>
      </Column>
      <Column :header="t('surveys.variableType')">
        <template #body="{ data }">{{ t(`surveys.variableKind.${data.kind}`) }}</template>
      </Column>
      <Column :header="t('surveys.variableValues')">
        <template #body="{ data }"><span class="variable-values">{{ optionsText(data) }}</span></template>
      </Column>
    </DataTable>
  </section>
</template>

<style scoped>
.variable-dictionary {
  min-width: 0;
}
.variable-dictionary :deep(.p-datatable-table-container) {
  overflow-x: auto;
}
code {
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}
.variable-values {
  display: block;
  min-width: 12rem;
  max-width: 32rem;
  overflow-wrap: anywhere;
}
</style>
