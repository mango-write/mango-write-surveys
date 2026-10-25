<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Message from "primevue/message";
import type { SurveyDefinition, SurveyReviewPlan } from "../../core/index.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import SurveyQuestionCard from "./SurveyQuestionCard.vue";
const props = defineProps<{
  questionId: string;
  definition: SurveyDefinition;
  report: Extract<ToolSurveyDelivery, { type: "survey_review" }>;
  plan: SurveyReviewPlan;
  disabled: boolean;
}>();
const emit = defineEmits<{ apply: [] }>();
const { t } = useI18n();
const findings = computed(() => props.report.findings.filter(item => item.questionId === props.questionId || item.suggestedOps?.some(op => ("questionId" in op && op.questionId === props.questionId) || (op.op === "add_question" && op.question.id === props.questionId))));
const candidate = computed(() => props.plan.candidateDefinition?.questions.find(item => item.id === props.questionId));
const removed = computed(() => !!props.plan.candidateDefinition && !candidate.value && props.definition.questions.some(q => q.id === props.questionId));
const changed = computed(() => candidate.value && JSON.stringify(candidate.value) !== JSON.stringify(props.definition.questions.find(item => item.id === props.questionId)));
</script>
<template>
  <aside v-if="findings.length || changed || removed" class="inline-review" :aria-label="t('surveys.inlineReview.title')">
    <strong>{{ t('surveys.inlineReview.title') }}</strong>
    <p v-for="finding in findings" :key="finding.id">{{ finding.reason }} {{ finding.recommendation }}</p>
    <Message v-if="removed" severity="warn" :closable="false">{{ t("surveys.inlineReview.removed") }}</Message>
    <template v-if="changed && candidate">
      <span>{{ t('surveys.inlineReview.preview') }}</span>
      <SurveyQuestionCard :question="candidate" :number="(plan.candidateDefinition?.questions.findIndex(q => q.id === questionId) ?? 0) + 1" :selected="false" disabled :condition-sources="[]" />
    </template>
    <Message v-if="plan.status !== 'ready'" severity="info" :closable="false">{{ t('surveys.assistant.noAutoFix') }}</Message>
    <Button v-else :label="t('surveys.inlineReview.accept')" icon="pi pi-check" :disabled="disabled" @click="emit('apply')" />
    <small v-if="plan.status === 'ready'">{{ t('surveys.inlineReview.linked') }}</small>
  </aside>
</template>
<style scoped>
.inline-review { display: grid; gap: .65rem; margin: .5rem 0 1rem; padding: 1rem; border-left: 3px solid var(--color-brand-500); background: var(--color-surface-base); border-radius: var(--radius-md); }
p { margin: 0; line-height: 1.7; }
small { color: var(--color-text-secondary); }
</style>
