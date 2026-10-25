<script setup lang="ts">
// 模板选择弹层（issue #217）：静态模板清单 + 只读题目大纲预览，选中即由宿主
// 走既有 create + save 通道建卷进工作台。大纲是题目文字列表，不做完整渲染。
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import { surveyTemplates, type SurveyTemplate } from "../lib/templates.js";

const props = defineProps<{
  visible: boolean;
  /** 建卷请求进行中：禁用确认按钮，防止双开。 */
  busy?: boolean;
}>();
const emit = defineEmits<{
  "update:visible": [value: boolean];
  select: [template: SurveyTemplate];
}>();
const { t } = useI18n();
const templates = computed(() => surveyTemplates(t as unknown as (key: string) => string));
const selectedId = ref("");
const selected = computed(
  () => templates.value.find((tpl) => tpl.id === selectedId.value) ?? null,
);

interface OutlineQuestion {
  id: string;
  title: string;
  type: string;
  required: boolean;
}
interface OutlinePage {
  id: string;
  index: number;
  title: string;
  questions: OutlineQuestion[];
}
function outline(template: SurveyTemplate): OutlinePage[] {
  return template.definition.pages.map((page, index) => ({
    id: page.id,
    index: index + 1,
    title: page.title,
    questions: page.questionIds.flatMap((questionId) => {
      const question = template.definition.questions.find(
        (candidate) => candidate.id === questionId,
      );
      return question
        ? [
            {
              id: question.id,
              title: question.title || t("surveys.type.statement"),
              type: t(`surveys.type.${question.type}`),
              required: question.required,
            },
          ]
        : [];
    }),
  }));
}
function choose(template: SurveyTemplate) {
  emit("select", template);
}
</script>
<template>
  <Dialog
    :visible="props.visible"
    modal
    :header="t('surveys.templates.pickTitle')"
    class="survey-dialog survey-template-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <p class="tw:text-muted tw:mt-0">{{ t("surveys.templates.pickHint") }}</p>
    <div class="template-list">
      <template v-for="template in templates" :key="template.id">
        <button
          type="button"
          class="template-card"
          :class="{ 'template-card--selected': template.id === selectedId }"
          :aria-pressed="template.id === selectedId"
          @click="selectedId = selectedId === template.id ? '' : template.id"
        >
          <span class="template-name">{{ template.name }}</span>
          <span class="template-desc">{{ template.description }}</span>
          <span class="template-meta tw:text-muted">
            {{
              t("surveys.templates.metaLine", {
                pages: template.definition.pages.length,
                questions: template.definition.questions.length,
              })
            }}
            · {{ t("surveys.templates.sceneLabel") }}{{ template.scene }}
          </span>
        </button>
        <div
          v-if="template.id === selectedId"
          class="template-outline"
          :aria-label="t('surveys.templates.previewLabel')"
        >
          <p class="template-outline-title tw:text-muted">
            {{ t("surveys.templates.previewLabel") }}
          </p>
          <div v-for="page in outline(template)" :key="page.id" class="outline-page">
            <p class="outline-page-title">
              {{ t("surveys.pageNumber", { n: page.index }) }} · {{ page.title }}
            </p>
            <ol class="outline-questions">
              <li v-for="question in page.questions" :key="question.id">
                <span>{{ question.title }}</span>
                <span class="outline-question-meta tw:text-muted">
                  {{ question.type }}<template v-if="question.required"> · {{ t("surveys.required") }}</template>
                </span>
              </li>
            </ol>
          </div>
        </div>
      </template>
    </div>
    <template #footer>
      <Button
        :label="t('surveys.cancel')"
        text
        severity="secondary"
        @click="emit('update:visible', false)"
      />
      <Button
        :label="t('surveys.templates.use')"
        :disabled="!selected || props.busy"
        @click="selected && choose(selected)"
      />
    </template>
  </Dialog>
</template>
<style scoped>
.template-list {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.template-card {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition:
    border-color var(--motion-duration-fast) var(--motion-ease-standard),
    background-color var(--motion-duration-fast) var(--motion-ease-standard);
}
/* 描边 + 着色只属于选中态；悬停只用底色轻提示，不再出第二套描边——
   点选后归属一眼可辨（PM 审判：选中与悬停双高亮）。 */
.template-card:hover:not(.template-card--selected):not(:disabled) {
  background: var(--color-bg-soft);
}
.template-card--selected {
  border-color: var(--color-brand-500);
  background: var(--color-brand-50);
  box-shadow: 0 0 0 1px var(--color-brand-500);
}
.template-card:focus-visible {
  outline: none;
  box-shadow: var(--effect-focus-ring);
}
.template-name {
  font-weight: 600;
}
.template-desc {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.template-meta {
  font-size: 12px;
}
.template-outline {
  display: grid;
  gap: 8px;
  padding: 10px 14px 12px;
  border: 1px dashed var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
}
.template-outline-title {
  margin: 0;
  font-size: 12px;
}
.outline-page {
  display: grid;
  gap: 4px;
}
.outline-page-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.outline-questions {
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: 1.25rem;
  font-size: 13px;
}
.outline-questions li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.outline-questions li > span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.outline-question-meta {
  font-size: 12px;
}
:global(.survey-template-dialog) {
  width: min(34rem, calc(100vw - 2rem));
}
</style>
