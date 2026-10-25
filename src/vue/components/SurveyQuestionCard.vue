<script setup lang="ts">
// 题目卡片（issue #217）：按受访者所见渲染，选中后就地编辑。所有变更产出
// 新的 question 对象经 change 交给画布（进历史栈与自动保存），本组件不改 props。
// 工具条在选中卡上常驻可见（触屏没有 hover）；键盘可达性由上移/下移按钮兜底。
// 换题型只上报目标类型：载荷暂存/恢复与破坏性确认由画布统一裁决。
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import RadioButton from "primevue/radiobutton";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import {
  AlignLeft,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  Circle,
  Clock,
  Copy,
  GripVertical,
  Hash,
  Image as ImageIcon,
  ImageOff,
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
  Trash2,
} from "lucide-vue-next";
import type { Component } from "vue";

import type {
  SurveyCondition,
  SurveyLabeledNode,
  SurveyOption,
  SurveyQuestion,
} from "../../contracts/index.js";
import SurveyLabeledListEditor from "./SurveyLabeledListEditor.vue";
import SurveyMarkdownField from "./SurveyMarkdownField.vue";
import SurveyQuestionField from "./SurveyQuestionField.vue";
import SurveyTypeMenu from "./SurveyTypeMenu.vue";
import { isDefaultOptionLabel, uid } from "../lib/definition-ops.js";
import { useSurveysApi } from "../api.js";
import { SurveysApiError, useSurveysHost } from "../host.js";
import { useSurveysNotify } from "../notify.js";

const props = defineProps<{
  question: SurveyQuestion;
  /** 全卷序号（画布按页序展开计算）。 */
  number: number;
  selected: boolean;
  disabled?: boolean;
  /** showIf 可引用的前题（按整卷顺序排在本书之前的可选/可数题）。 */
  conditionSources: SurveyQuestion[];
  /** 该题当前第一条校验问题的人话文案；空串 = 无问题。 */
  issueMessage?: string;
  /** 校验定位脉冲（约 2s 描边，画布控制起止）。 */
  flashing?: boolean;
  dragging?: boolean;
  dropSide?: "before" | "after" | null;
  /** 图片选项上传/缩略图的认证侧通道；缺省（测试/纯展示）不渲染上传钮。 */
  surveyId?: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  change: [next: SurveyQuestion, label?: string];
  "change-type": [type: SurveyQuestion["type"]];
  copy: [id: string];
  remove: [id: string];
  move: [delta: number];
  "drop-on": [id: string, side: "before" | "after"];
  "drag-start": [id: string];
  "drag-end": [];
}>();
const { t } = useI18n();
const surveysApi = useSurveysApi();

const TYPE_ICONS: Record<SurveyQuestion["type"], Component> = {
  single: Circle,
  multiple: SquareCheck,
  image_single: ImageIcon,
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

// 与 validate-definition 的条件源允许表一致的 UI 白名单：矩阵/排序/多项填空/
// 说明块不能作条件源，文本/日期/时间的匹配值没有好的编辑控件也不进候选。
const CONDITION_SOURCE_TYPES = new Set([
  "single",
  "multiple",
  "image_single",
  "image_multiple",
  "dropdown",
  "scale",
  "rating",
  "nps",
  "number",
]);

// 未选中卡的预览直接复用作答控件的题型；其余沿用 M2 的轻量预览/ghost。
const NEW_TYPE_PREVIEW = new Set([
  "dropdown",
  "rating",
  "nps",
  "date",
  "time",
  "ranking",
  "matrix_single",
  "matrix_multiple",
  "matrix_text",
  "image_single",
  "image_multiple",
  "multi_text",
]);

const rootRef = ref<HTMLElement | null>(null);
const titleInput = ref<{ $el?: HTMLTextAreaElement } | null>(null);
const optionInputs = ref<(HTMLInputElement | HTMLTextAreaElement)[]>([]);
const typeMenuOpen = ref(false);
const advancedOpen = ref(false);
const scaleValues = computed<number[]>(() => {
  const question = props.question;
  if (question.type !== "scale") return [];
  return Array.from(
    { length: Math.max(0, question.max - question.min + 1) },
    (_, i) => question.min + i,
  );
});

// 选中即落焦题干；焦点已在卡内可编辑元素（点击选项行进入选中）时不抢。
watch(
  () => props.selected,
  (selected, previous) => {
    if (!selected || previous) return;
    void nextTick(() => {
      const root = rootRef.value;
      if (!root) return;
      const active = document.activeElement;
      if (
        active &&
        root.contains(active) &&
        (active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLElement && active.isContentEditable))
      )
        return;
      titleInput.value?.$el?.focus();
    });
  },
);

function setTitle(value: string) {
  emit("change", { ...props.question, title: value }, `q:${props.question.id}:title`);
}

function onTitleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    titleInput.value?.$el?.blur();
  }
}

// 选项族（单选/多选/图片单选/图片多选/下拉/排序）共用同一套选项编辑器交互；
// type predicate 让模板里的 v-if 也能收窄联合类型。
const OPTION_TYPES = [
  "single",
  "multiple",
  "image_single",
  "image_multiple",
  "dropdown",
  "ranking",
] as const;
type OptionQuestion = Extract<SurveyQuestion, { type: (typeof OPTION_TYPES)[number] }>;
function isOptionQuestion(question: SurveyQuestion): question is OptionQuestion {
  return (OPTION_TYPES as readonly string[]).includes(question.type);
}
const isImageQuestion = computed(() =>
  props.question.type === "image_single" || props.question.type === "image_multiple",
);
const mediaUrlBase = computed(() =>
  props.surveyId ? `/api/surveys/${props.surveyId}/media` : undefined,
);
function thumbSrc(option: SurveyOption): string | undefined {
  if (option.imageUrl) return option.imageUrl;
  if (option.imageFileId && mediaUrlBase.value)
    return `${mediaUrlBase.value}/${option.imageFileId}`;
  return undefined;
}

// 选项图上传：一个共享的隐藏 file input，按 uploadTarget 定位到选项行。
// 字节嗅探与 5MB 闸在服务端；前端按状态码映射文案，不重复实现白名单。
const notify = useSurveysNotify();
const fileInput = ref<HTMLInputElement | null>(null);
const uploadTarget = ref<string | null>(null);
const uploading = ref(false);
function pickImage(optionId: string) {
  if (!props.surveyId || uploading.value) return;
  uploadTarget.value = optionId;
  fileInput.value?.click();
}
function removeImage(optionId: string) {
  if (!isOptionQuestion(props.question)) return;
  // imageFileId 连同派生 imageUrl 一起剥掉；换图直接再点缩略图上传覆盖。
  patchOption(optionId, (option) => {
    const { imageFileId: _dropped, imageUrl: _derived, ...rest } = option;
    return rest;
  });
}
async function onImageFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const optionId = uploadTarget.value;
  uploadTarget.value = null;
  if (!file || !optionId || !props.surveyId) return;
  uploading.value = true;
  try {
    const media = await surveysApi.uploadMedia(props.surveyId, file);
    patchOption(optionId, (option) => ({ ...option, imageFileId: media.id }));
  } catch (e) {
    const status = e instanceof SurveysApiError ? e.status : 0;
    notify.error(
      t(
        status === 413
          ? "surveys.optionImageTooLarge"
          : status === 415
            ? "surveys.optionImageUnsupported"
            : "surveys.optionImageFailed",
      ),
    );
  } finally {
    uploading.value = false;
  }
}
function patchOption(
  optionId: string,
  produce: (old: SurveyOption) => SurveyOption,
) {
  if (!isOptionQuestion(props.question)) return;
  const options = props.question.options.map((option) =>
    option.id === optionId ? produce(option) : option,
  );
  emit(
    "change",
    { ...props.question, options } as SurveyQuestion,
    `q:${props.question.id}:opt`,
  );
}

function setOptionLabel(optionId: string, value: string | undefined) {
  if (!isOptionQuestion(props.question)) return;
  const label = value ?? "";
  patchOption(optionId, (option) => ({ ...option, label }));
}

// 默认文案聚焦即全选，首键替换；非默认文案不动光标。
function onOptionFocus(event: FocusEvent) {
  const input = event.target as HTMLInputElement;
  if (isDefaultOptionLabel(input.value)) input.select();
}

// Enter 新增的是「待落笔」的空选项行：UI 态持有、不进 definition（空 label
// 过不了保存 schema，曾表现为空选项期间自动保存 400 + 顶栏「保存失败」）。
// 首个字符输入时才提交为真实选项；Backspace/失焦且仍为空则丢弃。
const pendingAfter = ref<number | null>(null);
const pendingInput = ref<HTMLInputElement | null>(null);

function addOptionAfter(index: number) {
  if (!isOptionQuestion(props.question)) return;
  if (props.question.options.length >= 30) return;
  pendingAfter.value = index;
  void nextTick(() => pendingInput.value?.focus());
}

function commitPendingOption(value: string | undefined) {
  const at = pendingAfter.value;
  if (at === null) return;
  if (!isOptionQuestion(props.question)) return;
  const label = (value ?? "").trimStart();
  if (!label) return;
  pendingAfter.value = null;
  const options = [
    ...props.question.options.slice(0, at + 1),
    { id: uid("o"), label },
    ...props.question.options.slice(at + 1),
  ];
  emit(
    "change",
    { ...props.question, options } as SurveyQuestion,
    `q:${props.question.id}:opt`,
  );
  // 提交后该行变成真实选项行，把焦点跟过去继续输入。
  void nextTick(() => optionInputs.value[at + 1]?.focus());
}

function discardPendingOption() {
  const at = pendingAfter.value;
  if (at === null) return;
  pendingAfter.value = null;
  void nextTick(() => optionInputs.value[at]?.focus());
}

function onPendingKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    return;
  }
  if (event.key === "Backspace" && !(event.target as HTMLInputElement).value) {
    event.preventDefault();
    discardPendingOption();
  }
}

function removeOptionAt(index: number) {
  if (!isOptionQuestion(props.question)) return;
  // 最少保留 2 项：空行 Backspace 在下限时只是不动，不做声。
  if (props.question.options.length <= 2) return;
  const options = props.question.options.filter((_, i) => i !== index);
  emit("change", { ...props.question, options } as SurveyQuestion);
  void nextTick(() => optionInputs.value[Math.max(0, index - 1)]?.focus());
}

function onOptionKeydown(index: number, event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    addOptionAfter(index);
    return;
  }
  if (event.key === "Backspace") {
    const input = event.target as HTMLInputElement;
    if (input.value !== "" || input.selectionStart !== 0 || input.selectionEnd !== 0)
      return;
    removeOptionAt(index);
  }
}

function toggleExclusive(optionId: string) {
  if (props.question.type !== "multiple" && props.question.type !== "image_multiple")
    return;
  const options = props.question.options.map((option) =>
    option.id === optionId
      ? { ...option, exclusive: !option.exclusive }
      : option,
  );
  emit("change", { ...props.question, options } as SurveyQuestion);
}

function setRequired(required: boolean) {
  emit("change", { ...props.question, required });
}
// 菜单先收起再上报：载荷裁决（暂存/确认）在画布，是异步的。
function onTypeMenuSelect(type: SurveyQuestion["type"]) {
  typeMenuOpen.value = false;
  emit("change-type", type);
}

// ── 高级属性 ────────────────────────────────────────────────────────────
function setShowIf(questionId: string | null) {
  if (!questionId) {
    if (!props.question.showIf) return;
    const next = { ...props.question };
    delete next.showIf;
    emit("change", next);
    return;
  }
  const source = props.conditionSources.find((q) => q.id === questionId);
  if (!source) return;
  // 默认匹配值取该题型合法域的第一个值（validate 的条件值域约束）。
  const value: string | number =
    source.type === "single" ||
    source.type === "image_single" ||
    source.type === "multiple" ||
    source.type === "image_multiple" ||
    source.type === "dropdown"
      ? (source.options[0]?.id ?? "")
      : source.type === "scale"
        ? source.min
        : source.type === "rating"
          ? 1
          : source.type === "nps"
            ? 0
            : 0;
  const showIf: SurveyCondition = {
    questionId,
    op: source.type === "multiple" || source.type === "image_multiple" ? "contains" : "eq",
    value,
  };
  emit("change", { ...props.question, showIf });
}
function setConditionValue(value: string | number | null) {
  if (!props.question.showIf || value === null) return;
  emit("change", {
    ...props.question,
    showIf: { ...props.question.showIf, value },
  });
}
const conditionSource = computed(() =>
  props.conditionSources.find(
    (q) => q.id === props.question.showIf?.questionId,
  ),
);
const conditionOptions = computed(() =>
  conditionSource.value &&
  (conditionSource.value.type === "single" ||
    conditionSource.value.type === "image_single" ||
    conditionSource.value.type === "multiple" ||
    conditionSource.value.type === "image_multiple" ||
    conditionSource.value.type === "dropdown")
    ? conditionSource.value.options
    : [],
);

function setMultiline(multiline: boolean) {
  if (props.question.type !== "text") return;
  emit("change", { ...props.question, multiline });
}
function setMaxLength(value: number | null) {
  if (props.question.type !== "text" || value === null) return;
  emit("change", { ...props.question, maxLength: value });
}
function setNumberBound(bound: "min" | "max", value: number | null) {
  if (props.question.type !== "number" || value === null) return;
  if (bound === "min") emit("change", { ...props.question, min: value });
  else emit("change", { ...props.question, max: value });
}
function setScaleBound(bound: "min" | "max", value: number | null) {
  if (props.question.type !== "scale" || value === null) return;
  if (bound === "min") emit("change", { ...props.question, min: value });
  else emit("change", { ...props.question, max: value });
}
function setScaleLabel(bound: "minLabel" | "maxLabel", value: string | undefined) {
  if (props.question.type !== "scale") return;
  const label = value ?? "";
  if (bound === "minLabel")
    emit("change", { ...props.question, minLabel: label }, `q:${props.question.id}:minLabel`);
  else emit("change", { ...props.question, maxLabel: label }, `q:${props.question.id}:maxLabel`);
}

function setRatingMax(value: number | null) {
  if (props.question.type !== "rating" || value === null) return;
  emit("change", { ...props.question, max: value });
}
function setNpsLabel(bound: "minLabel" | "maxLabel", value: string | undefined) {
  if (props.question.type !== "nps") return;
  const label = value ?? "";
  if (bound === "minLabel")
    emit("change", { ...props.question, minLabel: label }, `q:${props.question.id}:minLabel`);
  else emit("change", { ...props.question, maxLabel: label }, `q:${props.question.id}:maxLabel`);
}
function setDateBound(bound: "min" | "max", value: string) {
  if (props.question.type !== "date") return;
  // 清空 = 移除该边界；非法中间值（输入一半）不动定义。
  if (!value) {
    const next = { ...props.question };
    delete next[bound];
    emit("change", next);
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  emit("change", { ...props.question, [bound]: value });
}
function setMatrixRows(rows: SurveyLabeledNode[]) {
  if (
    props.question.type !== "matrix_single" &&
    props.question.type !== "matrix_multiple" &&
    props.question.type !== "matrix_text"
  )
    return;
  emit(
    "change",
    { ...props.question, rows } as SurveyQuestion,
    `q:${props.question.id}:rows`,
  );
}
function setMatrixColumns(columns: SurveyLabeledNode[]) {
  if (props.question.type !== "matrix_single" && props.question.type !== "matrix_multiple")
    return;
  emit(
    "change",
    { ...props.question, columns } as SurveyQuestion,
    `q:${props.question.id}:columns`,
  );
}
function setMultiTextItems(items: SurveyLabeledNode[]) {
  if (props.question.type !== "multi_text") return;
  emit("change", { ...props.question, items } as SurveyQuestion, `q:${props.question.id}:items`);
}
function setStatementBody(body: string) {
  if (props.question.type !== "statement") return;
  emit("change", { ...props.question, body }, `q:${props.question.id}:body`);
}
const { renderMarkdown } = useSurveysHost();
const statementHtml = computed(() =>
  props.question.type === "statement" && props.question.body
    ? renderMarkdown(props.question.body)
    : "",
);

// ── 拖拽 ────────────────────────────────────────────────────────────────
function onDragStart(event: DragEvent) {
  if (props.disabled || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/survey-question", props.question.id);
  const card = rootRef.value;
  if (card) event.dataTransfer.setDragImage(card, 24, 16);
  emit("drag-start", props.question.id);
}
function onDragOver(event: DragEvent) {
  if (props.disabled) return;
  event.preventDefault();
  // 卡上的插入线语义不被页级 dragover（追加页尾）覆盖。
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) return;
  const side = event.clientY - rect.top < rect.height / 2 ? "before" : "after";
  emit("drop-on", props.question.id, side);
}
function onDrop(event: DragEvent) {
  if (props.disabled) return;
  // 阻止默认（否则浏览器当导航处理）；移动由画布根的 drop 监听统一提交。
  event.preventDefault();
}

function optionRef(el: unknown, index: number) {
  const input =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el
      : (el as { $el?: HTMLInputElement } | null)?.$el;
  if (input) optionInputs.value[index] = input;
}
</script>
<template>
  <article
    ref="rootRef"
    class="q-card"
    :class="{
      'q-card--selected': selected,
      'q-card--flash': flashing,
      'q-card--dragging': dragging,
      [`q-card--drop-${dropSide}`]: !!dropSide,
    }"
    :data-canvas-question="question.id"
    @click="!selected && !disabled && emit('select', question.id)"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <header class="q-card__head">
      <button
        type="button"
        class="q-card__handle"
        :aria-label="t('surveys.dragHandle')"
        :disabled="disabled"
        draggable="true"
        v-tooltip.top="t('surveys.dragHandle')"
        @dragstart="onDragStart"
        @dragend="emit('drag-end')"
        @click="emit('select', question.id)"
      >
        <GripVertical :size="14" />
      </button>
      <span class="q-card__number">{{ number }}</span>
      <span
        v-if="issueMessage"
        class="q-card__issue"
        v-tooltip.top="issueMessage"
      >
        <AlertTriangle :size="14" />
      </span>
      <div v-if="selected && !disabled" class="q-card__toolbar">
        <div class="menu-anchor">
          <Button
            severity="secondary"
            variant="text"
            class="type-toggle"
            :label="t(`surveys.type.${question.type}`)"
            :aria-label="`${t('surveys.questionType')}：${t(`surveys.type.${question.type}`)}`"
            v-tooltip.top="t('surveys.questionType')"
            @click.stop="typeMenuOpen = !typeMenuOpen"
          >
            <template #icon>
              <component :is="TYPE_ICONS[question.type]" :size="14" />
            </template>
          </Button>
          <SurveyTypeMenu
            :open="typeMenuOpen"
            @select="onTypeMenuSelect"
            @close="typeMenuOpen = false"
          />
        </div>
        <label v-if="question.type !== 'statement'" class="required-toggle" @click.stop
          ><Checkbox
            binary
            :model-value="question.required"
            :aria-label="t('surveys.required')"
            @update:model-value="setRequired"
          /><span>{{ t("surveys.required") }}</span></label
        >
        <Button
          severity="secondary"
          variant="text"
          :aria-label="t('surveys.duplicateQuestion')"
          v-tooltip.top="t('surveys.duplicateQuestion')"
          @click.stop="emit('copy', question.id)"
        >
          <template #icon><Copy :size="15" /></template>
        </Button>
        <Button
          severity="secondary"
          variant="text"
          :aria-label="t('surveys.moveUp')"
          :disabled="number === 1"
          v-tooltip.top="t('surveys.moveUp')"
          @click.stop="emit('move', -1)"
        >
          <template #icon><ArrowUp :size="15" /></template>
        </Button>
        <Button
          severity="secondary"
          variant="text"
          :aria-label="t('surveys.moveDown')"
          v-tooltip.top="t('surveys.moveDown')"
          @click.stop="emit('move', 1)"
        >
          <template #icon><ArrowDown :size="15" /></template>
        </Button>
        <Button
          severity="danger"
          variant="text"
          :aria-label="t('surveys.deleteQuestion')"
          v-tooltip.top="t('surveys.deleteQuestion')"
          @click.stop="emit('remove', question.id)"
        >
          <template #icon><Trash2 :size="15" /></template>
        </Button>
      </div>
    </header>
    <div class="q-card__body" @click="!selected && !disabled && emit('select', question.id)">
      <!-- 说明块：题干即内容，选中直接编 markdown；题干输入框不渲染。 -->
      <template v-if="question.type === 'statement'">
        <SurveyMarkdownField
          v-if="selected && !disabled"
          :model-value="question.body"
          :aria-label="t('surveys.statementBody')"
          :placeholder="t('surveys.statementBodyPlaceholder')"
          @change="setStatementBody"
        />
        <div
          v-else-if="statementHtml"
          class="mw-md q-card__statement"
          aria-hidden="true"
          v-html="statementHtml"
        />
        <div v-else class="q-card__statement q-card__statement--empty tw:text-muted" aria-hidden="true">
          {{ t("surveys.statementBodyPlaceholder") }}
        </div>
      </template>
      <template v-else>
        <Textarea
          v-if="selected && !disabled"
          ref="titleInput"
          class="q-card__title-input"
          :model-value="question.title"
          rows="1"
          auto-resize
          :maxlength="500"
          :aria-label="t('surveys.questionTitle')"
          @update:model-value="setTitle"
          @keydown="onTitleKeydown"
        />
        <div v-else class="q-card__title">
          {{ question.title }}
          <span v-if="question.required" class="tw:text-danger">*</span>
        </div>
      </template>

      <template v-if="
        isOptionQuestion(question) &&
        selected &&
        !disabled
      ">
        <template v-for="(option, index) in question.options" :key="option.id">
          <div class="opt-row">
            <RadioButton
              v-if="question.type === 'single' || question.type === 'image_single'"
              :name="`edit-${question.id}`"
              :value="option.id"
              :model-value="null"
              disabled
              :tabindex="-1"
            />
            <Checkbox v-else binary :model-value="false" disabled :tabindex="-1" />
            <!-- 图片选项：缩略图即上传/换图入口，旁边小钮删图（无图选项合法）。 -->
            <button
              v-if="isImageQuestion && surveyId"
              type="button"
              class="opt-thumb"
              :disabled="uploading"
              :aria-label="
                t(
                  option.imageFileId
                    ? 'surveys.optionImageReplace'
                    : 'surveys.optionImageUpload',
                  { n: index + 1 },
                )
              "
              v-tooltip.top="
                t(
                  option.imageFileId
                    ? 'surveys.optionImageReplace'
                    : 'surveys.optionImageUpload',
                  { n: index + 1 },
                )
              "
              @click.stop="pickImage(option.id)"
            >
              <img v-if="thumbSrc(option)" :src="thumbSrc(option)" alt="" />
              <ImageIcon v-else :size="16" />
              <span v-if="uploading && uploadTarget === option.id" class="opt-thumb__busy" />
            </button>
            <InputText
              :ref="(el) => optionRef(el, index)"
              class="opt-input"
              :class="{ 'opt-input--default': isDefaultOptionLabel(option.label) }"
              :model-value="option.label"
              :placeholder="t('surveys.optionNumber', { n: index + 1 })"
              maxlength="200"
              :aria-label="t('surveys.optionNumber', { n: index + 1 })"
              @update:model-value="setOptionLabel(option.id, $event)"
              @focus="onOptionFocus"
              @keydown="onOptionKeydown(index, $event)"
            />
            <Button
              v-if="isImageQuestion && option.imageFileId"
              severity="secondary"
              variant="text"
              :aria-label="t('surveys.optionImageRemove')"
              v-tooltip.top="t('surveys.optionImageRemove')"
              @click.stop="removeImage(option.id)"
            >
              <template #icon><ImageOff :size="14" /></template>
            </Button>
            <span v-if="option.exclusive" class="exclusive-chip">{{
              t("surveys.exclusive")
            }}</span>
            <Checkbox
              v-if="question.type === 'multiple' || question.type === 'image_multiple'"
              binary
              :model-value="!!option.exclusive"
              :aria-label="t('surveys.exclusive')"
              v-tooltip.top="t('surveys.exclusive')"
              @update:model-value="toggleExclusive(option.id)"
            />
            <Button
              severity="secondary"
              variant="text"
              :aria-label="t('surveys.removeOption')"
              :disabled="question.options.length <= 2"
              @click.stop="removeOptionAt(index)"
            >
              <template #icon><Trash2 :size="14" /></template>
            </Button>
          </div>
          <!-- 待落笔的空选项行：只在 UI 上占位，输入或丢弃前不进 definition。 -->
          <div v-if="pendingAfter === index" class="opt-row">
            <RadioButton
              v-if="question.type === 'single' || question.type === 'image_single'"
              :name="`edit-${question.id}`"
              :value="`pending-${index}`"
              :model-value="null"
              disabled
              :tabindex="-1"
            />
            <Checkbox v-else binary :model-value="false" disabled :tabindex="-1" />
            <InputText
              :ref="
                (el: Element | ComponentPublicInstance | null) => {
                  pendingInput =
                    (el as { $el?: HTMLInputElement } | null)?.$el ?? null;
                }
              "
              class="opt-input"
              :placeholder="t('surveys.optionNumber', { n: index + 2 })"
              maxlength="200"
              :aria-label="t('surveys.optionNumber', { n: index + 2 })"
              @update:model-value="commitPendingOption"
              @keydown="onPendingKeydown"
              @blur="pendingAfter = null"
            />
          </div>
        </template>
        <small class="opt-hint tw:text-muted">{{ t("surveys.optionEditHint") }}</small>
      </template>
      <!-- 矩阵：行编辑器三族共用；列编辑器只有单/多选矩阵有（矩阵填空无列）。 -->
      <template v-else-if="
        (question.type === 'matrix_single' ||
          question.type === 'matrix_multiple' ||
          question.type === 'matrix_text') &&
        selected &&
        !disabled
      ">
        <div class="subeditor">
          <span class="subeditor__title">{{ t("surveys.matrixRows") }}</span>
          <SurveyLabeledListEditor
            :items="question.rows"
            :min="1"
            :max="20"
            label-key="surveys.rowNumber"
            id-prefix="r"
            @change="setMatrixRows"
          />
        </div>
        <div v-if="question.type !== 'matrix_text'" class="subeditor">
          <span class="subeditor__title">{{ t("surveys.matrixColumns") }}</span>
          <SurveyLabeledListEditor
            :items="question.columns"
            :min="2"
            :max="10"
            label-key="surveys.columnNumber"
            id-prefix="c"
            @change="setMatrixColumns"
          />
        </div>
        <small class="opt-hint tw:text-muted">{{
          t(
            question.type === "matrix_single"
              ? "surveys.matrixSingleHint"
              : question.type === "matrix_multiple"
                ? "surveys.matrixMultipleHint"
                : "surveys.matrixTextHint",
          )
        }}</small>
      </template>
      <!-- 多项填空：每项一行。 -->
      <template v-else-if="question.type === 'multi_text' && selected && !disabled">
        <div class="subeditor">
          <span class="subeditor__title">{{ t("surveys.multiTextItems") }}</span>
          <SurveyLabeledListEditor
            :items="question.items"
            :min="1"
            :max="20"
            label-key="surveys.itemNumber"
            id-prefix="i"
            @change="setMultiTextItems"
          />
        </div>
        <small class="opt-hint tw:text-muted">{{ t("surveys.multiTextHint") }}</small>
      </template>
      <!-- 说明块没有控件预览：正文即全部内容，下面不再挂 ghost 占位框。 -->
      <div
        v-else-if="question.type !== 'statement'"
        class="q-card__preview"
        aria-hidden="true"
      >
        <div v-if="question.type === 'scale'" class="preview-scale">
          <label v-for="value in scaleValues" :key="value" class="preview-scale__item">
            <RadioButton :name="`pv-${question.id}`" :value="value" :model-value="null" disabled :tabindex="-1" />
            <span>{{ value }}</span>
          </label>
          <div class="preview-scale__labels tw:text-muted">
            <span>{{ question.minLabel }}</span>
            <span>{{ question.maxLabel }}</span>
          </div>
        </div>
        <template v-else-if="question.type === 'single' || question.type === 'multiple'">
          <div v-for="option in question.options" :key="option.id" class="preview-option">
            <RadioButton
              v-if="question.type === 'single'"
              :name="`pv-${question.id}`"
              :value="option.id"
              :model-value="null"
              disabled
              :tabindex="-1"
            />
            <Checkbox v-else binary :model-value="false" disabled :tabindex="-1" />
            <span :class="{ 'tw:text-muted': isDefaultOptionLabel(option.label) }">{{
              option.label
            }}</span>
            <span v-if="option.exclusive" class="exclusive-chip">{{
              t("surveys.exclusive")
            }}</span>
          </div>
        </template>
        <!-- 新题型：与作答页共用同一份控件渲染（禁用态 + 隐藏题干）。 -->
        <SurveyQuestionField
          v-else-if="NEW_TYPE_PREVIEW.has(question.type)"
          :question="question"
          :media-url-base="mediaUrlBase"
          disabled
          hide-title
          class="preview-shared"
        />
        <template v-else>
          <div class="preview-ghost" />
        </template>
      </div>
    </div>
    <footer v-if="selected && !disabled" class="q-card__more">
      <Button
        severity="secondary"
        variant="text"
        :label="t('surveys.moreSettings')"
        :aria-label="t('surveys.moreSettings')"
        @click.stop="advancedOpen = !advancedOpen"
      >
        <template #icon><ChevronDown :size="14" :class="{ 'is-flipped': advancedOpen }" /></template>
      </Button>
      <div v-if="advancedOpen" class="advanced" @click.stop>
        <label class="advanced-field">
          {{ t("surveys.showCondition") }}
          <Select
            :model-value="question.showIf?.questionId ?? null"
            :options="conditionSources"
            option-label="title"
            option-value="id"
            :placeholder="t('surveys.alwaysShow')"
            show-clear
            fluid
            :aria-label="t('surveys.showCondition')"
            @update:model-value="setShowIf"
          />
        </label>
        <label v-if="question.showIf" class="advanced-field">
          {{ t("surveys.conditionValue") }}
          <Select
            v-if="conditionOptions.length"
            :model-value="String(question.showIf.value)"
            :options="conditionOptions"
            option-label="label"
            option-value="id"
            fluid
            :aria-label="t('surveys.conditionValue')"
            @update:model-value="setConditionValue($event as string)"
          />
          <InputNumber
            v-else
            :model-value="Number(question.showIf.value)"
            fluid
            :aria-label="t('surveys.conditionValue')"
            @update:model-value="setConditionValue($event)"
          />
        </label>
        <template v-if="question.type === 'text'">
          <label class="advanced-inline">
            <Checkbox
              binary
              :model-value="!!question.multiline"
              @update:model-value="setMultiline"
            />{{ t("surveys.multiline") }}</label
          >
          <label class="advanced-field">
            {{ t("surveys.maxLength") }}
            <InputNumber
              :model-value="question.maxLength ?? null"
              :min="1"
              :max="2000"
              :use-grouping="false"
              fluid
              :aria-label="t('surveys.maxLength')"
              @update:model-value="setMaxLength"
            />
          </label>
        </template>
        <template v-else-if="question.type === 'number'">
          <label class="advanced-field">
            {{ t("surveys.minimum") }}
            <InputNumber
              :model-value="question.min ?? null"
              :use-grouping="false"
              fluid
              :aria-label="t('surveys.minimum')"
              @update:model-value="setNumberBound('min', $event)"
            />
          </label>
          <label class="advanced-field">
            {{ t("surveys.maximum") }}
            <InputNumber
              :model-value="question.max ?? null"
              :use-grouping="false"
              fluid
              :aria-label="t('surveys.maximum')"
              @update:model-value="setNumberBound('max', $event)"
            />
          </label>
        </template>
        <template v-else-if="question.type === 'scale'">
          <label class="advanced-field">
            {{ t("surveys.minimum") }}
            <InputNumber
              :model-value="question.min"
              :use-grouping="false"
              fluid
              :aria-label="t('surveys.minimum')"
              @update:model-value="setScaleBound('min', $event)"
            />
          </label>
          <label class="advanced-field">
            {{ t("surveys.maximum") }}
            <InputNumber
              :model-value="question.max"
              :use-grouping="false"
              fluid
              :aria-label="t('surveys.maximum')"
              @update:model-value="setScaleBound('max', $event)"
            />
          </label>
          <label class="advanced-field">
            {{ t("surveys.scaleMinLabel") }}
            <InputText
              :model-value="question.minLabel ?? ''"
              maxlength="200"
              fluid
              :placeholder="t('surveys.scaleMinLabelPlaceholder')"
              :aria-label="t('surveys.scaleMinLabel')"
              @update:model-value="setScaleLabel('minLabel', $event)"
            />
          </label>
          <label class="advanced-field">
            {{ t("surveys.scaleMaxLabel") }}
            <InputText
              :model-value="question.maxLabel ?? ''"
              maxlength="200"
              fluid
              :placeholder="t('surveys.scaleMaxLabelPlaceholder')"
              :aria-label="t('surveys.scaleMaxLabel')"
              @update:model-value="setScaleLabel('maxLabel', $event)"
            />
          </label>
        </template>
        <template v-else-if="question.type === 'rating'">
          <label class="advanced-field">
            {{ t("surveys.ratingMax") }}
            <InputNumber
              :model-value="question.max"
              :min="3"
              :max="10"
              :use-grouping="false"
              fluid
              :aria-label="t('surveys.ratingMax')"
              @update:model-value="setRatingMax"
            />
          </label>
        </template>
        <template v-else-if="question.type === 'nps'">
          <label class="advanced-field">
            {{ t("surveys.npsMinLabel") }}
            <InputText
              :model-value="question.minLabel ?? ''"
              maxlength="200"
              fluid
              :placeholder="t('surveys.npsMinLabelPlaceholder')"
              :aria-label="t('surveys.npsMinLabel')"
              @update:model-value="setNpsLabel('minLabel', $event)"
            />
          </label>
          <label class="advanced-field">
            {{ t("surveys.npsMaxLabel") }}
            <InputText
              :model-value="question.maxLabel ?? ''"
              maxlength="200"
              fluid
              :placeholder="t('surveys.npsMaxLabelPlaceholder')"
              :aria-label="t('surveys.npsMaxLabel')"
              @update:model-value="setNpsLabel('maxLabel', $event)"
            />
          </label>
        </template>
        <template v-else-if="question.type === 'date'">
          <label class="advanced-field">
            {{ t("surveys.dateMin") }}
            <input
              class="advanced-date"
              type="date"
              :value="question.min ?? ''"
              :aria-label="t('surveys.dateMin')"
              @change="setDateBound('min', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="advanced-field">
            {{ t("surveys.dateMax") }}
            <input
              class="advanced-date"
              type="date"
              :value="question.max ?? ''"
              :min="question.min"
              :aria-label="t('surveys.dateMax')"
              @change="setDateBound('max', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </template>
      </div>
    </footer>
    <!-- 选项图上传的共享 file input：accept 只提示文件选择器，权威白名单在服务端。 -->
    <input
      ref="fileInput"
      type="file"
      class="opt-file-input"
      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
      :aria-hidden="true"
      tabindex="-1"
      @change="onImageFileChange"
    />
  </article>
</template>
<style scoped>
.q-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-raised, var(--color-surface-base));
  cursor: pointer;
}
.q-card--selected {
  cursor: default;
  border-color: var(--color-brand-400);
  box-shadow: 0 0 0 1px var(--color-brand-400);
}
/* 校验定位脉冲（issue 列表点击 → 目标卡）：描边走 token 警示色，约 2s 衰减。 */
.q-card--flash {
  animation: q-card-flash 2s ease-out;
}
@keyframes q-card-flash {
  0%,
  40% {
    box-shadow: 0 0 0 2px var(--color-warning-500);
    border-color: var(--color-warning-500);
  }
  100% {
    box-shadow: none;
    border-color: var(--color-border-subtle);
  }
}
.q-card--dragging {
  opacity: 0.45;
}
.q-card--drop-before::before,
.q-card--drop-after::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-brand-500);
}
.q-card--drop-before::before {
  top: -6px;
}
.q-card--drop-after::after {
  bottom: -6px;
}
.q-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}
.q-card__handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: -6px;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text-quaternary, var(--color-text-tertiary));
  cursor: grab;
}
.q-card__handle:hover {
  background: var(--color-bg-soft);
  color: var(--color-text-secondary);
}
.q-card__number {
  flex: none;
  min-width: 18px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.q-card__issue {
  display: inline-flex;
  color: var(--color-warning-600);
}
.q-card__toolbar {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
}
.required-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  color: var(--color-text-secondary);
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}
.q-card__title {
  min-width: 0;
  font-weight: 500;
  overflow-wrap: anywhere;
  padding: 2px 0;
}
.q-card__title-input,
:deep(.q-card__title-input) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  padding: 2px 4px;
  font-weight: 500;
  resize: none;
  overflow: hidden;
}
:deep(.q-card__title-input:hover) {
  border-color: var(--color-border-subtle);
}
:deep(.q-card__title-input:focus) {
  border-color: var(--color-brand-400);
}
.q-card__preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.preview-option {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow-wrap: anywhere;
}
.preview-ghost {
  height: 34px;
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg-soft);
  max-width: 22rem;
}
.preview-scale {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.preview-scale__item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-scale__labels {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.opt-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 互斥标记（画布与预览同款弱色 chip，文案与作答页共用 surveys.exclusive）。 */
.exclusive-chip {
  flex: none;
  padding: 1px 7px;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-bg-soft);
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
}
.opt-input,
:deep(.opt-input) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  padding-block: 4px;
}
/* 图片选项缩略图（36px 方块）：空态显图标占位，上传中转圈。 */
.opt-thumb {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg-soft);
  color: var(--color-text-quaternary);
  cursor: pointer;
  overflow: hidden;
}
.opt-thumb:hover:not(:disabled) {
  border-color: var(--color-brand-400);
  color: var(--color-brand-600);
}
.opt-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.opt-thumb__busy {
  position: absolute;
  inset: 0;
  background: var(--color-surface-base);
  opacity: 0.7;
  animation: opt-thumb-busy 1s linear infinite;
}
@keyframes opt-thumb-busy {
  to {
    opacity: 0.3;
  }
}
.opt-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.opt-input--default:not(:focus) {
  color: var(--color-muted);
}
:deep(.opt-input:hover) {
  border-color: var(--color-border-subtle);
}
:deep(.opt-input:focus) {
  border-color: var(--color-brand-400);
}
.opt-hint {
  font-size: 11.5px;
}
.subeditor {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.subeditor__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-tertiary);
}
.q-card__statement {
  font-size: 13.5px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.q-card__statement :deep(p) {
  margin: 0 0 0.5em;
}
.q-card__statement :deep(p:last-child) {
  margin-bottom: 0;
}
.q-card__statement--empty {
  padding: 2px 0;
}
.advanced-date {
  max-width: 16rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-surface-base);
  color: var(--color-text-primary);
  font: inherit;
}
.advanced-date:focus {
  outline: none;
  border-color: var(--color-brand-400);
}
.preview-shared {
  font-size: 13px;
}
.q-card__more {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 6px;
  margin-top: 2px;
}
.advanced {
  display: grid;
  gap: 10px;
}
.advanced-field {
  display: grid;
  gap: 4px;
  min-width: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
}
.advanced-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--color-text-secondary);
}
:deep(.is-flipped) {
  transform: rotate(180deg);
}
.menu-anchor {
  position: relative;
}
@media (max-width: 767.98px) {
  .q-card {
    padding: 10px;
  }
  .q-card__toolbar {
    width: 100%;
    justify-content: flex-end;
    flex-wrap: wrap;
    order: 3;
  }
  /* 手机档题型按钮只留图标（文字进 aria-label）。 */
  .type-toggle :deep(.p-button-label) {
    display: none;
  }
  .required-toggle span {
    display: none;
  }
}
</style>
