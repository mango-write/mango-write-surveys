// 画布编辑的纯变换（issue #217）：所有编辑产出**新的** definition 对象
// （沿改动路径浅拷贝），绝不就地突变——历史栈快照与自动保存都依赖引用不可变。
// 插入/删除/移动题、页增删、跳页与换题型的「同族保留」规则唯一实现
// 在 surveys 包 core 的 ops.ts（AI 建卷/改卷与画布共用一套语义），这里委托；
// 仅画布自己的交互件（i18n 默认文案生成、换题型暂存/恢复、卡片受控替换）留在本文件。
import type {
  SurveyDefinition,
  SurveyLabeledNode,
  SurveyPage,
  SurveyQuestion,
} from "../../contracts/index.js";
import { applySurveyOps, retargetQuestionType } from "../../core/index.js";

type Translate = (key: string, params?: Record<string, unknown>) => string;

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

/** 经 ops 引擎应用单个操作：拒绝（未知 id、形状不合法）时原样返回输入。 */
function applyOne(
  definition: SurveyDefinition,
  op: Record<string, unknown>,
): SurveyDefinition {
  return applySurveyOps(definition, [op]).definition;
}

// 与 locale 的 surveys.optionNumber / rowNumber / columnNumber / itemNumber
// （zh「选项 {n}」「行 {n}」…，en「Option {n}」「Row {n}」…）及 API blankDefinition
// 的硬编码文案耦合，改默认文案需同步这里。
const DEFAULT_LABEL_RE =
  /^(?:选项|Option|行|Row|列|Column|项|Item) \d+$/; // i18n-allow

// Likert 5 列预设（矩阵单选新建默认）：静态 key 让 i18n 门禁可查。
const LIKERT_KEYS = [
  "surveys.likert.c1",
  "surveys.likert.c2",
  "surveys.likert.c3",
  "surveys.likert.c4",
  "surveys.likert.c5",
] as const;

/** 默认文案判定（选项/行/列/项）：聚焦时全选、首键替换（Google Forms 同款）。 */
export function isDefaultOptionLabel(label: string): boolean {
  return DEFAULT_LABEL_RE.test(label);
}

function numberLabel(
  t: Translate,
  key: string,
  n: number,
  idPrefix: string,
): { id: string; label: string } {
  return { id: uid(idPrefix), label: t(key, { n }) };
}

export function makeQuestion(
  type: SurveyQuestion["type"],
  t: Translate,
  id = uid("q"),
): SurveyQuestion {
  const base = { id, title: t("surveys.newQuestion"), required: false };
  const label = (key: string, n: number, idPrefix: string) =>
    numberLabel(t, key, n, idPrefix);
  switch (type) {
    case "single":
    case "multiple":
      return {
        ...base,
        type,
        options: [
          label("surveys.optionNumber", 1, "o"),
          label("surveys.optionNumber", 2, "o"),
        ],
      } as SurveyQuestion;
    case "image_single":
    case "image_multiple":
      // 图片题与纯文本选项同构：先落两个空选项，图在选项行上逐个上传。
      return {
        ...base,
        type,
        options: [
          label("surveys.optionNumber", 1, "o"),
          label("surveys.optionNumber", 2, "o"),
        ],
      } as SurveyQuestion;
    case "dropdown":
      return {
        ...base,
        type,
        options: [
          label("surveys.optionNumber", 1, "o"),
          label("surveys.optionNumber", 2, "o"),
          label("surveys.optionNumber", 3, "o"),
        ],
      } as SurveyQuestion;
    case "ranking":
      return {
        ...base,
        type,
        options: [
          label("surveys.optionNumber", 1, "o"),
          label("surveys.optionNumber", 2, "o"),
          label("surveys.optionNumber", 3, "o"),
        ],
      } as SurveyQuestion;
    case "scale":
      return { ...base, type, min: 1, max: 5 };
    case "rating":
      return { ...base, type, max: 5 };
    case "nps":
      return {
        ...base,
        type,
        minLabel: t("surveys.npsDefaultMin"),
        maxLabel: t("surveys.npsDefaultMax"),
      };
    case "date":
      return { ...base, type };
    case "time":
      return { ...base, type };
    case "number":
      return { ...base, type };
    case "matrix_single":
      return {
        ...base,
        type,
        rows: [
          label("surveys.rowNumber", 1, "r"),
          label("surveys.rowNumber", 2, "r"),
        ],
        // Likert 5 列预设：学术问卷最常见的矩阵形态。
        columns: [1, 2, 3, 4, 5].map((n) => ({
          id: uid("c"),
          label: t(LIKERT_KEYS[n - 1]!),
        })),
      } as SurveyQuestion;
    case "matrix_multiple":
      return {
        ...base,
        type,
        rows: [
          label("surveys.rowNumber", 1, "r"),
          label("surveys.rowNumber", 2, "r"),
        ],
        columns: [
          label("surveys.columnNumber", 1, "c"),
          label("surveys.columnNumber", 2, "c"),
          label("surveys.columnNumber", 3, "c"),
        ],
      } as SurveyQuestion;
    case "matrix_text":
      return {
        ...base,
        type,
        rows: [
          label("surveys.rowNumber", 1, "r"),
          label("surveys.rowNumber", 2, "r"),
        ],
      } as SurveyQuestion;
    case "multi_text":
      return {
        ...base,
        type,
        items: [
          label("surveys.itemNumber", 1, "i"),
          label("surveys.itemNumber", 2, "i"),
        ],
      } as SurveyQuestion;
    case "statement":
      // 说明块不是题目：无题干（body 即内容）、不可必答、不收集答案。
      return { ...base, type, title: "", body: "" } as SurveyQuestion;
    case "text":
      return { ...base, type, multiline: false, maxLength: 2000 };
  }
}

/** 矩阵单/多选的默认列（换题型补列用）：与 makeQuestion 新建预设同一份。 */
function defaultMatrixColumns(
  type: "matrix_single" | "matrix_multiple",
  t: Translate,
): SurveyLabeledNode[] {
  if (type === "matrix_single")
    return [1, 2, 3, 4, 5].map((n) => ({
      id: uid("c"),
      label: t(LIKERT_KEYS[n - 1]!),
    }));
  return [1, 2, 3].map((n) => numberLabel(t, "surveys.columnNumber", n, "c"));
}

/** 换题型时载荷可原样保留的分组：选项族（含图片单选/多选，选项与图引用共用）
 *  与矩阵族（行共用；矩阵填空没有列）。 */
const OPTION_GROUP = new Set([
  "single",
  "multiple",
  "dropdown",
  "ranking",
  "image_single",
  "image_multiple",
]);
const MATRIX_GROUP = new Set(["matrix_single", "matrix_multiple", "matrix_text"]);

/** 换题型保留题干/必答/showIf；同族题型载荷原样保留（规则在 ops.retargetQuestionType），
 *  其余按新题型生成默认载荷（画布语境的 i18n 默认值——AI 路径缺载荷则被 ops 拒绝）。 */
export function changeQuestionType(
  question: SurveyQuestion,
  type: SurveyQuestion["type"],
  t: Translate,
): SurveyQuestion {
  const sameFamily =
    (OPTION_GROUP.has(question.type) && OPTION_GROUP.has(type)) ||
    (MATRIX_GROUP.has(question.type) && MATRIX_GROUP.has(type));
  if (sameFamily) {
    const retargeted = retargetQuestionType(question, type);
    if (
      (type === "matrix_single" || type === "matrix_multiple") &&
      retargeted.type === "matrix_text"
    ) {
      // 矩阵填空 → 单/多选矩阵：行保留，列缺省由预设补齐（retarget 不造列）。
      return {
        ...retargeted,
        type,
        columns: defaultMatrixColumns(type, t),
      };
    }
    return retargeted;
  }
  return {
    ...makeQuestion(type, t, question.id),
    title: question.title,
    required: question.required,
    ...(question.showIf ? { showIf: question.showIf } : {}),
  };
}

/** 题型专属载荷：换题型时被换下、切回时按 id 恢复的那部分（题干/必答/showIf 不在其中）。 */
export function typePayloadOf(
  question: SurveyQuestion,
): Partial<SurveyQuestion> & { type: SurveyQuestion["type"] } {
  switch (question.type) {
    case "single":
    case "multiple":
    case "dropdown":
    case "ranking":
    case "image_single":
    case "image_multiple":
      return { type: question.type, options: question.options };
    case "scale":
      return {
        type: question.type,
        min: question.min,
        max: question.max,
        ...(question.minLabel !== undefined ? { minLabel: question.minLabel } : {}),
        ...(question.maxLabel !== undefined ? { maxLabel: question.maxLabel } : {}),
      };
    case "number":
      return {
        type: question.type,
        ...(question.min !== undefined ? { min: question.min } : {}),
        ...(question.max !== undefined ? { max: question.max } : {}),
      };
    case "text":
      return {
        type: question.type,
        ...(question.multiline !== undefined ? { multiline: question.multiline } : {}),
        ...(question.maxLength !== undefined ? { maxLength: question.maxLength } : {}),
      };
    case "rating":
      return { type: question.type, max: question.max };
    case "nps":
      return {
        type: question.type,
        ...(question.minLabel !== undefined ? { minLabel: question.minLabel } : {}),
        ...(question.maxLabel !== undefined ? { maxLabel: question.maxLabel } : {}),
      };
    case "date":
      return {
        type: question.type,
        ...(question.min !== undefined ? { min: question.min } : {}),
        ...(question.max !== undefined ? { max: question.max } : {}),
      };
    case "time":
      return { type: question.type };
    case "matrix_single":
    case "matrix_multiple":
      return {
        type: question.type,
        rows: question.rows,
        columns: question.columns,
      };
    case "matrix_text":
      return { type: question.type, rows: question.rows };
    case "multi_text":
      return { type: question.type, items: question.items };
    case "statement":
      return { type: question.type, title: question.title, body: question.body };
  }
}

/** 切回原题型：载荷取暂存快照，题干/必答/showIf 用当前值（期间可能改过）。 */
export function restoreTypePayload(
  stashed: SurveyQuestion,
  current: SurveyQuestion,
): SurveyQuestion {
  return {
    ...typePayloadOf(stashed),
    id: current.id,
    title: current.title,
    required: current.required,
    ...(current.showIf ? { showIf: current.showIf } : {}),
  } as SurveyQuestion;
}

export function pageOf(
  definition: SurveyDefinition,
  questionId: string,
): SurveyPage | undefined {
  return definition.pages.find((page) => page.questionIds.includes(questionId));
}

/** 按页序展开的全卷题目顺序（发布路径与画布渲染的同一口径）。 */
export function orderedQuestionIds(definition: SurveyDefinition): string[] {
  return definition.pages.flatMap((page) => page.questionIds);
}

function rebuildQuestions(
  definition: SurveyDefinition,
): SurveyDefinition["questions"] {
  const byId = new Map(definition.questions.map((q) => [q.id, q]));
  return orderedQuestionIds(definition).flatMap((id) => {
    const q = byId.get(id);
    return q ? [q] : [];
  });
}

export function withQuestion(
  definition: SurveyDefinition,
  id: string,
  next: SurveyQuestion,
): SurveyDefinition {
  return {
    ...definition,
    questions: definition.questions.map((q) => (q.id === id ? next : q)),
  };
}

/** 在某页 index 处插入新题（index 缺省追加页尾），并保持 questions 数组与页序一致。
 *  语义在 ops（add_question）：页不存在或题目形状不合法时原样返回。 */
export function insertQuestion(
  definition: SurveyDefinition,
  pageId: string,
  question: SurveyQuestion,
  index?: number,
): SurveyDefinition {
  return applyOne(definition, {
    op: "add_question",
    pageId,
    question: question as unknown as Record<string, unknown>,
    ...(index !== undefined ? { index } : {}),
  });
}

export function duplicateQuestion(
  definition: SurveyDefinition,
  id: string,
): { definition: SurveyDefinition; newId: string } {
  const source = definition.questions.find((q) => q.id === id);
  const page = pageOf(definition, id);
  if (!source || !page) return { definition, newId: "" };
  const newId = uid("q");
  // 选项/行/列/项 id 是题内作用域，复制时统一重新生成，避免跨题同 id 的混淆。
  const relabel = (nodes: { id: string; label: string }[], prefix: string) =>
    nodes.map((node) => ({ ...node, id: uid(prefix) }));
  let copy: SurveyQuestion = { ...source, id: newId };
  if (
    source.type === "single" ||
    source.type === "multiple" ||
    source.type === "dropdown" ||
    source.type === "ranking" ||
    source.type === "image_single" ||
    source.type === "image_multiple"
  )
    copy = { ...copy, options: relabel(source.options, "o") } as SurveyQuestion;
  if (source.type === "matrix_single" || source.type === "matrix_multiple")
    copy = {
      ...copy,
      rows: relabel(source.rows, "r"),
      columns: relabel(source.columns, "c"),
    } as SurveyQuestion;
  if (source.type === "matrix_text")
    copy = { ...copy, rows: relabel(source.rows, "r") } as SurveyQuestion;
  if (source.type === "multi_text")
    copy = { ...copy, items: relabel(source.items, "i") } as SurveyQuestion;
  const index = page.questionIds.indexOf(id);
  const next = insertQuestion(definition, page.id, copy, index + 1);
  // 加题被 ops 拒绝（如达题数上限）时如实报「没复制」。
  return next === definition ? { definition, newId: "" } : { definition: next, newId };
}

/** 删除题目并清理引用：showIf 指向它的题、跳页条件指向它的页一并移除（ops 语义）。 */
export function removeQuestionRef(
  definition: SurveyDefinition,
  id: string,
): SurveyDefinition {
  return applyOne(definition, { op: "remove_question", questionId: id });
}

/** 页内相邻移动（键盘可达性兜底；拖拽走 moveQuestionTo）。 */
export function moveQuestionWithin(
  definition: SurveyDefinition,
  id: string,
  delta: number,
): SurveyDefinition {
  const page = pageOf(definition, id);
  if (!page) return definition;
  const from = page.questionIds.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= page.questionIds.length) return definition;
  return moveQuestionTo(definition, id, page.id, to);
}

/** 跨页/页内拖拽落点（ops 的 move_question：index clamp 与同页下移校正同一套）。 */
export function moveQuestionTo(
  definition: SurveyDefinition,
  id: string,
  targetPageId: string,
  index: number,
): SurveyDefinition {
  return applyOne(definition, {
    op: "move_question",
    questionId: id,
    toPageId: targetPageId,
    index,
  });
}

export function withPages(
  definition: SurveyDefinition,
  pages: SurveyPage[],
): SurveyDefinition {
  return { ...definition, pages, questions: rebuildQuestions({ ...definition, pages }) };
}

export function makePage(t: Translate, n: number): SurveyPage {
  return { id: uid("p"), title: t("surveys.pageNumber", { n }), questionIds: [] };
}

/** 删除页：题目移入相邻页（沿用画布语义，ops 唯一实现），指向它的跳页设置一并删除。 */
export function removePage(
  definition: SurveyDefinition,
  id: string,
): SurveyDefinition {
  return applyOne(definition, { op: "remove_page", pageId: id });
}

export function insertPageAfter(
  definition: SurveyDefinition,
  afterPageId: string | null,
  t: Translate,
): SurveyDefinition {
  const page = makePage(t, definition.pages.length + 1);
  // afterPageId 不在卷内时按「追加末尾」处理（画布既有行为）。
  const anchor =
    afterPageId && definition.pages.some((candidate) => candidate.id === afterPageId)
      ? afterPageId
      : undefined;
  return applyOne(definition, {
    op: "add_page",
    title: page.title,
    pageId: page.id,
    ...(anchor ? { afterPageId: anchor } : {}),
  });
}

export function setJump(
  definition: SurveyDefinition,
  pageId: string,
  jump: SurveyPage["jump"],
): SurveyDefinition {
  return applyOne(definition, {
    op: "set_page_jump",
    pageId,
    jump: jump ?? null,
  });
}
