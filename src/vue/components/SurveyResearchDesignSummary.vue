<script setup lang="ts">
// 研究设计只读摘要卡：Design 段就能看到研究问题、构念→题目映射与分、分析计划，
// 不再只靠发布确认框。只读展示；设计入口仍只有 AI 对话与发布前提醒，这里不做编辑器。
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SurveyDefinition, SurveyResearchDesign } from "../../contracts/index.js";

const props = defineProps<{
  design: SurveyResearchDesign | null;
  definition: SurveyDefinition;
}>();
const { t } = useI18n();

// 与发布确认同判据：保存试填反馈会在无设计草稿上合成空基底，只看
// researchDesign 存在会把空设计当「已填写」。
const usable = computed(
  () => !!props.design && !!props.design.researchQuestion.trim(),
);

// 题号与大纲同口径：页序展开递增，说明块也占号。
const questionNumbers = computed(() => {
  const numbers = new Map<string, number>();
  let number = 0;
  for (const page of props.definition.pages)
    for (const id of page.questionIds) numbers.set(id, ++number);
  return numbers;
});

const constructRows = computed(() =>
  (props.design?.constructs ?? []).map((construct) => ({
    id: construct.id,
    label: construct.label,
    numbers: construct.questionIds.flatMap((id) => {
      const number = questionNumbers.value.get(id);
      return number === undefined ? [] : [number];
    }),
    scoring: scoringLine(construct.scoring),
  })),
);
function scoringLine(scoring: SurveyResearchDesign["constructs"][number]["scoring"]) {
  if (!scoring) return t("surveys.designSummary.scoringNone");
  return scoring.method === "mean"
    ? t("surveys.designSummary.scoringMean", { min: scoring.minValid })
    : t("surveys.designSummary.scoringSum", { min: scoring.minValid });
}
function numberList(numbers: number[]) {
  return numbers.join(t("surveys.designSummary.numberSeparator"));
}
</script>
<template>
  <details class="design-summary">
    <summary>
      <span class="summary-title">{{ t("surveys.designSummary.title") }}</span>
      <span v-if="usable" class="summary-state is-ok">{{ t("surveys.designSummary.ready") }}</span>
      <span v-else class="summary-state">{{ t("surveys.designSummary.missing") }}</span>
    </summary>
    <p v-if="!usable" class="design-empty">{{ t("surveys.designSummary.empty") }}</p>
    <template v-else>
      <dl class="design-rows">
        <div class="design-row">
          <dt>{{ t("surveys.assistant.question") }}</dt>
          <dd>{{ design!.researchQuestion }}</dd>
        </div>
        <div class="design-row">
          <dt>{{ t("surveys.designSummary.constructsTitle") }}</dt>
          <dd>
            <p v-if="!constructRows.length" class="design-sub">{{ t("surveys.designSummary.constructsEmpty") }}</p>
            <p v-for="row in constructRows" :key="row.id" class="construct-line">
              <span class="construct-label">{{ row.label }}</span>
              <span class="construct-nums">{{
                row.numbers.length
                  ? t("surveys.assistant.questionIndex", { n: numberList(row.numbers) })
                  : t("surveys.assistant.unmapped")
              }}</span>
              <span class="construct-scoring">{{ row.scoring }}</span>
            </p>
          </dd>
        </div>
        <div class="design-row">
          <dt>{{ t("surveys.assistant.analysis") }}</dt>
          <dd>{{ design!.analysisPlan.trim() || t("surveys.designSummary.planEmpty") }}</dd>
        </div>
      </dl>
      <div v-if="design!.pendingDecisions.length" class="design-pending">
        <p class="pending-title">{{ t("surveys.designSummary.pendingTitle") }}</p>
        <p v-for="note in design!.pendingDecisions" :key="note" class="pending-note">{{ note }}</p>
      </div>
    </template>
  </details>
</template>
<style scoped>
.design-summary {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--elevation-2-surface);
  box-shadow: var(--elevation-2-shadow);
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
}
.design-summary summary {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  cursor: pointer;
}
.summary-title {
  font-weight: 600;
  color: var(--color-text-primary);
}
.summary-state {
  font-size: 0.78rem;
  color: var(--color-text-tertiary);
}
.summary-state.is-ok {
  color: var(--color-success-600);
}
.design-empty {
  margin: 0.6rem 0 0;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}
.design-rows {
  margin: 0.6rem 0 0;
  display: grid;
  gap: 0.6rem;
}
.design-row {
  display: grid;
  grid-template-columns: minmax(5rem, auto) minmax(0, 1fr);
  gap: 0.25rem 0.75rem;
  align-items: baseline;
}
.design-row dt {
  color: var(--color-text-tertiary);
  white-space: nowrap;
}
.design-row dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.design-sub {
  margin: 0;
  color: var(--color-text-tertiary);
}
.construct-line {
  margin: 0 0 0.2rem;
}
.construct-label {
  font-weight: 600;
}
.construct-nums {
  margin-left: 0.4rem;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.construct-scoring {
  display: block;
  font-size: 0.78rem;
  color: var(--color-text-tertiary);
}
.design-pending {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--color-border-subtle);
}
.pending-title {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-warning-600);
}
.pending-note {
  margin: 0.2rem 0 0;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}
@media (max-width: 767.98px) {
  .design-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
