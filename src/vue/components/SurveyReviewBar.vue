<script setup lang="ts">
// 轻量批量操作条（issue #224）：默认只有「N 组修改」事实与唯一的整批应用/
// 放弃；候选改动 before/after 收进 details 供应用前核对（review-change-rows
// 单源投影）。逐题理由、候选预览与方法依据归 SurveyInlineReview；这里只留
// 无题级归属的整卷/研究设计类发现，同样收进按需 details，不做第二个报告面板。
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type { SurveyDefinition, SurveyReviewPlan } from "../../core/index.js";
import type { SurveyReviewFinding, ToolSurveyDelivery } from "../../contracts/index.js";
import { SOURCES, STANDARDS_CHECKS } from "../../standards/index.js";
import { reviewChangeRows, type ReviewChangeContext } from "../lib/review-change-rows.js";

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
// 题级发现在对应题目旁阅读（SurveyInlineReview 投影）；这里只收非题级事项。
// 例外：方案过期后原题已被删除的题级发现无处内联渲染，作为整卷遗留事项
// 保留在按需 details，明确过期仅供追溯。
const questionIds = computed(() => new Set(props.definition.questions.map((q) => q.id)));
const hasOrphanFindings = computed(() =>
  props.stale &&
  [...props.plan.manual, ...props.plan.deferred].some((item) => {
    const finding = findingById.value.get(item.findingId);
    return !!finding?.questionId && !questionIds.value.has(finding.questionId);
  }),
);
const surveyLevelFindings = computed<SurveyReviewFinding[]>(() =>
  [...props.plan.manual, ...props.plan.deferred].flatMap((item) => {
    const finding = findingById.value.get(item.findingId);
    if (!finding) return [];
    if (!finding.questionId) return [finding];
    return props.stale && !questionIds.value.has(finding.questionId) ? [finding] : [];
  }),
);
const changeContext = computed<ReviewChangeContext>(() => ({
  original: props.definition,
  candidate: props.plan.candidateDefinition!,
  findings: props.report.findings,
  t,
}));
function rowsFor(group: Parameters<typeof reviewChangeRows>[0]) {
  return reviewChangeRows(group, changeContext.value);
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
      <div class="review-bar-facts">
        <span v-if="plan.status === 'ready'">{{ t("surveys.reviewBar.changeGroups", { n: plan.groups.length }) }}</span>
        <p v-else-if="plan.status === 'empty'" class="review-bar-note">{{ t("surveys.assistant.noFindings") }}</p>
        <p v-else-if="plan.status === 'manual-only'" class="review-bar-note">{{ t("surveys.assistant.noAutoFix") }}</p>
        <Message v-if="stale" severity="warn" :closable="false">{{ t("surveys.assistant.stale") }}</Message>
        <Message v-else-if="plan.status === 'blocked'" severity="warn" :closable="false">{{ t("surveys.assistant.planUnavailable") }}</Message>
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
    <details v-if="surveyLevelFindings.length" class="review-bar-more" :open="plan.status === 'manual-only'">
      <summary>{{ t("surveys.assistant.manualTitle") }}</summary>
      <p v-if="hasOrphanFindings" class="review-bar-note">{{ t("surveys.reviewBar.staleTrace") }}</p>
      <article v-for="finding in surveyLevelFindings" :key="finding.id" class="review-bar-finding">
        <div class="review-bar-finding-title">
          <Tag :value="t(`surveys.assistant.severity.${finding.severity}`)"
            :severity="finding.severity === 'minor' ? 'info' : 'warn'" />
          <strong>{{ finding.title }}</strong>
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
  padding: .55rem .9rem;
}
.review-bar-main { display: flex; align-items: center; gap: .75rem; }
.review-bar-facts { flex: 1; min-width: 0; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.review-bar-facts > span { font-size: .875rem; }
.review-bar-note { margin: 0; font-size: .8rem; color: var(--color-text-tertiary); line-height: 1.6; }
.review-bar-actions { display: inline-flex; gap: .35rem; flex: none; align-items: center; }
.review-bar-changes, .review-bar-more { margin-top: .4rem; border-top: 1px solid var(--color-border-subtle); padding-top: .35rem; }
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
