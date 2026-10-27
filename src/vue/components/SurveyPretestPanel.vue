<script setup lang="ts">
// 试填反馈面板（issue #224 阶段4）：复制通俗版访谈提纲 + 按题记录四类反馈。
// 保存经工作台 commitDefinition 走草稿历史（不新增服务器路由）；记录是作者
// 自报，文案不宣称「已验证」。
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Textarea from "primevue/textarea";
import { Trash2 } from "lucide-vue-next";
import {
  PRETEST_ASPECTS,
  buildCognitiveInterviewGuide,
  formatCognitiveInterviewGuide,
  type CognitiveInterviewPhrasing,
  type SurveyDefinition,
  type SurveyPretestAspect,
  type SurveyPretestItemFeedback,
  type SurveyResearchPretest,
} from "../../core/index.js";
import { useSurveysNotify } from "../notify.js";

const props = defineProps<{
  visible: boolean;
  definition: SurveyDefinition;
  pretest: SurveyResearchPretest | null;
  /** 当前采集版本 id；草稿从未发布则为空串（记录不带版本号）。 */
  revisionId: string;
  /** 当前采集版本的序数（人读「第 n 版」）；未发布为 null。 */
  revisionNumber: number | null;
  busy?: boolean;
}>();
const emit = defineEmits<{
  "update:visible": [visible: boolean];
  save: [
    payload: {
      participantCount: number;
      notes: string;
      revisionId?: string;
      itemFeedback: SurveyPretestItemFeedback[];
    },
  ];
}>();
const { t } = useI18n();
const notify = useSurveysNotify();

const participantCount = ref<number | null>(null);
const notes = ref("");
const entries = ref<SurveyPretestItemFeedback[]>([]);
const formQuestionId = ref<string | null>(null);
const formAspect = ref<SurveyPretestAspect>("comprehension");
const formNote = ref("");
const formCount = ref<number | null>(null);

// 关闭守卫的基线：打开时刻的表单快照。Escape/关闭有未保存改动时先确认丢弃，
// 不静默丢掉已录入的反馈。
const baseline = ref("");
const confirmDiscard = ref(false);
const isDirty = computed(
  () =>
    JSON.stringify({
      count: participantCount.value,
      notes: notes.value.trim(),
      entries: entries.value,
    }) !== baseline.value,
);

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    participantCount.value = props.pretest?.participantCount ?? null;
    notes.value = props.pretest?.notes ?? "";
    entries.value = props.pretest?.itemFeedback
      ? [...props.pretest.itemFeedback]
      : [];
    formQuestionId.value = null;
    formAspect.value = "comprehension";
    formNote.value = "";
    formCount.value = null;
    confirmDiscard.value = false;
    baseline.value = JSON.stringify({
      count: participantCount.value,
      notes: notes.value.trim(),
      entries: entries.value,
    });
  },
  { immediate: true },
);

/** 关闭统一入口：有未保存改动先就地确认，确认后才真正 emit 关闭。 */
function requestClose() {
  if (!isDirty.value) {
    emit("update:visible", false);
    return;
  }
  confirmDiscard.value = true;
}
function discardAndClose() {
  confirmDiscard.value = false;
  emit("update:visible", false);
}

// 与提纲同一排序口径：页序展开，说明块不是题目。
const askableQuestions = computed(() =>
  props.definition.pages
    .flatMap((page) => page.questionIds)
    .flatMap((id) => {
      const question = props.definition.questions.find((candidate) => candidate.id === id);
      return question && question.type !== "statement" ? [question] : [];
    }),
);
const questionOptions = computed(() =>
  askableQuestions.value.map((question, index) => ({
    id: question.id,
    label: `${t("surveys.assistant.questionIndex", { n: index + 1 })} · ${question.title}`,
  })),
);
const aspectOptions = computed(() =>
  PRETEST_ASPECTS.map((aspect) => ({ value: aspect, label: aspectLabel(aspect) })),
);
const aspectLabel = (aspect: SurveyPretestAspect) =>
  t(`surveys.pretestPanel.aspect.${aspect}`);
const questionLabel = (questionId: string) =>
  questionOptions.value.find((option) => option.id === questionId)?.label ?? questionId;

const revisionLabel = computed(() =>
  props.revisionNumber
    ? t("surveys.pretestPanel.revision", { n: props.revisionNumber })
    : t("surveys.pretestPanel.revisionNone"),
);

function phrasing(): CognitiveInterviewPhrasing {
  return {
    intro: ({ title, questions }) => t("surveys.pretestGuide.intro", { title, questions }),
    probe: (aspect, title) => t(`surveys.pretestGuide.probe.${aspect}`, { title }),
  };
}
const guideIntro = computed(() =>
  buildCognitiveInterviewGuide(props.definition, phrasing()).intro,
);
async function copyGuide() {
  const text = formatCognitiveInterviewGuide(buildCognitiveInterviewGuide(props.definition, phrasing()));
  try {
    await navigator.clipboard.writeText(text);
    notify.success(t("surveys.pretestPanel.copyGuideDone"));
  } catch {
    notify.error(t("surveys.pretestPanel.copyGuideFailed"));
  }
}

const canAddEntry = computed(() => !!formQuestionId.value && !!formNote.value.trim());
function addEntry() {
  if (!canAddEntry.value || !formQuestionId.value) return;
  entries.value = [
    ...entries.value,
    {
      questionId: formQuestionId.value,
      aspect: formAspect.value,
      note: formNote.value.trim(),
      ...(formCount.value ? { count: formCount.value } : {}),
    },
  ];
  formQuestionId.value = null;
  formAspect.value = "comprehension";
  formNote.value = "";
  formCount.value = null;
}
function removeEntry(index: number) {
  entries.value = entries.value.filter((_, i) => i !== index);
}

const canSave = computed(
  () => !props.busy && typeof participantCount.value === "number" && participantCount.value >= 1,
);
function save() {
  if (!canSave.value || participantCount.value === null) return;
  emit("save", {
    participantCount: participantCount.value,
    notes: notes.value.trim(),
    ...(props.revisionId ? { revisionId: props.revisionId } : {}),
    itemFeedback: entries.value,
  });
}
</script>
<template>
  <Dialog
    :visible="visible"
    modal
    class="survey-dialog pretest-dialog"
    :header="t('surveys.pretestPanel.title')"
    @update:visible="requestClose"
  >
    <div class="pretest-body">
      <div v-if="confirmDiscard" class="discard-confirm" role="alertdialog" :aria-label="t('surveys.pretestPanel.discardTitle')">
        <p class="discard-text">{{ t("surveys.pretestPanel.discardTitle") }}</p>
        <div class="discard-actions">
          <Button :label="t('surveys.pretestPanel.keepEditing')" severity="secondary" @click="confirmDiscard = false" />
          <Button :label="t('surveys.pretestPanel.discardClose')" severity="danger" @click="discardAndClose" />
        </div>
      </div>
      <section class="pretest-guide">
        <p class="pretest-hint">{{ guideIntro }}</p>
        <Button
          :label="t('surveys.pretestPanel.copyGuide')"
          icon="pi pi-copy"
          severity="secondary"
          :disabled="!askableQuestions.length || busy"
          @click="copyGuide"
        />
      </section>
      <section class="pretest-meta">
        <label>{{ t("surveys.assistant.trialCount") }}
          <InputNumber v-model="participantCount" :min="1" :max="10000" show-buttons fluid :disabled="busy" />
        </label>
        <label>{{ t("surveys.assistant.trialNotes") }}
          <Textarea v-model="notes" :maxlength="2000" rows="2" auto-resize fluid :disabled="busy" />
        </label>
        <p class="pretest-hint">{{ revisionLabel }}</p>
      </section>
      <section class="pretest-entries">
        <p class="pretest-section-title">{{ t("surveys.pretestPanel.feedbackTitle") }}</p>
        <p v-if="!entries.length" class="pretest-hint">{{ t("surveys.pretestPanel.empty") }}</p>
        <ul v-else class="pretest-entry-list">
          <li v-for="(entry, index) in entries" :key="`${entry.questionId}-${entry.aspect}-${index}`" class="pretest-entry">
            <div class="pretest-entry-main">
              <span class="pretest-entry-meta">
                {{ questionLabel(entry.questionId) }} · {{ aspectLabel(entry.aspect) }}<template v-if="entry.count"> · {{ t("surveys.pretestPanel.entryCount", { n: entry.count }) }}</template>
              </span>
              <span class="pretest-entry-note">{{ entry.note }}</span>
            </div>
            <Button :aria-label="t('surveys.pretestPanel.remove')" severity="danger" variant="text" :disabled="busy" @click="removeEntry(index)">
              <template #icon><Trash2 :size="15" /></template>
            </Button>
          </li>
        </ul>
        <div class="pretest-form">
          <label>{{ t("surveys.pretestPanel.question") }}
            <Select v-model="formQuestionId" :options="questionOptions" option-label="label" option-value="id"
              :placeholder="t('surveys.pretestPanel.questionPlaceholder')" fluid :disabled="busy" />
          </label>
          <label>{{ t("surveys.pretestPanel.aspectLabel") }}
            <SelectButton v-model="formAspect" :options="aspectOptions" option-label="label" option-value="value"
              :allow-empty="false" :aria-label="t('surveys.pretestPanel.aspectLabel')" />
          </label>
          <label>{{ t("surveys.pretestPanel.note") }}
            <Textarea v-model="formNote" :maxlength="2000" rows="2" auto-resize fluid :disabled="busy" />
          </label>
          <label>{{ t("surveys.pretestPanel.people") }}
            <InputNumber v-model="formCount" :min="1" :max="999" show-buttons fluid :disabled="busy" />
          </label>
          <Button :label="t('surveys.pretestPanel.add')" severity="secondary" :disabled="!canAddEntry || busy" @click="addEntry" />
        </div>
      </section>
    </div>
    <template #footer>
      <div class="pretest-footer">
        <small v-if="!canSave && !busy" class="save-hint">{{ t("surveys.pretestPanel.saveHint") }}</small>
        <div class="footer-buttons">
          <Button :label="t('surveys.cancel')" text severity="secondary" :disabled="busy" @click="requestClose" />
          <Button class="pretest-save" :label="t('surveys.pretestPanel.save')" icon="pi pi-check" :disabled="!canSave" @click="save" />
        </div>
      </div>
    </template>
  </Dialog>
</template>
<style scoped>
.pretest-body {
  display: grid;
  gap: var(--layout-card-padding);
}
.pretest-guide,
.pretest-meta,
.pretest-entries {
  display: grid;
  gap: 0.6rem;
}
.pretest-section-title {
  margin: 0;
  font-weight: 600;
  font-size: 0.9rem;
}
.pretest-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
  line-height: 1.6;
}
label {
  display: grid;
  gap: 0.3rem;
  width: 100%;
  min-width: 0;
  font-size: 0.85rem;
}
.pretest-entry-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
  max-height: 14rem;
  overflow-y: auto;
}
.pretest-entry {
  display: flex;
  align-items: start;
  gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--layout-card-radius, 0.5rem);
}
.pretest-entry-main {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}
.pretest-entry-meta {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}
.pretest-entry-note {
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.pretest-form {
  display: grid;
  gap: 0.6rem;
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 0.6rem;
  justify-items: start;
}
.pretest-form label {
  width: 100%;
}
/* 禁用 Save 明确置灰：主题禁用态下按钮仍像可点（走查反馈），连点无反应像坏了。 */
.pretest-save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pretest-footer {
  display: grid;
  gap: 0.3rem;
  justify-items: end;
  width: 100%;
}
.save-hint {
  color: var(--color-text-tertiary);
}
.footer-buttons {
  display: flex;
  gap: 0.5rem;
}
.discard-confirm {
  display: grid;
  gap: 0.6rem;
  justify-items: start;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--color-warning-600, var(--color-border-strong));
  border-radius: var(--layout-card-radius, 0.5rem);
  background: var(--color-warning-surface, var(--color-bg-soft));
}
.discard-text {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
}
.discard-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
