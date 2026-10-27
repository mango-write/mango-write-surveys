<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Message from "primevue/message";
import Popover from "primevue/popover";
import { Sparkles } from "lucide-vue-next";
import { buildSurveyReviewPlan, type SurveyDefinition } from "../../core/index.js";
import type { SurveyReviewFinding, ToolSurveyDelivery } from "../../contracts/index.js";
import { SOURCES, STANDARDS_CHECKS } from "../../standards/index.js";
import { reviewChangeRows, type ReviewChangeContext } from "../lib/review-change-rows.js";

const props = defineProps<{
  questionId?: string;
  definition: SurveyDefinition;
  report: Extract<ToolSurveyDelivery, { type: "survey_review" }>;
  stale: boolean;
  applying?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ apply: [findingId: string]; dismiss: [findingId: string] }>();
const { t } = useI18n();
const panel = ref<{ toggle: (event: Event) => void; hide: () => void } | null>(null);
const opened = ref(false);
const checks = new Map(STANDARDS_CHECKS.map((check) => [check.id, check]));
const findings = computed(() => props.report.findings.filter((finding) => {
  if (props.questionId) {
    return finding.questionId === props.questionId || finding.suggestedOps?.some((op) =>
      ("questionId" in op && op.questionId === props.questionId) ||
      (op.op === "add_question" && op.question.id === props.questionId));
  }
  const additions = finding.suggestedOps?.filter((op) => op.op === "add_question") ?? [];
  if (additions.length && additions.every((op) => props.definition.pages.some((page) => page.id === op.pageId))) return false;
  if (!finding.questionId) return true;
  return props.stale && !props.definition.questions.some((question) => question.id === finding.questionId);
}));
const plans = computed(() => new Map(findings.value.map((finding) => [
  finding.id,
  buildSurveyReviewPlan(props.definition, [finding]),
])));
watch(() => findings.value.length, (count) => {
  if (!count) panel.value?.hide();
});
function citations(finding: SurveyReviewFinding) {
  return (finding.checkId ? checks.get(finding.checkId) : undefined)?.citations.map(
    (citation) => ({ ...SOURCES[citation.source], note: citation.note }),
  ) ?? [];
}
function rowsFor(finding: SurveyReviewFinding) {
  const plan = plans.value.get(finding.id);
  const group = plan?.groups[0];
  if (!plan?.candidateDefinition || !group) return [];
  const context: ReviewChangeContext = {
    original: props.definition,
    candidate: plan.candidateDefinition,
    findings: [finding],
    t,
  };
  return reviewChangeRows(group, context);
}
const heading = computed(() => {
  const index = props.questionId
    ? props.definition.questions.findIndex((question) => question.id === props.questionId)
    : -1;
  return index >= 0
    ? `${t("surveys.assistant.questionIndex", { n: index + 1 })} · ${t("surveys.inlineReview.title")}`
    : t("surveys.inlineReview.title");
});
</script>
<template>
  <span v-if="findings.length" class="inline-review">
    <Button
      severity="warn"
      class="inline-review__trigger"
      :label="t('surveys.inlineReview.badge', { n: findings.length })"
      :aria-label="t('surveys.inlineReview.open', { n: findings.length })"
      :aria-expanded="opened"
      aria-haspopup="dialog"
      @click.stop="panel?.toggle($event)"
    >
      <template #icon><Sparkles :size="16" /></template>
    </Button>
    <Popover ref="panel" :aria-label="t('surveys.inlineReview.title')"
      @show="opened = true" @hide="opened = false">
      <div class="review-popover">
        <Message v-if="stale" severity="warn" :closable="false">{{ t("surveys.assistant.stale") }}</Message>
        <article v-for="finding in findings" :key="finding.id" class="review-finding">
          <header class="review-finding__heading">
            <span class="review-finding__icon"><Sparkles :size="18" /></span>
            <strong>{{ heading }}</strong>
          </header>
          <p v-if="finding.impact" class="review-finding__impact">
            {{ t("surveys.inlineReview.impact") }}{{ finding.impact }}
          </p>
          <blockquote v-if="finding.evidence" class="review-finding__evidence">
            <span>{{ t("surveys.inlineReview.evidence") }}</span>
            <p>{{ finding.evidence }}</p>
          </blockquote>
          <div v-if="!stale && rowsFor(finding).length" class="review-finding__changes">
            <div v-for="row in rowsFor(finding)" :key="row.key" class="review-change">
              <strong v-if="rowsFor(finding).length > 1" class="review-change__field">
                {{ row.location ?? row.field }}
              </strong>
              <div class="review-change__grid">
                <div class="review-change__value">
                  <span>{{ t("surveys.inlineReview.before") }}</span>
                  <p>{{ row.before }}</p>
                </div>
                <div class="review-change__value review-change__value--after">
                  <span>{{ t("surveys.inlineReview.after") }}</span>
                  <p>{{ row.after }}</p>
                </div>
              </div>
            </div>
          </div>
          <Message v-else-if="!stale && finding.suggestedOps?.length && plans.get(finding.id)?.status !== 'ready'"
            severity="warn" :closable="false">{{ t("surveys.assistant.planUnavailable") }}</Message>
          <p v-else-if="!stale" class="review-finding__manual">{{ finding.recommendation }}</p>
          <details v-if="citations(finding).length" class="review-finding__sources">
            <summary>{{ t("surveys.inlineReview.basis") }}</summary>
            <div class="review-finding__source-links">
              <a v-for="source in citations(finding)" :key="source.url" :href="source.url"
                target="_blank" rel="noopener noreferrer">{{ source.label }}</a>
            </div>
          </details>
          <div class="review-finding__actions">
            <Button :label="t('surveys.inlineReview.dismiss')" text severity="secondary"
              :disabled="applying" @click="emit('dismiss', finding.id)" />
            <Button v-if="finding.suggestedOps?.length" :label="t('surveys.inlineReview.apply')"
              icon="pi pi-check" severity="warn" :loading="applying"
              :disabled="disabled || stale || applying || plans.get(finding.id)?.status !== 'ready'"
              @click="emit('apply', finding.id)" />
          </div>
        </article>
      </div>
    </Popover>
  </span>
</template>
<style scoped>
.inline-review { display: inline-flex; }
.inline-review__trigger { white-space: nowrap; }
.review-popover {
  display: grid;
  gap: 16px;
  width: min(38rem, calc(100vw - 32px));
  max-height: min(42rem, 76vh);
  overflow-y: auto;
  padding: 4px;
}
.review-finding {
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--material-inlay-border);
  border-radius: var(--radius-lg);
  background: var(--material-inlay);
}
.review-finding__heading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-warning-600);
  font-size: var(--font-size-title-sm);
}
.review-finding__icon {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-warning-surface);
}
.review-finding__impact {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.review-finding__evidence {
  margin: 0;
  display: grid;
  gap: 6px;
  padding: 10px 14px;
  border-left: 3px solid var(--color-warning-600);
  background: var(--color-bg-soft);
  border-radius: var(--radius-sm, 6px);
}
.review-finding__evidence > span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.review-finding__evidence p {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-relaxed);
  overflow-wrap: anywhere;
}
.review-finding__changes,
.review-change {
  display: grid;
  gap: 12px;
}
.review-change__field {
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.review-change__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.review-change__value {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
}
.review-change__value > span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.review-change__value--after {
  border-color: var(--color-success-border);
  background: var(--color-success-surface);
}
.review-change__value--after > span { color: var(--color-success-600); }
.review-change p,
.review-finding__manual {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-relaxed);
  overflow-wrap: anywhere;
}
.review-finding__sources summary {
  width: fit-content;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  cursor: pointer;
}
.review-finding__source-links {
  display: grid;
  gap: 8px;
  padding-top: 12px;
}
.review-finding__sources a {
  width: fit-content;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.review-finding__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 767.98px) {
  .review-finding { padding: 16px; }
  .review-change__grid { grid-template-columns: 1fr; }
}
</style>
