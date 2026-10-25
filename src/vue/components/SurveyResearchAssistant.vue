<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type { SurveyResearchDesign, SurveyQuestion } from "../../core/index.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import { SOURCES, STANDARDS_CHECKS } from "../../standards/index.js";

type Review = Extract<ToolSurveyDelivery, { type: "survey_review" }>;
const props = defineProps<{
  design?: SurveyResearchDesign;
  report: Review | null;
  stale: boolean;
  busy: boolean;
  disabled: boolean;
  hasCopilot: boolean;
  questions?: Pick<SurveyQuestion, "id" | "title">[];
}>();
const emit = defineEmits<{
  "update:design": [design: SurveyResearchDesign];
  review: [];
  "design-request": [];
  apply: [id: string];
  locate: [id: string];
  preview: [];
}>();
const { t } = useI18n();
const trialNotes = ref("");
const trialCount = ref<number | null>(null);
watch(() => props.design?.pretest, (value) => {
  trialNotes.value = value?.notes ?? "";
  trialCount.value = value?.participantCount ?? null;
}, { immediate: true });
function recordTrial() {
  if (!props.design || props.disabled || !trialNotes.value.trim() || !trialCount.value) return;
  emit("update:design", { ...props.design, pretest: {
    notes: trialNotes.value.trim(), participantCount: trialCount.value, recordedAt: new Date().toISOString(),
  } });
}
const checks = new Map(STANDARDS_CHECKS.map((check) => [check.id, check]));
const findings = computed(() => props.report?.findings ?? []);
function update(field: "researchQuestion" | "population" | "recruitment" | "analysisPlan", value: string) {
  if (props.design && !props.disabled) emit("update:design", { ...props.design, [field]: value });
}
function sources(checkId?: string) {
  return (checkId ? checks.get(checkId) : undefined)?.citations.map((citation) => SOURCES[citation.source]) ?? [];
}
function questionLabel(id: string) {
  const index = props.questions?.findIndex((question) => question.id === id) ?? -1;
  return index < 0 ? t("surveys.assistant.unmapped") : t("surveys.assistant.questionIndex", { n: index + 1 });
}
</script>

<template>
  <section class="research-assistant" :aria-label="t('surveys.assistant.title')">
    <header class="assistant-header">
      <div>
        <h2>{{ t("surveys.assistant.title") }}</h2>
        <p>{{ t("surveys.assistant.subtitle") }}</p>
      </div>
      <Button
        v-if="hasCopilot"
        :label="t('surveys.assistant.review')"
        icon="pi pi-sparkles"
        
        :loading="busy"
        :disabled="disabled || busy"
        @click="emit('review')"
      />
    </header>
    <details :open="!design">
      <summary>{{ t("surveys.assistant.design") }}</summary>
      <template v-if="design">
        <div class="design-fields">
          <label>
            {{ t("surveys.assistant.question") }}
            <Textarea :model-value="design.researchQuestion" :disabled="disabled" rows="2" auto-resize
              @change="update('researchQuestion', ($event.target as HTMLTextAreaElement).value)" />
          </label>
          <label>
            {{ t("surveys.assistant.population") }}
            <InputText :model-value="design.population" :disabled="disabled"
              @change="update('population', ($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            {{ t("surveys.assistant.recruitment") }}
            <InputText :model-value="design.recruitment" :disabled="disabled"
              @change="update('recruitment', ($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            {{ t("surveys.assistant.analysis") }}
            <Textarea :model-value="design.analysisPlan" :disabled="disabled" rows="2" auto-resize
              @change="update('analysisPlan', ($event.target as HTMLTextAreaElement).value)" />
          </label>
        </div>
        <div v-if="design.constructs.length" class="constructs">
          <div v-for="construct in design.constructs" :key="construct.id">
            <strong>{{ construct.label }}</strong>
            <span>{{ construct.definition }}</span>
            <div class="question-links">
              <Button v-for="id in construct.questionIds" :key="id" :label="questionLabel(id)" text
                :disabled="!questions?.some((question) => question.id === id)"
                @click="emit('locate', id)" />
            </div>
          </div>
        </div>
        <p v-if="design.assumptions.length" class="assistant-note">
          {{ t("surveys.assistant.assumptions") }} {{ design.assumptions.join('；') }}
        </p>
        <Message v-if="design.pendingDecisions.length" severity="warn" :closable="false">
          {{ t("surveys.assistant.pending") }} {{ design.pendingDecisions.join('；') }}
        </Message>
      </template>
      <div v-else class="design-empty">
        <p>{{ t("surveys.assistant.designEmpty") }}</p>
        <Button v-if="hasCopilot" :label="t('surveys.assistant.addDesign')" severity="secondary" 
          :disabled="disabled || busy" @click="emit('design-request')" />
      </div>
    </details>
    <details class="trial-record">
      <summary>{{ t("surveys.assistant.trialTitle") }}</summary>
      <p class="assistant-note">{{ t("surveys.assistant.trialHint") }}</p>
      <Button :label="t('surveys.preview')"  severity="secondary" @click="emit('preview')" />
      <template v-if="design">
        <label class="trial-field">
          {{ t("surveys.assistant.trialCount") }}
          <InputNumber v-model="trialCount" :min="1" :max="10000" :disabled="disabled" show-buttons />
        </label>
        <label class="trial-field">
          {{ t("surveys.assistant.trialNotes") }}
          <Textarea v-model="trialNotes" :maxlength="2000" rows="3" auto-resize :disabled="disabled" />
        </label>
        <Button :label="t('surveys.assistant.recordTrial')"  severity="secondary"
          :disabled="disabled || !trialCount || !trialNotes.trim()" @click="recordTrial" />
        <p v-if="design.pretest" class="assistant-note">{{ t("surveys.assistant.trialRecorded") }}</p>
      </template>
    </details>
    <div v-if="report" class="review-results" aria-live="polite">
      <div class="review-summary">
        <strong>{{ t("surveys.assistant.findings", { n: findings.length }) }}</strong>
        <span>{{ report.summary }}</span>
      </div>
      <Message v-if="stale" severity="warn" :closable="false">{{ t("surveys.assistant.stale") }}</Message>
      <p v-if="!findings.length">{{ t("surveys.assistant.noFindings") }}</p>
      <article v-for="finding in findings" :key="finding.id" class="finding">
        <div class="finding-title">
          <Tag :value="t(`surveys.assistant.severity.${finding.severity}`)"
            :severity="finding.severity === 'minor' ? 'info' : 'warn'" />
          <strong>{{ finding.title }}</strong>
        </div>
        <p>{{ finding.reason }}</p>
        <p>{{ finding.recommendation }}</p>
        <p v-if="!finding.checkId" class="assistant-note">{{ t("surveys.assistant.uncatalogued") }}</p>
        <div class="finding-actions">
          <Button v-if="finding.questionId" :label="t('surveys.assistant.locate')" text 
            @click="emit('locate', finding.questionId)" />
          <Button v-if="finding.suggestedOps?.length" :label="t('surveys.assistant.apply')"  severity="secondary"
            :disabled="disabled || stale || busy" @click="emit('apply', finding.id)" />
          <a v-for="source in sources(finding.checkId)" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
        </div>
      </article>
      <p class="assistant-note">{{ t("surveys.assistant.evidenceNote") }}</p>
    </div>
  </section>
</template>

<style scoped>
.research-assistant { flex: none; width: 100%; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg, 12px); padding: 1rem; margin-bottom: 1rem; background: var(--color-surface-base); }
.assistant-header, .finding-title, .finding-actions, .review-summary { display: flex; gap: .65rem; align-items: center; flex-wrap: wrap; }
.assistant-header { justify-content: space-between; margin-bottom: .8rem; }
h2 { font-size: 1rem; margin: 0; }
p { margin: .4rem 0; line-height: 1.6; }
.assistant-header p, .assistant-note, .finding-actions a { color: var(--color-text-tertiary); font-size: .8rem; }
summary { cursor: pointer; font-weight: 600; padding: .35rem 0; }
.design-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; margin: .7rem 0; }
.design-fields label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; }
.design-fields label:first-child, .design-fields label:last-child { grid-column: 1 / -1; }
.constructs > div { padding: .5rem 0; border-top: 1px solid var(--color-border-subtle); }
.constructs span { margin-left: .5rem; font-size: .85rem; }
.question-links { display: inline-flex; flex-wrap: wrap; }
.review-results { border-top: 1px solid var(--color-border-subtle); margin-top: .8rem; padding-top: .8rem; }
.finding { padding: .8rem 0; border-bottom: 1px solid var(--color-border-subtle); }
.finding p { font-size: .875rem; }
.finding-actions a { text-decoration: underline; }
.trial-record { border-top: 1px solid var(--color-border-subtle); margin-top: .6rem; padding-top: .5rem; }
.trial-field { display: flex; flex-direction: column; gap: .3rem; margin: .6rem 0; font-size: .85rem; }
@media (max-width: 600px) { .design-fields { grid-template-columns: 1fr; } }
</style>
