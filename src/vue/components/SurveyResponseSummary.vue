<script setup lang="ts">
// 数据段「逐题摘要」视图（issue #217）：对已加载版本的答卷做纯客户端聚合，
// 不新增 API、不依赖 chart-engine（条形是 CSS）。口径跟随当前加载的发布版本
// （dataset 自带 revisionId），版本切换后由宿主重新加载 dataset，摘要随之更新。
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

// 长文本收敛：默认只列前 10 条，展开后最多 200 条（再长页面会失控，给出截断说明）。
const TEXT_DEFAULT_VISIBLE = 10;
const TEXT_MAX_VISIBLE = 200;
const TEXT_CLIP = 140;
const MATRIX_TEXT_VISIBLE = 5;

const props = defineProps<{
  dataset: SurveyDataset;
  /** 摘要口径对应的发布版本号（标题处标明；null 时省略）。 */
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
}

const cards = computed<CardModel[]>(() =>
  summarizeDataset(props.dataset).map((summary) => {
    const entries =
      summary.view === "text" || summary.view === "date"
        ? summary.entries
        : [];
    const expandable = entries.length > TEXT_DEFAULT_VISIBLE;
    const open = expanded.value.has(summary.questionId);
    return {
      summary,
      choice: summary.view === "choice" ? summary : null,
      ordinal: summary.view === "ordinal" ? summary : null,
      nps: summary.view === "nps" ? summary : null,
      number: summary.view === "number" ? summary : null,
      list:
        summary.view === "text" || summary.view === "date" ? summary : null,
      ranking: summary.view === "ranking" ? summary : null,
      matrix: summary.view === "matrix" ? summary : null,
      visibleCount: !expandable
        ? entries.length
        : open
          ? Math.min(entries.length, TEXT_MAX_VISIBLE)
          : TEXT_DEFAULT_VISIBLE,
      expandable,
      capped: open && entries.length > TEXT_MAX_VISIBLE,
    };
  }),
);

function kindLabel(card: CardModel): string {
  // 权威口径：徽章 = 发布定义里的真实题型；仅定义不可得（回落形状推断）时
  // 才按呈现视图标注，此时卡片另带「按变量形状推断」角标。
  const { summary } = card;
  if (summary.questionType) return t(`surveys.type.${summary.questionType}`);
  switch (summary.view) {
    case "choice":
      return t(summary.multi ? "surveys.summary.kindMulti" : "surveys.summary.kindChoice");
    case "ordinal":
      return t("surveys.summary.kindScale");
    case "nps":
      return t("surveys.summary.kindNps");
    case "number":
      return t("surveys.summary.kindNumber");
    case "text":
      return t("surveys.summary.kindText");
    case "date":
      return t("surveys.summary.kindDate");
    case "ranking":
      return t("surveys.summary.kindRanking");
    case "matrix":
      return t(
        `surveys.type.${
          summary.rowView === "multi"
            ? "matrix_multiple"
            : summary.rowView === "text"
              ? "matrix_text"
              : "matrix_single"
        }`,
      );
  }
}
function answeredLine(card: CardModel): string {
  return card.summary.unanswered
    ? t("surveys.summary.answeredWithMiss", {
        n: card.summary.answered,
        total: props.dataset.responseCount,
        miss: card.summary.unanswered,
      })
    : t("surveys.summary.answered", {
        n: card.summary.answered,
        total: props.dataset.responseCount,
      });
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
    <p v-if="revisionNumber !== null" class="summary-scope tw:text-muted">
      {{ t("surveys.summary.scope", { version: revisionNumber }) }}
    </p>
    <div v-if="!dataset.responseCount" class="summary-empty tw:text-muted">
      <i class="pi pi-chart-bar" aria-hidden="true" />
      <p>{{ t("surveys.summary.empty") }}</p>
      <p class="tw:text-sm">{{ t("surveys.summary.emptyHint") }}</p>
    </div>
    <template v-else>
      <article v-for="card in cards" :key="card.summary.questionId" class="summary-card">
        <header class="summary-head">
          <h3 class="summary-title">{{ card.summary.title }}</h3>
          <div class="summary-meta tw:text-muted">
            <span class="summary-kind">{{ kindLabel(card) }}</span>
            <span v-if="card.summary.inferred" class="summary-kind summary-kind--inferred">{{
              t("surveys.summary.inferredShape")
            }}</span>
            <span>{{ answeredLine(card) }}</span>
          </div>
        </header>

        <!-- 选择题 / 量表分布 -->
        <template v-if="card.choice">
          <p v-if="card.choice.multi" class="summary-hint tw:text-muted tw:text-sm">
            {{ t("surveys.summary.multiHint") }}
          </p>
          <SurveySummaryBars :buckets="card.choice.options" :base="card.choice.answered" />
        </template>

        <template v-else-if="card.ordinal">
          <SurveySummaryBars :buckets="card.ordinal.buckets" :base="card.ordinal.answered" />
          <p v-if="card.ordinal.mean !== null" class="summary-hint tw:text-muted tw:text-sm">
            {{ t("surveys.summary.meanLine", { mean: meanText(card.ordinal.mean) }) }}
          </p>
        </template>

        <!-- NPS：0–10 分布 + 贬损/中立/推荐三段与净值 -->
        <template v-else-if="card.nps">
          <SurveySummaryBars :buckets="card.nps.buckets" :base="card.nps.answered" />
          <dl class="nps-segments">
            <div class="nps-segment nps-segment--detractor">
              <dt>{{ t("surveys.summary.detractors") }}</dt>
              <dd>
                {{ card.nps.detractors }}
                （{{ percentText(card.nps.detractors, card.nps.answered) }}）
              </dd>
            </div>
            <div class="nps-segment nps-segment--passive">
              <dt>{{ t("surveys.summary.passives") }}</dt>
              <dd>
                {{ card.nps.passives }}
                （{{ percentText(card.nps.passives, card.nps.answered) }}）
              </dd>
            </div>
            <div class="nps-segment nps-segment--promoter">
              <dt>{{ t("surveys.summary.promoters") }}</dt>
              <dd>
                {{ card.nps.promoters }}
                （{{ percentText(card.nps.promoters, card.nps.answered) }}）
              </dd>
            </div>
          </dl>
          <p class="summary-hint tw:text-muted tw:text-sm">
            {{ t("surveys.summary.netLine", { net: card.nps.netPercent }) }}
          </p>
        </template>

        <!-- 数字：min/max/均值 + 分桶 -->
        <template v-else-if="card.number">
          <dl class="number-stats">
            <div>
              <dt>{{ t("surveys.minimum") }}</dt>
              <dd>{{ card.number.min }}</dd>
            </div>
            <div>
              <dt>{{ t("surveys.maximum") }}</dt>
              <dd>{{ card.number.max }}</dd>
            </div>
            <div>
              <dt>{{ t("surveys.stat.mean") }}</dt>
              <dd>{{ card.number.mean === null ? "–" : meanText(card.number.mean) }}</dd>
            </div>
          </dl>
          <SurveySummaryBars :buckets="card.number.buckets" :base="card.number.answered" />
        </template>

        <!-- 文本 / 日期：列举 + 收敛 -->
        <template v-else-if="card.list">
          <SurveyTextWordCloud
            v-if="card.summary.view === 'text'"
            :entries="card.list.entries"
            :locale="locale"
          />
          <ul class="text-entries">
            <li v-for="entry in card.list.entries.slice(0, card.visibleCount)" :key="entry.text">
              <span class="text-entry-body" :title="entry.text">{{ truncate(entry.text) }}</span>
              <span v-if="entry.count > 1" class="text-entry-count tw:text-muted">×{{ entry.count }}</span>
            </li>
            <li v-if="!card.list.entries.length" class="tw:text-muted">
              {{ t("surveys.summary.noAnswers") }}
            </li>
          </ul>
          <div v-if="card.expandable" class="text-more">
            <p v-if="card.capped" class="tw:text-muted tw:text-sm">
              {{ t("surveys.summary.textCapped", { n: TEXT_MAX_VISIBLE }) }}
            </p>
            <Button
              variant="text"
              severity="secondary"
              :label="
                expanded.has(card.summary.questionId)
                  ? t('surveys.summary.textCollapse')
                  : t('surveys.summary.textExpand', {
                      n: card.list.entries.length - card.visibleCount,
                    })
              "
              @click="toggleExpanded(card.summary.questionId)"
            />
          </div>
        </template>

        <!-- 排序：平均位次 -->
        <template v-else-if="card.ranking">
          <ol class="ranking-averages">
            <li v-for="item in card.ranking.items" :key="item.id">
              <span class="rank-badge">{{
                item.averageRank === null ? "–" : meanText(item.averageRank)
              }}</span>
              <span class="rank-label">{{ item.label }}</span>
            </li>
          </ol>
          <p class="summary-hint tw:text-muted tw:text-sm">
            {{ t("surveys.summary.rankHint") }}
          </p>
        </template>

        <!-- 矩阵：每行一组 -->
        <template v-else-if="card.matrix">
          <div v-for="row in card.matrix.rows" :key="row.id" class="matrix-row-group">
            <h4 class="matrix-row-label">{{ row.label }}</h4>
            <template v-if="row.summary.view === 'text'">
              <ul class="text-entries text-entries--compact">
                <li
                  v-for="entry in row.summary.entries.slice(0, MATRIX_TEXT_VISIBLE)"
                  :key="entry.text"
                >
                  <span class="text-entry-body" :title="entry.text">{{ truncate(entry.text) }}</span>
                  <span v-if="entry.count > 1" class="text-entry-count tw:text-muted">×{{ entry.count }}</span>
                </li>
                <li v-if="!row.summary.entries.length" class="tw:text-muted">
                  {{ t("surveys.summary.noAnswers") }}
                </li>
              </ul>
              <p class="summary-hint tw:text-muted tw:text-sm">
                {{ t("surveys.summary.rowTotal", { n: row.summary.answered }) }}
              </p>
            </template>
            <SurveySummaryBars
              v-else
              :buckets="
                row.summary.view === 'choice'
                  ? row.summary.options
                  : row.summary.buckets
              "
              :base="row.summary.answered"
            />
          </div>
        </template>
      </article>
    </template>
  </section>
</template>
<style scoped>
.response-summary {
  display: grid;
  gap: var(--layout-card-padding);
}
.summary-scope {
  margin: 0;
}
.summary-empty {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  padding: var(--layout-section-spacing-compact, 2rem) 1rem;
  text-align: center;
}
.summary-empty p {
  margin: 0;
}
.summary-card {
  display: grid;
  gap: var(--layout-card-padding-compact);
  padding: var(--layout-card-padding);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
}
.summary-head {
  display: grid;
  gap: 4px;
}
.summary-title {
  margin: 0;
  font-size: var(--font-size-title-sm, 1rem);
  overflow-wrap: anywhere;
}
.summary-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 12px;
}
.summary-kind {
  padding: 1px 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill, 999px);
}
.summary-kind--inferred {
  border-style: dashed;
}
.summary-hint {
  margin: 0;
}
.nps-segments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}
.nps-segment {
  display: grid;
  gap: 2px;
  padding: 6px 12px;
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
}
.nps-segment dt {
  font-size: 12px;
  color: var(--color-text-secondary);
}
.nps-segment dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.nps-segment--detractor {
  background: var(--color-danger-surface);
}
.nps-segment--passive {
  background: var(--color-warning-surface);
}
.nps-segment--promoter {
  background: var(--color-success-surface);
}
.number-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
}
.number-stats dt {
  font-size: 12px;
  color: var(--color-text-tertiary);
}
.number-stats dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.text-entries {
  display: grid;
  gap: 6px;
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
.text-entry-body {
  min-width: 0;
  overflow-wrap: anywhere;
}
.text-entry-count {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.text-more {
  display: grid;
  justify-items: start;
  gap: 4px;
}
.text-more p {
  margin: 0;
}
.ranking-averages {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ranking-averages li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rank-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  padding: 2px 8px;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-bg-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.rank-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.matrix-row-group {
  display: grid;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-subtle);
}
.matrix-row-group:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.matrix-row-label {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.text-entries--compact {
  font-size: 13px;
}
</style>
