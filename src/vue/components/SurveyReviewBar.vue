<script setup lang="ts">
// 画布诊断条（issue #224 M2）：整卷诊断的唯一摘要位与唯一整批应用入口。
// 只呈现本次诊断摘要、过期/blocked/manual 状态、放弃与应用；逐题原因与候选
// 预览归 SurveyInlineReview（投影，无应用按钮）。应用前可核对：候选改动的
// before/after 收进 details（review-change-rows 单源投影）；人工判断项与其余
// 发现同在 details——manual-only 时默认展开，带题号的发现可定位。
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type { SurveyDefinition, SurveyReviewPlan } from "../../core/index.js";
import type { SurveyReviewFinding, ToolSurveyDelivery } from "../../contracts/index.js";
import { SOURCES, STANDARDS_CHECKS } from "../../standards/index.js";
import { reviewChangeRows, reviewQuestionLabel, type ReviewChangeContext } from "../lib/review-change-rows.js";

const props = defineProps<{
  report: Extract<ToolSurveyDelivery, { type: "survey_review" }>;
  plan: SurveyReviewPlan;
  definition: SurveyDefinition;
  stale: boolean;
  busy: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ apply: []; discard: []; locate: [id: string] }>();
const { t } = useI18n();

const checks = new Map(STANDARDS_CHECKS.map((check) => [check.id, check]));
const findingById = computed(() =>
  new Map(props.report.findings.map((finding) => [finding.id, finding])),
);
const manualFindings = computed<SurveyReviewFinding[]>(() =>
  props.plan.manual.flatMap((item) => {
    const finding = findingById.value.get(item.findingId);
    return finding ? [finding] : [];
  }),
);
const deferredFindings = computed<SurveyReviewFinding[]>(() =>
  props.plan.deferred.flatMap((item) => {
    const finding = findingById.value.get(item.findingId);
    return finding ? [finding] : [];
  }),
);
const moreFindings = computed(() => [...manualFindings.value, ...deferredFindings.value]);
const changeContext = computed<ReviewChangeContext>(() => ({
  original: props.definition,
  candidate: props.plan.candidateDefinition!,
  findings: props.report.findings,
  t,
}));
function rowsFor(group: Parameters<typeof reviewChangeRows>[0]) {
  return reviewChangeRows(group, changeContext.value);
}
function locateLabel(questionId: string) {
  return reviewQuestionLabel(questionId, changeContext.value);
}
function citations(checkId?: string) {
  return (checkId ? checks.get(checkId) : undefined)?.citations.map(
    (citation) => ({ ...SOURCES[citation.source], note: citation.note }),
  ) ?? [];
}
</script>

<template>
  <aside class="review-bar" :aria-label="t('surveys.inlineReview.title')">
    <div class="review-bar-main">
      <div class="review-bar-summary">
        <strong>{{ t("surveys.assistant.title") }}</strong>
        <span>{{ report.summary }}</span>
        <Message v-if="stale" severity="warn" :closable="false">{{ t("surveys.assistant.stale") }}</Message>
        <Message v-else-if="plan.status === 'blocked'" severity="warn" :closable="false">{{ t("surveys.assistant.planUnavailable") }}</Message>
        <p v-else-if="plan.status === 'empty'" class="review-bar-note">{{ t("surveys.assistant.noFindings") }}</p>
        <p v-else-if="plan.status === 'manual-only'" class="review-bar-note">{{ t("surveys.assistant.noAutoFix") }}</p>
      </div>
      <div class="review-bar-actions">
        <Button :label="t('surveys.reviewBar.discard')" text severity="secondary" :disabled="busy" @click="emit('discard')" />
        <Button
          v-if="plan.status === 'ready'"
          :label="t('surveys.assistant.applyPlan', { n: plan.groups.length })"
          icon="pi pi-check"
          :loading="busy"
          :disabled="disabled || stale || busy"
          @click="emit('apply')"
        />
      </div>
    </div>
    <details v-if="plan.candidateDefinition && plan.groups.length" class="review-bar-changes">
      <summary>{{ t("surveys.reviewBar.changesTitle") }}</summary>
      <article v-for="group in plan.groups" :key="group.id" class="review-bar-group">
        <Tag :value="t(`surveys.assistant.severity.${group.severity}`)"
          :severity="group.severity === 'minor' ? 'info' : 'warn'" />
        <strong>{{ group.title }}</strong>
        <div v-for="row in rowsFor(group)" :key="row.key" class="change-row">
          <button v-if="row.questionId" type="button" class="change-location" @click="emit('locate', row.questionId)">
            {{ row.location }}
          </button>
          <strong v-else>{{ row.field }}</strong>
          <p><strong class="change-mobile-label">{{ t("surveys.reviewBar.before") }}：</strong>{{ row.before }}</p>
          <p><strong class="change-mobile-label">{{ t("surveys.reviewBar.after") }}：</strong>{{ row.after }}</p>
        </div>
      </article>
    </details>
    <details v-if="moreFindings.length" class="review-bar-more" :open="plan.status === 'manual-only'">
      <summary>{{ t("surveys.assistant.manualTitle") }}</summary>
      <article v-for="finding in moreFindings" :key="finding.id" class="review-bar-finding">
        <div class="review-bar-finding-title">
          <Tag :value="t(`surveys.assistant.severity.${finding.severity}`)"
            :severity="finding.severity === 'minor' ? 'info' : 'warn'" />
          <strong>{{ finding.title }}</strong>
          <Button v-if="finding.questionId" :label="locateLabel(finding.questionId)" text
            @click="emit('locate', finding.questionId)" />
        </div>
        <p>{{ finding.reason }}</p>
        <p>{{ finding.recommendation }}</p>
        <p v-if="!finding.checkId" class="review-bar-note">{{ t("surveys.assistant.uncatalogued") }}</p>
        <div class="review-bar-sources">
          <a v-for="source in citations(finding.checkId)" :key="source.url" :href="source.url"
            target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
        </div>
      </article>
      <p class="review-bar-note">{{ t("surveys.assistant.evidenceNote") }}</p>
    </details>
  </aside>
</template>

<style scoped>
.review-bar {
  width: 100%;
  max-width: 46rem;
  align-self: center;
  border: 1px solid var(--color-border-subtle);
  border-left: 3px solid var(--color-brand-500);
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
  padding: .75rem 1rem;
}
.review-bar-main { display: flex; align-items: flex-start; gap: .75rem; }
.review-bar-summary { flex: 1; min-width: 0; display: grid; gap: .35rem; }
.review-bar-summary strong { font-size: .875rem; }
.review-bar-summary span { line-height: 1.6; overflow-wrap: anywhere; }
.review-bar-note { margin: 0; font-size: .8rem; color: var(--color-text-tertiary); line-height: 1.6; }
.review-bar-actions { display: inline-flex; gap: .35rem; flex: none; align-items: center; }
.review-bar-changes, .review-bar-more { margin-top: .5rem; border-top: 1px solid var(--color-border-subtle); padding-top: .4rem; }
.review-bar-changes summary, .review-bar-more summary { cursor: pointer; font-weight: 600; font-size: .875rem; padding: .25rem 0; }
.review-bar-group { padding: .5rem 0; display: grid; gap: .35rem; }
.change-row { display: grid; gap: .25rem; padding: .4rem 0; border-top: 1px dashed var(--color-border-subtle); }
.change-row p { margin: 0; font-size: .875rem; line-height: 1.6; overflow-wrap: anywhere; }
.change-mobile-label { display: inline; color: var(--color-text-tertiary); font-weight: 400; }
.change-location { border: 0; padding: 0; background: transparent; color: var(--color-brand-600); text-align: left; cursor: pointer; }
.review-bar-finding { padding: .5rem 0; border-bottom: 1px dashed var(--color-border-subtle); }
.review-bar-finding:last-of-type { border-bottom: 0; }
.review-bar-finding p { margin: .3rem 0; font-size: .875rem; line-height: 1.6; }
.review-bar-finding-title { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.review-bar-sources { display: flex; flex-wrap: wrap; gap: .5rem; }
.review-bar-sources a { color: var(--color-text-tertiary); font-size: .8rem; text-decoration: underline; }
</style>
