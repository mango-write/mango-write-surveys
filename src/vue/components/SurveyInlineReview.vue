<script setup lang="ts">
// 逐题诊断投影（issue #224 M2）：只按题显示原因与候选题预览；应用入口唯一
// 归画布诊断条，这里没有任何写按钮。方法依据（checkId 的标准出处）收进
// details，复用 STANDARDS_CHECKS/SOURCES 单源，不建数据副本。
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Message from "primevue/message";
import type { SurveyDefinition, SurveyReviewPlan } from "../../core/index.js";
import type { ToolSurveyDelivery } from "../../contracts/index.js";
import { SOURCES, STANDARDS_CHECKS } from "../../standards/index.js";
import SurveyQuestionCard from "./SurveyQuestionCard.vue";
const props = defineProps<{
  questionId: string;
  definition: SurveyDefinition;
  report: Extract<ToolSurveyDelivery, { type: "survey_review" }>;
  plan: SurveyReviewPlan;
  /** 方案过期：隐藏候选预览（不诱导按旧候选手改），只留原因阅读。 */
  stale: boolean;
}>();
const { t } = useI18n();
const findings = computed(() => props.report.findings.filter(item => item.questionId === props.questionId || item.suggestedOps?.some(op => ("questionId" in op && op.questionId === props.questionId) || (op.op === "add_question" && op.question.id === props.questionId))));
const candidate = computed(() => props.plan.candidateDefinition?.questions.find(item => item.id === props.questionId));
const removed = computed(() => !!props.plan.candidateDefinition && !candidate.value && props.definition.questions.some(q => q.id === props.questionId));
const changed = computed(() => candidate.value && JSON.stringify(candidate.value) !== JSON.stringify(props.definition.questions.find(item => item.id === props.questionId)));
const checks = new Map(STANDARDS_CHECKS.map((check) => [check.id, check]));
const citedSources = computed(() => {
  const seen = new Map<string, { label: string; url: string }>();
  for (const finding of findings.value) {
    for (const citation of checks.get(finding.checkId ?? "")?.citations ?? []) {
      const source = SOURCES[citation.source];
      seen.set(source.url, source);
    }
  }
  return [...seen.values()];
});
</script>
<template>
  <aside v-if="findings.length || changed || removed" class="inline-review" :aria-label="t('surveys.inlineReview.title')">
    <strong>{{ t('surveys.inlineReview.title') }}</strong>
    <p v-for="finding in findings" :key="finding.id">{{ finding.reason }} {{ finding.recommendation }}</p>
    <Message v-if="removed" severity="warn" :closable="false">{{ t("surveys.inlineReview.removed") }}</Message>
    <template v-if="!stale && changed && candidate">
      <span>{{ t('surveys.inlineReview.preview') }}</span>
      <SurveyQuestionCard :question="candidate" :number="(plan.candidateDefinition?.questions.findIndex(q => q.id === questionId) ?? 0) + 1" :selected="false" disabled :condition-sources="[]" />
    </template>
    <Message v-if="stale" severity="warn" :closable="false">{{ t("surveys.assistant.stale") }}</Message>
    <p v-else-if="plan.status !== 'ready'" class="inline-review-note">{{ t('surveys.assistant.noAutoFix') }}</p>
    <details v-if="citedSources.length" class="inline-review-sources">
      <summary>{{ t('surveys.inlineReview.basis') }}</summary>
      <a v-for="source in citedSources" :key="source.url" :href="source.url"
        target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
      <p class="inline-review-note">{{ t("surveys.assistant.evidenceNote") }}</p>
    </details>
  </aside>
</template>
<style scoped>
.inline-review { display: grid; gap: .65rem; margin: .5rem 0 1rem; padding: 1rem; border-left: 3px solid var(--color-brand-500); background: var(--color-surface-base); border-radius: var(--radius-md); }
p { margin: 0; line-height: 1.7; }
.inline-review-note { color: var(--color-text-tertiary); font-size: .8rem; }
.inline-review-sources { display: grid; gap: .4rem; }
.inline-review-sources summary { cursor: pointer; font-weight: 600; }
.inline-review-sources a { color: var(--color-text-tertiary); font-size: .8rem; text-decoration: underline; width: fit-content; }
</style>
