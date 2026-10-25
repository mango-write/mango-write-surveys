<script setup lang="ts">
// 左岛「大纲」tab（issue #217）：页 → 题目树，只读导航。点击题目把选中态
// 同步给设计画布（编辑器就地高亮 + 滚动定位）。
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlignLeft,
  CalendarDays,
  ChevronsUpDown,
  Circle,
  Clock,
  Hash,
  Image,
  Images,
  ListChecks,
  ListOrdered,
  Rows3,
  SlidersHorizontal,
  SquareCheck,
  Star,
  StickyNote,
  Table,
  Table2,
  ThumbsUp,
} from "lucide-vue-next";
import type { Component } from "vue";

import type { SurveyDefinition } from "../../contracts/index.js";

const props = defineProps<{
  definition: SurveyDefinition;
  selectedId: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const { t } = useI18n();

const TYPE_ICONS: Record<SurveyDefinition["questions"][number]["type"], Component> = {
  single: Circle,
  multiple: SquareCheck,
  image_single: Image,
  image_multiple: Images,
  dropdown: ChevronsUpDown,
  ranking: ListOrdered,
  text: AlignLeft,
  multi_text: ListChecks,
  number: Hash,
  scale: SlidersHorizontal,
  rating: Star,
  nps: ThumbsUp,
  date: CalendarDays,
  time: Clock,
  matrix_single: Table,
  matrix_multiple: Table2,
  matrix_text: Rows3,
  statement: StickyNote,
};

const questionsById = computed(() =>
  new Map(props.definition.questions.map((question) => [question.id, question])),
);
// 说明块没有题干，大纲里以题型名代称。
function outlineTitle(id: string): string {
  const question = questionsById.value.get(id);
  if (!question) return id;
  if (question.title) return question.title;
  return question.type === "statement" ? t("surveys.type.statement") : id;
}
</script>
<template>
  <div class="survey-outline">
    <p class="outline-hint">{{ t("surveys.outlineHint") }}</p>
    <p v-if="!definition.questions.length" class="outline-empty">
      {{ t("surveys.outlineEmpty") }}
    </p>
    <section v-for="(page, index) in definition.pages" :key="page.id" class="outline-page">
      <div class="page-head">
        <span class="page-title">{{ page.title || t("surveys.pageNumber", { n: index + 1 }) }}</span>
        <span class="page-count">{{ page.questionIds.length }}</span>
      </div>
      <button
        v-for="id in page.questionIds"
        :key="id"
        type="button"
        class="outline-question"
        :class="selectedId === id && 'outline-question--active'"
        :data-outline-question="id"
        @click="emit('select', id)"
      >
        <component :is="TYPE_ICONS[questionsById.get(id)!.type]" v-if="questionsById.get(id)" :size="14" />
        <span class="question-title">{{ outlineTitle(id) }}</span>
      </button>
    </section>
  </div>
</template>
<style scoped>
.survey-outline {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}
.outline-hint {
  margin: 2px 6px 8px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}
.outline-empty {
  margin: 2px 6px;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
}
.outline-page {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.outline-page:last-child {
  border-bottom: none;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px 2px;
}
.page-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-tertiary);
}
.page-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-faint, var(--color-text-tertiary));
  font-variant-numeric: tabular-nums;
}
.outline-question {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  text-align: start;
  cursor: pointer;
}
.outline-question:hover {
  background: var(--color-bg-soft);
  color: var(--color-text-primary);
}
.outline-question--active {
  background: var(--color-brand-50);
  color: var(--color-brand-700);
}
.outline-question--active:hover {
  background: var(--color-brand-50);
  color: var(--color-brand-700);
}
.question-title {
  min-width: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}
</style>
