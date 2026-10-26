<script setup lang="ts">
// 研究依据面板（issue #224 M2）：只负责研究依据本身——摘要默认可读、
// pendingDecisions 优先、构念/假设等深度信息收进 details；人工编辑与试填记录
// 保留。诊断（report/plan/stale/apply）不在这里：画布诊断条 + 逐题投影承担。
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import type {
  SurveyDefinition,
  SurveyQuestion,
  SurveyResearchDesign,
} from "../../core/index.js";

const props = defineProps<{
  design?: SurveyResearchDesign;
  definition?: SurveyDefinition;
  busy: boolean;
  disabled: boolean;
  hasCopilot: boolean;
  questions?: Pick<SurveyQuestion, "id" | "title">[];
}>();
const emit = defineEmits<{
  "update:design": [design: SurveyResearchDesign];
  "design-request": [];
  locate: [id: string];
  preview: [];
}>();
const { t } = useI18n();
const designValue = computed<SurveyResearchDesign>(() => props.design ?? {
  researchQuestion: "", population: "", recruitment: "", purpose: "describe",
  timeBudgetMinutes: 5, constructs: [], analysisPlan: "", assumptions: [], pendingDecisions: [],
});
const designFields = [
  { key: "researchQuestion", label: "surveys.assistant.question" },
  { key: "population", label: "surveys.assistant.population" },
  { key: "recruitment", label: "surveys.assistant.recruitment" },
  { key: "analysisPlan", label: "surveys.assistant.analysis" },
] as const;
const editingDesign = ref(false);
const trialNotes = ref("");
const trialCount = ref<number | null>(null);
watch(() => props.design?.pretest, (value) => {
  trialNotes.value = value?.notes ?? "";
  trialCount.value = value?.participantCount ?? null;
}, { immediate: true });
function recordTrial() {
  if (props.disabled || !trialNotes.value.trim() || !trialCount.value) return;
  emit("update:design", { ...designValue.value, pretest: {
    notes: trialNotes.value.trim(), participantCount: trialCount.value, recordedAt: new Date().toISOString(),
  } });
}
function questionLabel(id: string) {
  const index = (props.questions ?? []).findIndex((question) => question.id === id);
  return index < 0 ? t("surveys.assistant.unmapped") : t("surveys.assistant.questionIndex", { n: index + 1 });
}
function update(field: "researchQuestion" | "population" | "recruitment" | "analysisPlan", value: string) {
  if (!props.disabled) emit("update:design", { ...designValue.value, [field]: value });
}
</script>

<template>
  <section class="research-assistant" :aria-label="t('surveys.assistant.title')">
    <header class="assistant-header">
      <h2>{{ t("surveys.assistant.design") }}</h2>
      <Button :label="t(editingDesign ? 'surveys.assistant.finishEditing' : 'surveys.assistant.editDesign')" text severity="secondary"
        :aria-expanded="editingDesign" :disabled="disabled || busy" @click="editingDesign = !editingDesign" />
    </header>
    <p class="assistant-note">{{ t("surveys.assistant.authorOnly") }}</p>
    <div v-if="!design && !editingDesign" class="design-empty">
      <p>{{ t("surveys.assistant.designEmpty") }}</p>
    </div>
    <Button v-if="hasCopilot" :label="t('surveys.assistant.addDesign')" icon="pi pi-sparkles" severity="secondary"
      :loading="busy" :disabled="disabled || busy" @click="emit('design-request')" />
    <section v-if="design || editingDesign" class="research-design">
      <dl v-if="!editingDesign" class="design-summary">
        <div v-for="field in designFields" :key="field.key">
          <dt>{{ t(field.label) }}</dt>
          <dd>{{ designValue[field.key] || t('surveys.assistant.notSpecified') }}</dd>
        </div>
      </dl>
      <div v-else class="design-fields">
        <label>
          {{ t("surveys.assistant.question") }}
          <Textarea :model-value="designValue.researchQuestion" :disabled="disabled" rows="3" auto-resize fluid
            @change="update('researchQuestion', ($event.target as HTMLTextAreaElement).value)" />
        </label>
        <label>
          {{ t("surveys.assistant.population") }}
          <InputText :model-value="designValue.population" :disabled="disabled" fluid
            @change="update('population', ($event.target as HTMLInputElement).value)" />
        </label>
        <label>
          {{ t("surveys.assistant.recruitment") }}
          <InputText :model-value="designValue.recruitment" :disabled="disabled" fluid
            @change="update('recruitment', ($event.target as HTMLInputElement).value)" />
        </label>
        <label>
          {{ t("surveys.assistant.analysis") }}
          <Textarea :model-value="designValue.analysisPlan" :disabled="disabled" rows="3" auto-resize fluid
            @change="update('analysisPlan', ($event.target as HTMLTextAreaElement).value)" />
        </label>
      </div>
      <Message v-if="designValue.pendingDecisions.length" severity="warn" :closable="false">
        {{ t("surveys.assistant.pending") }} {{ designValue.pendingDecisions.join(t("surveys.assistant.noteSeparator")) }}
      </Message>
      <details v-if="designValue.constructs.length || designValue.assumptions.length" class="design-details">
        <summary>{{ t("surveys.assistant.depthTitle") }}</summary>
        <div v-for="construct in designValue.constructs" :key="construct.id" class="constructs">
          <strong>{{ construct.label }}</strong>
          <span>{{ construct.definition }}</span>
          <div class="question-links">
            <Button v-for="id in construct.questionIds" :key="id" :label="questionLabel(id)" text
              :disabled="!questions?.some((question) => question.id === id)"
              @click="emit('locate', id)" />
          </div>
        </div>
        <p v-if="designValue.assumptions.length" class="assistant-note">
          {{ t("surveys.assistant.assumptions") }} {{ designValue.assumptions.join(t("surveys.assistant.noteSeparator")) }}
        </p>
      </details>
    </section>
    <details v-if="design || editingDesign" class="trial-record">
      <summary>{{ t("surveys.assistant.trialTitle") }}</summary>
      <p class="assistant-note">{{ t("surveys.assistant.trialHint") }}</p>
      <Button :label="t('surveys.preview')" severity="secondary" @click="emit('preview')" />
      <label class="trial-field">
        {{ t("surveys.assistant.trialCount") }}
        <InputNumber v-model="trialCount" :min="1" :max="10000" :disabled="disabled" show-buttons fluid />
      </label>
      <label class="trial-field">
        {{ t("surveys.assistant.trialNotes") }}
        <Textarea v-model="trialNotes" :maxlength="2000" rows="3" auto-resize fluid :disabled="disabled" />
      </label>
      <Button :label="t('surveys.assistant.recordTrial')" severity="secondary"
        :disabled="disabled || !trialCount || !trialNotes.trim()" @click="recordTrial" />
      <p v-if="designValue.pretest" class="assistant-note">{{ t("surveys.assistant.trialRecorded") }}</p>
    </details>
  </section>
</template>

<style scoped>
.research-assistant { display: flex; flex-direction: column; gap: .75rem; padding: .75rem; min-width: 0; }
.research-design { min-width: 0; }
.design-summary { display: grid; gap: 1rem; margin: 0; }
.design-summary dt { color: var(--color-text-tertiary); font-size: .8rem; }
.design-summary dd { margin: .25rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
.design-empty p { margin: 0; font-size: .875rem; }
.assistant-header { display: flex; gap: .65rem; align-items: center; flex-wrap: wrap; justify-content: space-between; margin-bottom: 0; }
h2 { font-size: 1rem; margin: 0; }
p { margin: .4rem 0; line-height: 1.6; }
.assistant-note { color: var(--color-text-tertiary); font-size: .8rem; }
summary { cursor: pointer; font-weight: 600; padding: .35rem 0; }
.design-details { margin-top: .5rem; border-top: 1px solid var(--color-border-subtle); padding-top: .4rem; }
.design-fields { display: grid; grid-template-columns: 1fr; gap: .7rem; margin: .7rem 0; }
.design-fields label { display: flex; flex-direction: column; gap: .5rem; min-width: 0; font-size: .85rem; }
.constructs { padding: .5rem 0; border-top: 1px solid var(--color-border-subtle); }
.constructs span { margin-left: .5rem; font-size: .85rem; }
.question-links { display: inline-flex; flex-wrap: wrap; }
.trial-record { border-top: 1px solid var(--color-border-subtle); margin-top: .6rem; padding-top: .5rem; }
.trial-field { display: flex; flex-direction: column; gap: .3rem; margin: .6rem 0; font-size: .85rem; }
</style>
