<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import type { SurveyDataset } from "../lib/dataset.js";
import {
  summarizeDataset,
  type ChoiceSummary,
  type DateSummary,
  type MatrixSummary,
  type NpsSummary,
  type NumberSummary,
  type OrdinalSummary,
  type QuestionSummary,
  type RankingSummary,
  type TextSummary,
} from "../lib/summary.js";
import SurveySummaryBars from "./SurveySummaryBars.vue";
import SurveyTextWordCloud from "./SurveyTextWordCloud.vue";

const TEXT_DEFAULT_VISIBLE = 10;
const TEXT_MAX_VISIBLE = 200;
const TEXT_CLIP = 140;
const MATRIX_TEXT_VISIBLE = 5;
const props = defineProps<{
  dataset: SurveyDataset;
  revisionNumber: number | null;
}>();
const { locale, t } = useI18n();
const expanded = ref(new Set<string>());
function toggleExpanded(questionId: string) {
  const next = new Set(expanded.value);
  if (!next.delete(questionId)) next.add(questionId);
  expanded.value = next;
}
interface CardModel {
  summary: QuestionSummary;
  choice: ChoiceSummary | null;
  ordinal: OrdinalSummary | null;
  nps: NpsSummary | null;
  number: NumberSummary | null;
  list: TextSummary | DateSummary | null;
  ranking: RankingSummary | null;
  matrix: MatrixSummary | null;
  visibleCount: number;
  expandable: boolean;
  capped: boolean;
  wide: boolean;
}
const cards = computed<CardModel[]>(() =>
  summarizeDataset(props.dataset).map((summary) => {
    const entries = summary.view === "text" || summary.view === "date" ? summary.entries : [];
    const expandable = entries.length > TEXT_DEFAULT_VISIBLE;
    const open = expanded.value.has(summary.questionId);
    return {
      summary,
      choice: summary.view === "choice" ? summary : null,
      ordinal: summary.view === "ordinal" ? summary : null,
      nps: summary.view === "nps" ? summary : null,
      number: summary.view === "number" ? summary : null,
      list: summary.view === "text" || summary.view === "date" ? summary : null,
      ranking: summary.view === "ranking" ? summary : null,
      matrix: summary.view === "matrix" ? summary : null,
      visibleCount: !expandable ? entries.length : open ? Math.min(entries.length, TEXT_MAX_VISIBLE) : TEXT_DEFAULT_VISIBLE,
      expandable,
      capped: open && entries.length > TEXT_MAX_VISIBLE,
      wide: summary.view === "matrix" || summary.view === "text",
    };
  }),
);
function kindLabel(card: CardModel): string {
  const { summary } = card;
  if (summary.questionType) return t(`surveys.type.${summary.questionType}`);
  switch (summary.view) {
    case "choice": return t(summary.multi ? "surveys.summary.kindMulti" : "surveys.summary.kindChoice");
    case "ordinal": return t("surveys.summary.kindScale");
    case "nps": return t("surveys.summary.kindNps");
    case "number": return t("surveys.summary.kindNumber");
    case "text": return t("surveys.summary.kindText");
    case "date": return t("surveys.summary.kindDate");
    case "ranking": return t("surveys.summary.kindRanking");
    case "matrix":
      return t(`surveys.type.${summary.rowView === "multi" ? "matrix_multiple" : summary.rowView === "text" ? "matrix_text" : "matrix_single"}`);
  }
}
function metric(card: CardModel): { label: string; value: string } | null {
  if (card.ordinal?.mean !== null && card.ordinal?.mean !== undefined) {
    return { label: t("surveys.stat.mean"), value: meanText(card.ordinal.mean) };
  }
  if (card.nps) return { label: "NPS", value: String(card.nps.netPercent) };
  if (card.number?.mean !== null && card.number?.mean !== undefined) {
    return { label: t("surveys.stat.mean"), value: meanText(card.number.mean) };
  }
  return null;
}
function meanText(value: number): string {
  return Number(value.toFixed(2)).toLocaleString("en-US", { useGrouping: false });
}
function percentText(count: number, base: number): string {
  if (!base) return "0%";
  const percent = Math.round((count / base) * 1000) / 10;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}
function truncate(text: string): string {
  return text.length > TEXT_CLIP ? `${text.slice(0, TEXT_CLIP)}…` : text;
}
</script>

<template>
  <section class="response-summary">
    <div v-if="!dataset.responseCount" class="summary-empty tw:text-muted">
      <i class="pi pi-chart-bar" aria-hidden="true" />
      <p>{{ t("surveys.summary.empty") }}</p>
      <p class="tw:text-sm">{{ t("surveys.summary.emptyHint") }}</p>
    </div>
    <template v-else>
      <article
        v-for="card in cards"
        :id="`survey-summary-${card.summary.questionId}`"
        :key="card.summary.questionId"
        class="summary-card"
        :class="{ 'is-wide': card.wide }"
      >
        <header class="summary-head">
          <div class="summary-heading">
            <h3 class="summary-title">{{ card.summary.title }}</h3>
            <div class="summary-meta">
              <span class="summary-kind">{{ kindLabel(card) }}</span>
              <span v-if="card.summary.inferred" class="summary-kind summary-kind--inferred">
                {{ t("surveys.summary.inferredShape") }}
              </span>
              <span>{{ t("surveys.summary.answered", { n: card.summary.answered, total: dataset.responseCount }) }}</span>
              <span v-if="card.summary.unanswered" class="summary-missing">
                {{ t("surveys.summary.missingOnly", { n: card.summary.unanswered }) }}
              </span>
            </div>
          </div>
          <div v-if="metric(card)" class="summary-metric">
            <strong>{{ metric(card)!.value }}</strong>
            <span>{{ metric(card)!.label }}</span>
          </div>
        </header>

        <template v-if="card.choice">
          <p v-if="card.choice.multi" class="summary-hint">{{ t("surveys.summary.multiHint") }}</p>
          <SurveySummaryBars :buckets="card.choice.options" :base="card.choice.answered" color-mode="categorical" />
        </template>
        <SurveySummaryBars v-else-if="card.ordinal" :buckets="card.ordinal.buckets" :base="card.ordinal.answered" />

        <template v-else-if="card.nps">
          <dl class="nps-segments">
            <div class="nps-segment nps-segment--detractor">
              <dt>{{ t("surveys.summary.detractors") }}</dt>
              <dd>{{ card.nps.detractors }} · {{ percentText(card.nps.detractors, card.nps.answered) }}</dd>
            </div>
            <div class="nps-segment nps-segment--passive">
              <dt>{{ t("surveys.summary.passives") }}</dt>
              <dd>{{ card.nps.passives }} · {{ percentText(card.nps.passives, card.nps.answered) }}</dd>
            </div>
            <div class="nps-segment nps-segment--promoter">
              <dt>{{ t("surveys.summary.promoters") }}</dt>
              <dd>{{ card.nps.promoters }} · {{ percentText(card.nps.promoters, card.nps.answered) }}</dd>
            </div>
          </dl>
          <details class="nps-distribution">
            <summary>{{ t("surveys.summary.scoreDistribution") }}</summary>
            <SurveySummaryBars :buckets="card.nps.buckets" :base="card.nps.answered" />
          </details>
        </template>

        <template v-else-if="card.number">
          <dl class="number-stats">
            <div><dt>{{ t("surveys.minimum") }}</dt><dd>{{ card.number.min }}</dd></div>
            <div><dt>{{ t("surveys.maximum") }}</dt><dd>{{ card.number.max }}</dd></div>
          </dl>
          <SurveySummaryBars :buckets="card.number.buckets" :base="card.number.answered" />
        </template>

        <template v-else-if="card.list">
          <SurveyTextWordCloud v-if="card.summary.view === 'text'" :entries="card.list.entries" :locale="locale" />
          <ul class="text-entries">
            <li v-for="entry in card.list.entries.slice(0, card.visibleCount)" :key="entry.text">
              <span class="text-entry-body" :title="entry.text">{{ truncate(entry.text) }}</span>
              <span v-if="entry.count > 1" class="text-entry-count">×{{ entry.count }}</span>
            </li>
            <li v-if="!card.list.entries.length" class="tw:text-muted">{{ t("surveys.summary.noAnswers") }}</li>
          </ul>
          <div v-if="card.expandable" class="text-more">
            <p v-if="card.capped" class="tw:text-muted tw:text-sm">{{ t("surveys.summary.textCapped", { n: TEXT_MAX_VISIBLE }) }}</p>
            <Button
              variant="text"
              severity="secondary"
              :label="expanded.has(card.summary.questionId)
                ? t('surveys.summary.textCollapse')
                : t('surveys.summary.textExpand', { n: card.list.entries.length - card.visibleCount })"
              @click="toggleExpanded(card.summary.questionId)"
            />
          </div>
        </template>

        <template v-else-if="card.ranking">
          <p class="summary-section-label">{{ t("surveys.summary.averageRank") }}</p>
          <ol class="ranking-averages">
            <li v-for="item in card.ranking.items" :key="item.id">
              <span class="rank-badge">{{ item.averageRank === null ? "–" : meanText(item.averageRank) }}</span>
              <span class="rank-label">{{ item.label }}</span>
            </li>
          </ol>
        </template>

        <template v-else-if="card.matrix">
          <div v-for="row in card.matrix.rows" :key="row.id" class="matrix-row-group">
            <h4 class="matrix-row-label">{{ row.label }}</h4>
            <template v-if="row.summary.view === 'text'">
              <ul class="text-entries text-entries--compact">
                <li v-for="entry in row.summary.entries.slice(0, MATRIX_TEXT_VISIBLE)" :key="entry.text">
                  <span class="text-entry-body" :title="entry.text">{{ truncate(entry.text) }}</span>
                  <span v-if="entry.count > 1" class="text-entry-count">×{{ entry.count }}</span>
                </li>
                <li v-if="!row.summary.entries.length" class="tw:text-muted">{{ t("surveys.summary.noAnswers") }}</li>
              </ul>
              <p class="summary-hint">{{ t("surveys.summary.rowTotal", { n: row.summary.answered }) }}</p>
            </template>
            <SurveySummaryBars
              v-else
              :buckets="row.summary.view === 'choice' ? row.summary.options : row.summary.buckets"
              :base="row.summary.answered"
              :color-mode="row.summary.view === 'choice' ? 'categorical' : 'single'"
            />
          </div>
        </template>
      </article>
    </template>
  </section>
</template>

<style scoped>
.response-summary {
  columns: 2 24rem;
  column-gap: 20px;
}
.summary-empty {
  column-span: all;
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: var(--layout-section-spacing-compact) 16px;
  text-align: center;
}
.summary-empty p { margin: 0; }
.summary-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 24px;
  min-width: 0;
  margin: 0 0 20px;
  break-inside: avoid;
  padding: var(--layout-card-padding-lg);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
  box-shadow: var(--shadow-xs);
  scroll-margin-top: 16px;
}
.summary-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.summary-heading {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.summary-title {
  margin: 0;
  font-size: var(--font-size-title-sm);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.summary-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
}
.summary-kind { color: var(--color-text-secondary); }
.summary-kind--inferred { border-bottom: 1px dashed var(--color-border-strong); }
.summary-missing { color: var(--color-warning-600); }
.summary-metric {
  flex: none;
  display: grid;
  justify-items: end;
  gap: 2px;
  padding-left: 16px;
  border-left: 1px solid var(--color-border-subtle);
}
.summary-metric strong {
  color: var(--color-text-primary);
  font-size: 1.65rem;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.summary-metric span {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}
.summary-hint,
.summary-section-label {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}
.nps-segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.nps-segment {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: var(--radius);
}
.nps-segment dt {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}
.nps-segment dd {
  margin: 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.nps-segment--detractor { background: var(--color-danger-surface); }
.nps-segment--passive { background: var(--color-warning-surface); }
.nps-segment--promoter { background: var(--color-success-surface); }
.nps-distribution summary {
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.nps-distribution[open] summary { margin-bottom: 16px; }
.number-stats {
  display: flex;
  gap: 24px;
  margin: 0;
}
.number-stats dt {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}
.number-stats dd {
  margin: 4px 0 0;
  font-size: var(--font-size-title-sm);
  font-variant-numeric: tabular-nums;
}
.text-entries {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.text-entries li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.text-entry-body { min-width: 0; overflow-wrap: anywhere; }
.text-entry-count {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
}
.text-more { display: grid; justify-items: start; gap: 4px; }
.text-more p { margin: 0; }
.ranking-averages {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ranking-averages li { display: flex; align-items: center; gap: 12px; }
.rank-badge {
  flex: none;
  min-width: 2.5rem;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--color-bg-soft);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.rank-label { min-width: 0; overflow-wrap: anywhere; }
.matrix-row-group {
  display: grid;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-subtle);
}
.matrix-row-group:first-of-type { padding-top: 0; border-top: 0; }
.matrix-row-label { margin: 0; font-size: var(--font-size-body-sm); overflow-wrap: anywhere; }
.text-entries--compact { font-size: var(--font-size-body-sm); }
.summary-card.is-wide { column-span: all; }
@media (max-width: 767.98px) {
  .summary-card { padding: 16px; }
  .summary-head { gap: 12px; }
  .summary-metric { padding-left: 12px; }
  .summary-metric strong { font-size: 1.4rem; }
  .nps-segments { grid-template-columns: 1fr; }
}
</style>
