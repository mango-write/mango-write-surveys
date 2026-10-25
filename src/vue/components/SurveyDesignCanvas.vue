<script setup lang="ts">
// 设计画布（issue #217）：inline WYSIWYG。问卷头部（标题 + 研究说明 +
// 参与说明）、分页分节（页头就地编辑 + ⋯ 面板：跳页/加页/删页）、题目卡片、
// 卡间「+」题型菜单、卡片拖拽（原生 HTML5 DnD，上移/下移按钮兜底键盘）。
// 本组件不改 props：所有变更经纯变换（lib/definition-ops）产出新 definition
// 交给宿主（历史栈 + 自动保存）。选中态与左岛大纲双向联动；点画布空白取消选中。
// 换题型的载荷暂存（typeStash）不进 definition、不进历史，本组件内存 +
// sessionStorage（按 surveyId 隔离）：切回原题型即恢复，破坏性切换先经确认。
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import {
  AlertTriangle,
  Ellipsis,
  Plus,
  Trash2,
} from "lucide-vue-next";

import type {
  SurveyCondition,
  SurveyDefinition,
  SurveyPage,
  SurveyQuestion,
} from "../../contracts/index.js";
import { SURVEY_LIMITS, validateSurveyDefinition } from "../../core/index.js";

import SurveyMarkdownField from "./SurveyMarkdownField.vue";
import SurveyQuestionCard from "./SurveyQuestionCard.vue";
import SurveyTypeMenu from "./SurveyTypeMenu.vue";
import { useSurveyIssueCopy } from "../lib/issue-copy.js";
import {
  changeQuestionType,
  duplicateQuestion,
  insertPageAfter,
  insertQuestion,
  makeQuestion,
  moveQuestionTo,
  moveQuestionWithin,
  pageOf,
  removePage,
  removeQuestionRef,
  restoreTypePayload,
  setJump,
  withPages,
  withQuestion,
} from "../lib/definition-ops.js";

const props = defineProps<{
  modelValue: SurveyDefinition;
  disabled?: boolean;
  /** 左岛大纲当前选中的题目；变化时画布就地选中并滚动定位。 */
  activeQuestionId?: string;
  /** 换题型载荷暂存的隔离键：按问卷维度存取，跨刷新可恢复。 */
  surveyId?: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  change: [next: SurveyDefinition, label?: string];
}>();
const { t } = useI18n();
const confirm = useConfirm();
const describeIssue = useSurveyIssueCopy();

const selectedId = ref("");
const descriptionOpen = ref(!!props.modelValue.description);
const consentOpen = ref(!!props.modelValue.consent);
const pageDescOpen = ref<Record<string, boolean>>({});
const pageMenuFor = ref("");
const addMenuAt = ref<{ pageId: string; afterId: string | null } | null>(null);
const flashId = ref("");

const definition = computed(() => props.modelValue);
const questionById = computed(() =>
  new Map(definition.value.questions.map((q) => [q.id, q])),
);
const orderIndex = computed(() => {
  const index = new Map<string, number>();
  let order = 0;
  for (const page of definition.value.pages)
    for (const id of page.questionIds) index.set(id, order++);
  return index;
});

const issues = computed(() => validateSurveyDefinition(definition.value));
const issueMessages = computed(() =>
  issues.value.map((issue) => describeIssue(definition.value, issue)),
);
// 校验问题 → 题目 id（画布选中卡时，issue 列表对应项高亮；页面级问题无 id）。
const issueQuestionIds = computed(() =>
  issues.value.map((issue) => {
    const match = /^questions\.(\d+)\b/.exec(issue.path);
    return match ? (definition.value.questions[Number(match[1])]?.id ?? "") : "";
  }),
);
const questionIssue = computed(() => {
  const map = new Map<string, string>();
  issues.value.forEach((issue, i) => {
    const match = /^questions\.(\d+)\b/.exec(issue.path);
    if (!match) return;
    const q = definition.value.questions[Number(match[1])];
    if (q && !map.has(q.id)) map.set(q.id, issueMessages.value[i] ?? issue.message);
  });
  return map;
});
const pageIssue = computed(() => {
  const map = new Map<string, string>();
  issues.value.forEach((issue, i) => {
    const match = /^pages\.(\d+)\b/.exec(issue.path);
    if (!match) return;
    const page = definition.value.pages[Number(match[1])];
    if (page && !map.has(page.id))
      map.set(page.id, issueMessages.value[i] ?? issue.message);
  });
  return map;
});

// 外部（左岛大纲）选中 → 画布选中 + 卡片滚动定位；题目不存在时忽略（删除竞态）。
watch(
  () => props.activeQuestionId,
  (id) => {
    if (!id || id === selectedId.value) return;
    if (!questionById.value.has(id)) return;
    selectedId.value = id;
    scrollToQuestion(id);
  },
);

function scrollToQuestion(id: string) {
  if (typeof document === "undefined") return;
  document
    .querySelector(`[data-canvas-question="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
function selectQuestion(id: string) {
  selectedId.value = id;
  emit("select", id);
}

// 点画布空白（页空白、卡片之外）取消选中；交互元素与卡片内一律不抢。
function onCanvasClick(event: MouseEvent) {
  if (props.disabled || !selectedId.value) return;
  const target = event.target as HTMLElement | null;
  // 浏览器可能重放路径快照里的旧 click，其 target 已随重渲染 detached——
  // 那不是「点空白」，按 detached target 判空会刚选中的卡又被清掉。
  if (!target || !target.isConnected) return;
  if (
    target.closest(
      "[data-canvas-question],input,textarea,button,[contenteditable],.survey-type-menu,.page-menu,.type-menu-scrim",
    )
  )
    return;
  selectedId.value = "";
  emit("select", "");
}

// showIf 可引用的前题：整卷顺序在本书之前，且题型在条件源允许表内、匹配值
// 有编辑控件（矩阵/排序/多项填空/说明块不能作条件源，文本/日期/时间的匹配值
// 没有好的编辑控件也不进候选；validate 侧的允许表更宽，见 surveys 包 core）。
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
function conditionSourcesFor(id: string): SurveyQuestion[] {
  const boundary = orderIndex.value.get(id) ?? 0;
  return definition.value.questions.filter((q) => {
    const order = orderIndex.value.get(q.id);
    return (
      order !== undefined &&
      order < boundary &&
      (CONDITION_SOURCE_TYPES as Set<string>).has(q.type)
    );
  });
}

// 页引用缺失题（外部写坏的草稿）只跳过不崩：形状校验不含引用完整性。
function pageQuestions(page: SurveyPage): SurveyQuestion[] {
  return page.questionIds.flatMap((id) => {
    const q = questionById.value.get(id);
    return q ? [q] : [];
  });
}

function commit(next: SurveyDefinition, label?: string) {
  emit("change", next, label);
}

// ── 问卷头部 ────────────────────────────────────────────────────────────
function setTitle(value: string) {
  commit({ ...definition.value, title: value.slice(0, SURVEY_LIMITS.maxTitleLength) }, "title");
}
function onTitleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") event.preventDefault();
}
function setDescription(value: string) {
  commit(
    { ...definition.value, description: value.slice(0, SURVEY_LIMITS.maxDescriptionLength) },
    "description",
  );
}
function setConsent(value: string) {
  commit(
    { ...definition.value, consent: value.slice(0, SURVEY_LIMITS.maxConsentLength) },
    "consent",
  );
}

// ── 页 ─────────────────────────────────────────────────────────────────
function pageTitlePlaceholder(index: number) {
  return t("surveys.pageNumber", { n: index + 1 });
}

// 页「⋯」菜单同样不许悬挂：打开期间监听 Esc 与锚点外 pointerdown（菜单内含
// Select 下拉，滚动是其正常交互，不做滚动关闭）。PrimeVue 浮层（确认弹窗等）
// 里的 pointerdown 不关菜单：弹窗盖在菜单上，关了弹窗应回到原菜单。
function insidePrimeOverlay(target: EventTarget | null): boolean {
  return !!(target instanceof Element && target.closest(".p-dialog-mask,.p-overlay-mask"));
}
function onPageMenuPointerDown(event: PointerEvent) {
  if (insidePrimeOverlay(event.target)) return;
  const anchor = document.querySelector(
    `[data-page-menu-anchor="${CSS.escape(pageMenuFor.value)}"]`,
  );
  if (anchor && !anchor.contains(event.target as Node)) pageMenuFor.value = "";
}
function onPageMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") pageMenuFor.value = "";
}
function listenPageMenuDismiss(listen: boolean) {
  if (typeof document === "undefined") return;
  if (listen) {
    document.addEventListener("pointerdown", onPageMenuPointerDown, true);
    document.addEventListener("keydown", onPageMenuKeydown, true);
  } else {
    document.removeEventListener("pointerdown", onPageMenuPointerDown, true);
    document.removeEventListener("keydown", onPageMenuKeydown, true);
  }
}
watch(pageMenuFor, (id) => listenPageMenuDismiss(!!id));
onBeforeUnmount(() => listenPageMenuDismiss(false));

function setPageTitle(pageId: string, value: string | undefined) {
  const index = definition.value.pages.findIndex((p) => p.id === pageId);
  const fallback = pageTitlePlaceholder(index);
  const title = (value ?? "").slice(0, SURVEY_LIMITS.maxPageTitleLength) || fallback;
  commit(
    withPages(
      definition.value,
      definition.value.pages.map((p) => (p.id === pageId ? { ...p, title } : p)),
    ),
    `page:${pageId}:title`,
  );
}
function setPageDescription(pageId: string, value: string) {
  commit(
    withPages(definition.value, definition.value.pages.map((p) =>
      p.id === pageId ? { ...p, description: value.slice(0, SURVEY_LIMITS.maxPageDescriptionLength) } : p,
    )),
    `page:${pageId}:desc`,
  );
}
function openPageDescription(pageId: string) {
  pageDescOpen.value = { ...pageDescOpen.value, [pageId]: true };
}
function openPageMenu(pageId: string) {
  addMenuAt.value = null;
  pageMenuFor.value = pageMenuFor.value === pageId ? "" : pageId;
}
function addPageAfter(pageId: string | null) {
  if (definition.value.pages.length >= SURVEY_LIMITS.maxPages) return;
  commit(insertPageAfter(definition.value, pageId, t));
}
function onRemovePage(pageId: string) {
  if (definition.value.pages.length <= 1) return;
  confirm.require({
    header: t("surveys.deletePage"),
    message: t("surveys.deletePageConfirm"),
    accept: () => {
      commit(removePage(definition.value, pageId));
      pageMenuFor.value = "";
    },
  });
}

// 跳页沿用 M1 语义：条件题取本页 single/scale 题，目标只能向后。
function jumpSourceCandidates(pageId: string) {
  const page = definition.value.pages.find((p) => p.id === pageId);
  if (!page) return [];
  return page.questionIds.flatMap((id) => {
    const q = questionById.value.get(id);
    return q && (q.type === "single" || q.type === "scale") ? [q] : [];
  });
}
function enableJump(pageId: string, enabled: boolean) {
  const index = definition.value.pages.findIndex((p) => p.id === pageId);
  const page = definition.value.pages[index];
  if (!page) return;
  if (!enabled) {
    if (!page.jump) return;
    commit(setJump(definition.value, pageId, undefined));
    return;
  }
  const source = jumpSourceCandidates(pageId)[0];
  const target = definition.value.pages[index + 1];
  if (!source || !target) return;
  commit(
    setJump(definition.value, pageId, {
      when: {
        questionId: source.id,
        op: "eq",
        value: source.type === "single" ? source.options[0]!.id : source.min,
      },
      targetPageId: target.id,
    }),
  );
}
function setJumpSource(pageId: string, questionId: string) {
  const page = definition.value.pages.find((p) => p.id === pageId);
  if (!page?.jump) return;
  const q = questionById.value.get(questionId);
  if (!q) return;
  const when: SurveyCondition = {
    questionId,
    op: q.type === "multiple" ? "contains" : "eq",
    value:
      q.type === "single" || q.type === "multiple"
        ? (q.options[0]?.id ?? "")
        : q.type === "scale"
          ? q.min
          : 0,
  };
  commit(setJump(definition.value, pageId, { ...page.jump, when }));
}
function setJumpTarget(pageId: string, targetPageId: string) {
  const page = definition.value.pages.find((p) => p.id === pageId);
  if (!page?.jump) return;
  commit(setJump(definition.value, pageId, { ...page.jump, targetPageId }));
}
function setJumpValue(pageId: string, value: string | number | null) {
  const page = definition.value.pages.find((p) => p.id === pageId);
  if (!page?.jump || value === null) return;
  commit(setJump(definition.value, pageId, {
    ...page.jump,
    when: { ...page.jump.when, value },
  }));
}
function jumpOptionsFor(condition: SurveyCondition) {
  const q = questionById.value.get(condition.questionId);
  return q?.type === "single" || q?.type === "multiple" ? q.options : [];
}

// ── 题目 ───────────────────────────────────────────────────────────────
function onQuestionChange(next: SurveyQuestion, label?: string) {
  commit(withQuestion(definition.value, next.id, next), label);
}
function onCopyQuestion(id: string) {
  if (definition.value.questions.length >= SURVEY_LIMITS.maxQuestions) return;
  const { definition: next, newId } = duplicateQuestion(definition.value, id);
  if (!newId) return;
  commit(next);
  selectQuestion(newId);
}
function onRemoveQuestion(id: string) {
  confirm.require({
    header: t("surveys.deleteQuestion"),
    message: t("surveys.deleteQuestionConfirm"),
    accept: () => {
      typeStash.value.delete(id);
      persistTypeStash();
      commit(removeQuestionRef(definition.value, id));
      if (selectedId.value === id) {
        selectedId.value = "";
        emit("select", "");
      }
    },
  });
}
function onMoveQuestion(id: string, delta: number) {
  commit(moveQuestionWithin(definition.value, id, delta));
}

// ── 换题型：载荷暂存（可逆）+ 破坏性确认 ─────────────────────────────────
// 暂存不进 definition / 历史栈 / 自动保存；内存 Map 服务当前会话，sessionStorage
// 副本让「切走 → 刷新 → 切回」在本标签页内仍可恢复（容量小、关标签页即清）。
const typeStash = ref(new Map<string, SurveyQuestion>());
const stashStorageKey = computed(() =>
  props.surveyId ? `mango.survey.type-stash.${props.surveyId}` : "",
);

function loadTypeStash() {
  typeStash.value = new Map();
  const key = stashStorageKey.value;
  if (!key || typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    for (const [id, question] of JSON.parse(raw) as Array<[string, SurveyQuestion]>)
      typeStash.value.set(id, question);
  } catch {
    // 坏档按无暂存处理，不阻塞编辑。
  }
}
function persistTypeStash() {
  const key = stashStorageKey.value;
  if (!key || typeof sessionStorage === "undefined") return;
  try {
    if (typeStash.value.size === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify([...typeStash.value]));
  } catch {
    // 配额满等写入失败按无暂存处理，不反噬编辑。
  }
}
watch(stashStorageKey, loadTypeStash, { immediate: true });

// 换题型载荷可原样保留的分组（与 definition-ops 的 changeQuestionType 同表）。
const OPTION_GROUP = new Set([
  "single",
  "multiple",
  "dropdown",
  "ranking",
  "image_single",
  "image_multiple",
]);
const MATRIX_GROUP = new Set(["matrix_single", "matrix_multiple", "matrix_text"]);

// 静默（无确认）的换题型：载荷不丢。矩阵族里唯一的例外是切向矩阵填空——
// 列会从生效载荷里拿掉（行保留），走确认 + 暂存；反向不丢载荷，保持静默。
function isSilentSwitch(current: string, type: string): boolean {
  if ((OPTION_GROUP as Set<string>).has(current) && (OPTION_GROUP as Set<string>).has(type))
    return true;
  return (
    (MATRIX_GROUP as Set<string>).has(current) &&
    (MATRIX_GROUP as Set<string>).has(type) &&
    type !== "matrix_text"
  );
}

function onChangeType(id: string, type: SurveyQuestion["type"]) {
  const current = questionById.value.get(id);
  if (!current || current.type === type) return;
  // 切回原题型：恢复暂存载荷（优先于同族静默——矩阵填空切回单/多选时恢复的
  // 是原行列而不是默认预设）；当前载荷同样暂存，来回切换都无损。
  const stashed = typeStash.value.get(id);
  if (stashed?.type === type) {
    typeStash.value.set(id, current);
    persistTypeStash();
    commit(
      withQuestion(definition.value, id, restoreTypePayload(stashed, current)),
      `q:${id}:type`,
    );
    return;
  }
  // 同族无损切换：载荷原样保留，无破坏性，不确认。
  if (isSilentSwitch(current.type, type)) {
    commit(
      withQuestion(definition.value, id, changeQuestionType(current, type, t)),
      `q:${id}:type`,
    );
    return;
  }
  confirm.require({
    header: t("surveys.changeType"),
    message: changeTypeConfirmMessage(current, type),
    accept: () => {
      typeStash.value.set(id, current);
      persistTypeStash();
      commit(
        withQuestion(definition.value, id, changeQuestionType(current, type, t)),
        `q:${id}:type`,
      );
    },
  });
}
function changeTypeConfirmMessage(
  current: SurveyQuestion,
  type: SurveyQuestion["type"],
): string {
  const from = t(`surveys.type.${current.type}`);
  const to = t(`surveys.type.${type}`);
  if ("options" in current)
    return t("surveys.changeTypeConfirmOptions", {
      n: current.options.length,
      type: to,
      from,
    });
  if (current.type === "scale")
    return t("surveys.changeTypeConfirmScale", { type: to, from });
  if (current.type === "number")
    return t("surveys.changeTypeConfirmNumber", { type: to, from });
  if (current.type === "text")
    return t("surveys.changeTypeConfirmText", { type: to, from });
  // 其余题型：确认文案概括要丢弃的载荷。
  const detail =
    type === "matrix_text" &&
    (current.type === "matrix_single" || current.type === "matrix_multiple")
      ? t("surveys.changeTypeDropColumns", { c: current.columns.length })
      : current.type === "matrix_single" || current.type === "matrix_multiple"
        ? t("surveys.changeTypeDropRowsCols", {
            r: current.rows.length,
            c: current.columns.length,
          })
        : current.type === "matrix_text"
          ? t("surveys.changeTypeDropRows", { n: current.rows.length })
          : current.type === "multi_text"
            ? t("surveys.changeTypeDropItems", { n: current.items.length })
            : current.type === "rating"
              ? t("surveys.changeTypeDropRating")
              : current.type === "nps"
                ? t("surveys.changeTypeDropNps")
                : current.type === "date"
                  ? t("surveys.changeTypeDropDate")
                  : t("surveys.changeTypeDropBody");
  return t("surveys.changeTypeConfirmPayload", { type: to, from, detail });
}

// ── 加题（题型菜单 + 定位插入）─────────────────────────────────────────
function toggleAddMenu(pageId: string, afterId: string | null) {
  addMenuAt.value =
    addMenuAt.value?.pageId === pageId && addMenuAt.value.afterId === afterId
      ? null
      : { pageId, afterId };
  pageMenuFor.value = "";
}
function insertAt(pageId: string, afterId: string | null, type: SurveyQuestion["type"]) {
  if (definition.value.questions.length >= SURVEY_LIMITS.maxQuestions) return;
  const page = definition.value.pages.find((p) => p.id === pageId);
  if (!page) return;
  const question = makeQuestion(type, t);
  const index = afterId ? page.questionIds.indexOf(afterId) + 1 : page.questionIds.length;
  addMenuAt.value = null;
  commit(insertQuestion(definition.value, pageId, question, index));
  selectQuestion(question.id);
  scrollToQuestion(question.id);
  // 「插在这里」的反馈：新卡滚动入视口后复用校验定位的描边脉冲。
  flash(question.id);
}

// ── 拖拽（卡片内 dragover 定插入线；页空白处 = 追加页尾）────────────────
type DropTarget =
  | { kind: "card"; id: string; side: "before" | "after" }
  | { kind: "gap"; pageId: string; afterId: string }
  | { kind: "page-end"; pageId: string };

const draggingId = ref("");
const dropTarget = ref<DropTarget | null>(null);

function onCardDragStart(id: string) {
  draggingId.value = id;
}
function onDragEnd() {
  draggingId.value = "";
  dropTarget.value = null;
}
function onCardDropOn(id: string, side: "before" | "after") {
  if (!draggingId.value) return;
  const current = dropTarget.value;
  if (current?.kind === "card" && current.id === id && current.side === side) return;
  dropTarget.value = { kind: "card", id, side };
}
function onGapDragOver(pageId: string, afterId: string, event: DragEvent) {
  if (!draggingId.value) return;
  event.preventDefault();
  event.stopPropagation();
  dropTarget.value = { kind: "gap", pageId, afterId };
}
function onPageDragOver(pageId: string, event: DragEvent) {
  if (!draggingId.value) return;
  event.preventDefault();
  dropTarget.value = { kind: "page-end", pageId };
}
function dropSideOf(id: string): "before" | "after" | null {
  const target = dropTarget.value;
  return target?.kind === "card" && target.id === id ? target.side : null;
}
function onRootDrop(event: DragEvent) {
  event.preventDefault();
  const id = draggingId.value;
  const target = dropTarget.value;
  onDragEnd();
  if (!id || !target || !questionById.value.has(id)) return;
  if (target.kind === "card") {
    if (target.id === id) return;
    const page = pageOf(definition.value, target.id);
    if (!page) return;
    const index = page.questionIds.indexOf(target.id) + (target.side === "after" ? 1 : 0);
    commit(moveQuestionTo(definition.value, id, page.id, index));
    return;
  }
  const page = definition.value.pages.find((p) => p.id === target.pageId);
  if (!page) return;
  const index =
    target.kind === "gap"
      ? page.questionIds.indexOf(target.afterId) + 1
      : page.questionIds.length;
  commit(moveQuestionTo(definition.value, id, page.id, index));
}

// ── 校验定位 ───────────────────────────────────────────────────────────
function locateIssue(index: number) {
  const issue = issues.value[index];
  if (!issue) return;
  const question = /^questions\.(\d+)\b/.exec(issue.path);
  if (question) {
    const q = definition.value.questions[Number(question[1])];
    if (q) {
      selectQuestion(q.id);
      scrollToQuestion(q.id);
      flash(q.id);
      return;
    }
  }
  const page = /^pages\.(\d+)\b/.exec(issue.path);
  if (page) {
    const p = definition.value.pages[Number(page[1])];
    if (p) {
      if (typeof document !== "undefined")
        document
          .querySelector(`[data-canvas-page="${CSS.escape(p.id)}"]`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      flash(p.id);
    }
  }
}
let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flash(id: string) {
  flashId.value = id;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flashId.value = ""), 2000);
}

// 宿主（发布被校验拦下时）滚动定位到第一条问题。
defineExpose({ locateIssue });
</script>
<template>
  <div
    class="survey-canvas"
    :class="{ 'is-disabled': disabled }"
    @click="onCanvasClick"
    @drop="onRootDrop"
    @dragover.prevent
  >
    <header class="canvas-head">
      <Textarea
        class="canvas-title"
        fluid
        :model-value="definition.title"
        rows="1"
        auto-resize
        :maxlength="200"
        :placeholder="t('surveys.untitledSurvey')"
        :disabled="disabled"
        :aria-label="t('surveys.title')"
        @update:model-value="setTitle"
        @keydown="onTitleKeydown"
      />
      <div v-if="descriptionOpen || definition.description" class="head-field">
        <span class="head-field__label">{{ t("surveys.description") }}</span>
        <SurveyMarkdownField
          :model-value="definition.description"
          :disabled="disabled"
          :aria-label="t('surveys.description')"
          :placeholder="t('surveys.descriptionPlaceholder')"
          @change="setDescription"
        />
      </div>
      <Button
        v-else
        severity="secondary"
        variant="text"
        :label="t('surveys.addDescription')"
        :disabled="disabled"
        :aria-label="t('surveys.addDescription')"
        @click="descriptionOpen = true"
      >
        <template #icon><Plus :size="15" /></template>
      </Button>
      <div v-if="consentOpen || definition.consent" class="head-field">
        <span class="head-field__label">{{ t("surveys.researchNotice") }}</span>
        <SurveyMarkdownField
          :model-value="definition.consent"
          :disabled="disabled"
          :aria-label="t('surveys.researchNotice')"
          :placeholder="t('surveys.consentPlaceholder')"
          @change="setConsent"
        />
      </div>
      <Button
        v-else
        severity="secondary"
        variant="text"
        :label="t('surveys.addConsent')"
        :disabled="disabled"
        :aria-label="t('surveys.addConsent')"
        @click="consentOpen = true"
      >
        <template #icon><Plus :size="15" /></template>
      </Button>
    </header>

    <section
      v-for="(page, pageIndex) in definition.pages"
      :key="page.id"
      class="canvas-page"
      :class="{ 'is-flash': flashId === page.id }"
      :data-canvas-page="page.id"
      @dragover="onPageDragOver(page.id, $event)"
      @drop="onRootDrop"
    >
      <header class="page-head">
        <span class="page-index">{{ t("surveys.pageNumber", { n: pageIndex + 1 }) }}</span>
        <InputText
          class="page-title"
          fluid
          :model-value="page.title"
          :placeholder="pageTitlePlaceholder(pageIndex)"
          :disabled="disabled"
          maxlength="200"
          :aria-label="t('surveys.pageTitle')"
          @update:model-value="setPageTitle(page.id, $event)"
        />
        <span
          v-if="pageIssue.get(page.id)"
          class="page-issue"
          v-tooltip.top="pageIssue.get(page.id)"
        >
          <AlertTriangle :size="14" />
        </span>
        <div class="menu-anchor" :data-page-menu-anchor="page.id">
          <Button
            severity="secondary"
            variant="text"
            :aria-label="t('surveys.pageActions')"
            :disabled="disabled"
            v-tooltip.top="t('surveys.pageActions')"
            @click="openPageMenu(page.id)"
          >
            <template #icon><Ellipsis :size="16" /></template>
          </Button>
          <div v-if="pageMenuFor === page.id" class="page-menu" @keydown.esc="pageMenuFor = ''">
            <label v-if="pageIndex < definition.pages.length - 1" class="jump-toggle"
              ><Checkbox
                binary
                :model-value="!!page.jump"
                :disabled="disabled || !jumpSourceCandidates(page.id).length"
                @update:model-value="enableJump(page.id, $event)"
              />{{ t("surveys.jump") }}</label
            >
            <div v-if="page.jump" class="jump-config">
              <Select
                :model-value="page.jump.when.questionId"
                :options="jumpSourceCandidates(page.id)"
                option-label="title"
                option-value="id"
                :aria-label="t('surveys.conditionQuestion')"
                :disabled="disabled"
                fluid
                @update:model-value="setJumpSource(page.id, $event)"
              />
              <Select
                v-if="jumpOptionsFor(page.jump.when).length"
                :model-value="String(page.jump.when.value)"
                :options="jumpOptionsFor(page.jump.when)"
                option-label="label"
                option-value="id"
                :aria-label="t('surveys.conditionValue')"
                :disabled="disabled"
                fluid
                @update:model-value="setJumpValue(page.id, $event)"
              />
              <InputNumber
                v-else
                :model-value="Number(page.jump.when.value)"
                :aria-label="t('surveys.conditionValue')"
                :disabled="disabled"
                fluid
                @update:model-value="setJumpValue(page.id, $event)"
              />
              <Select
                :model-value="page.jump.targetPageId"
                :options="
                  definition.pages
                    .slice(pageIndex + 1)
                    .map((p, i) => ({ value: p.id, label: t('surveys.pageNumber', { n: pageIndex + i + 2 }) }))
                "
                option-label="label"
                option-value="value"
                :aria-label="t('surveys.jumpTarget')"
                :disabled="disabled"
                fluid
                @update:model-value="setJumpTarget(page.id, $event)"
              />
            </div>
            <div class="page-menu__divider" role="separator" />
            <button
              type="button"
              class="page-menu__item"
              :disabled="disabled || definition.pages.length >= 20"
              @click="
                addPageAfter(page.id);
                pageMenuFor = '';
              "
            >
              <Plus :size="15" />{{ t("surveys.addPageAfter") }}
            </button>
            <button
              type="button"
              class="page-menu__item page-menu__item--danger"
              :disabled="disabled || definition.pages.length <= 1"
              @click="onRemovePage(page.id)"
            >
              <Trash2 :size="15" />{{ t("surveys.deletePage") }}
            </button>
          </div>
        </div>
      </header>
      <div v-if="pageDescOpen[page.id] || page.description" class="page-desc">
        <SurveyMarkdownField
          :model-value="page.description ?? ''"
          :disabled="disabled"
          :aria-label="t('surveys.pageDescription')"
          :placeholder="t('surveys.pageDescriptionPlaceholder')"
          @change="setPageDescription(page.id, $event)"
        />
      </div>
      <Button
        v-else-if="!disabled"
        severity="secondary"
        variant="text"
        :label="t('surveys.addPageDescription')"
        :aria-label="t('surveys.addPageDescription')"
        class="page-desc-add"
        @click="openPageDescription(page.id)"
      >
        <template #icon><Plus :size="14" /></template>
      </Button>

      <div class="page-questions">
        <template v-for="q in pageQuestions(page)" :key="q.id">
          <SurveyQuestionCard
            :question="q"
            :number="(orderIndex.get(q.id) ?? 0) + 1"
            :selected="selectedId === q.id"
            :disabled="disabled"
            :condition-sources="conditionSourcesFor(q.id)"
            :issue-message="questionIssue.get(q.id) ?? ''"
            :flashing="flashId === q.id"
            :dragging="draggingId === q.id"
            :drop-side="dropSideOf(q.id)"
            :survey-id="surveyId"
            @select="selectQuestion"
            @change="onQuestionChange"
            @change-type="(type) => onChangeType(q.id, type)"
            @copy="onCopyQuestion"
            @remove="onRemoveQuestion"
            @move="(delta) => onMoveQuestion(q.id, delta)"
            @drop-on="onCardDropOn"
            @drag-start="onCardDragStart"
            @drag-end="onDragEnd"
          />
          <slot name="question-review" :question-id="q.id" />
          <div
            v-if="!disabled"
            class="add-zone"
            :class="{ 'add-zone--active': draggingId }"
            @dragover="onGapDragOver(page.id, q.id, $event)"
            @drop="onRootDrop"
          >
            <span class="add-zone__line" aria-hidden="true" />
            <div class="menu-anchor">
              <button
                type="button"
                class="add-zone__btn"
                :aria-label="t('surveys.addQuestion')"
                v-tooltip.top="t('surveys.addQuestion')"
                @click="toggleAddMenu(page.id, q.id)"
              >
                <Plus :size="15" />
              </button>
              <SurveyTypeMenu
                :open="addMenuAt?.pageId === page.id && addMenuAt?.afterId === q.id"
                @select="(type) => insertAt(page.id, q.id, type)"
                @close="addMenuAt = null"
              />
            </div>
            <span class="add-zone__line" aria-hidden="true" />
          </div>
        </template>
        <div
          v-if="!disabled"
          class="add-zone"
          :class="{ 'add-zone--active': draggingId }"
          @dragover="onPageDragOver(page.id, $event)"
          @drop="onRootDrop"
        >
          <span class="add-zone__line" aria-hidden="true" />
          <div class="menu-anchor">
            <button
              type="button"
              class="add-zone__btn"
              :aria-label="t('surveys.addQuestion')"
              @click="toggleAddMenu(page.id, null)"
            >
              <Plus :size="15" />
            </button>
            <SurveyTypeMenu
              :open="addMenuAt?.pageId === page.id && addMenuAt?.afterId === null"
              @select="(type) => insertAt(page.id, null, type)"
              @close="addMenuAt = null"
            />
          </div>
          <span class="add-zone__line" aria-hidden="true" />
        </div>
      </div>
    </section>

    <Button
      v-if="!disabled"
      class="add-page-btn"
      severity="secondary"
      variant="text"
      :label="t('surveys.addPage')"
      :aria-label="t('surveys.addPage')"
      :disabled="definition.pages.length >= 20"
      @click="addPageAfter(null)"
    >
      <template #icon><Plus :size="16" /></template>
    </Button>

    <Message v-if="issues.length" severity="warn" :closable="false" class="issue-list">
      <div class="issue-list__head">{{ t("surveys.definitionInvalid", { n: issues.length }) }}</div>
      <ul>
        <li v-for="(message, index) in issueMessages.slice(0, 8)" :key="issues[index]!.path + issues[index]!.code">
          <button
            type="button"
            class="issue-item"
            :class="{ 'issue-item--active': issueQuestionIds[index] && issueQuestionIds[index] === selectedId }"
            @click="locateIssue(index)"
          >
            {{ message }}
          </button>
        </li>
      </ul>
    </Message>
  </div>
</template>
<style scoped>
.survey-canvas {
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: var(--layout-card-padding-lg);
  width: 100%;
  max-width: 46rem;
  margin-inline: auto;
  padding-bottom: 4rem;
}
.canvas-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-block: 4px 12px;
}
.canvas-title,
:deep(.canvas-title) {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 2px 4px;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
  resize: none;
  overflow: hidden;
}
:deep(.canvas-title:hover) {
  border-bottom: 1px solid var(--color-border-subtle);
}
:deep(.canvas-title:focus) {
  border-bottom: 1px solid var(--color-brand-400);
}
.head-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 4px;
}
.head-field__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-tertiary);
}
.canvas-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg, 14px);
  background: var(--color-surface-base);
}
.canvas-page.is-flash {
  animation: canvas-flash 2s ease-out;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-index {
  flex: none;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  white-space: nowrap;
}
.page-title,
:deep(.page-title) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  padding-block: 3px;
  font-weight: 600;
  min-width: 0;
}
:deep(.page-title:hover) {
  border-color: var(--color-border-subtle);
}
:deep(.page-title:focus) {
  border-color: var(--color-brand-400);
}
.page-issue {
  display: inline-flex;
  flex: none;
  color: var(--color-warning-600);
}
.menu-anchor {
  position: relative;
}
.page-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(300px, 78vw);
  padding: 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 10px);
  background: var(--color-surface-overlay, var(--color-surface-base));
  box-shadow: var(--shadow-md);
}
.jump-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--color-text-secondary);
}
.jump-config {
  display: grid;
  gap: 6px;
  padding-left: 22px;
}
.page-menu__divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin-block: 2px;
}
.page-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  text-align: start;
  cursor: pointer;
}
.page-menu__item:hover:not(:disabled) {
  background: var(--color-bg-soft);
  color: var(--color-text-primary);
}
.page-menu__item--danger {
  color: var(--color-danger-700);
}
.page-menu__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.page-desc {
  padding: 0 2px;
}
.page-desc-add {
  justify-content: flex-start;
}
.page-questions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.add-zone {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}
.add-zone__line {
  flex: 1;
  height: 1px;
  background: transparent;
}
.add-zone:hover .add-zone__line,
.add-zone--active .add-zone__line {
  background: var(--color-border-strong);
}
.add-zone__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill, 999px);
  background: var(--color-surface-base);
  color: var(--color-text-tertiary);
  cursor: pointer;
}
/* 触屏/窄屏把「+」的点击热区抬到 ≥44px（视觉尺寸不变，桌面不受影响）；
   -11px 让 24px 按钮的命中带宽出 2px 余量，边界取整不吃掉达标线。 */
@media (max-width: 767.98px), (pointer: coarse) {
  .add-zone {
    min-height: 44px;
  }
  .add-zone__btn::after {
    content: "";
    position: absolute;
    inset: -11px;
    border-radius: var(--radius-pill, 999px);
  }
}
.add-zone__btn:hover {
  border-color: var(--color-brand-400);
  color: var(--color-brand-600);
  background: var(--color-brand-50);
}
.add-page-btn {
  align-self: center;
}
.issue-list ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 2px;
}
.issue-item {
  border: 0;
  background: transparent;
  padding: 2px 4px;
  border-radius: var(--radius-sm, 6px);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.issue-item:hover {
  background: var(--material-hover);
  text-decoration: underline;
}
/* 画布选中卡 ↔ issue 列表的双向呼应。 */
.issue-item--active {
  background: var(--color-warning-surface);
  text-decoration: underline;
}
@keyframes canvas-flash {
  0%,
  40% {
    box-shadow: 0 0 0 2px var(--color-warning-500);
  }
  100% {
    box-shadow: none;
  }
}
@media (max-width: 767.98px) {
  .canvas-page {
    padding: 10px;
  }
  .page-menu {
    position: fixed;
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    border-radius: var(--radius-lg, 14px) var(--radius-lg, 14px) 0 0;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
  }
}
</style>
