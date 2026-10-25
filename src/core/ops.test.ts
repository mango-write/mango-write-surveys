import { describe, expect, it } from "vitest";

import type { SurveyDefinition } from "./definition.js";
import { applySurveyOps, retargetQuestionType } from "./ops.js";
import { makeDefinition } from "./test-fixtures.js";

// 确定性 id 生成：qx1/qx2… px1/px2… ox1…（带 x 中缀避免与夹具的 q1/p1 冲突）。
function makeGenId(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}x${next}`;
  };
}

const apply = (definition: SurveyDefinition, ops: unknown[]) =>
  applySurveyOps(definition, ops, { genId: makeGenId() });

const questionIds = (definition: SurveyDefinition) =>
  definition.pages.flatMap((page) => page.questionIds);

describe("applySurveyOps — set_meta / replace_all", () => {
  it("set_meta 改标题/说明/consent，未给字段不动", () => {
    const result = apply(makeDefinition(), [
      { op: "set_meta", title: "新标题", consent: "同意条款" },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.definition.title).toBe("新标题");
    expect(result.definition.consent).toBe("同意条款");
    expect(result.definition.description).toBe("");
  });

  it("set_meta 空标题被拒", () => {
    const result = apply(makeDefinition(), [{ op: "set_meta", title: "" }]);
    expect(result.rejected).toHaveLength(1);
    expect(result.definition.title).toBe("测试问卷");
  });

  it("replace_all 整卷替换（从零生成）", () => {
    const replacement: SurveyDefinition = {
      version: 1,
      title: "整卷",
      description: "",
      consent: "",
      questions: [
        { id: "n1", type: "nps", title: "推荐意愿", required: false },
      ],
      pages: [{ id: "np1", title: "页", questionIds: ["n1"] }],
    };
    const result = apply(makeDefinition(), [{ op: "replace_all", definition: replacement }]);
    expect(result.rejected).toEqual([]);
    expect(result.definition).toEqual(replacement);
  });

  it("replace_all 形状不合法被拒且原卷保持", () => {
    const result = apply(makeDefinition(), [
      { op: "replace_all", definition: { version: 1, title: "", description: "", consent: "", questions: [], pages: [] } },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.definition.title).toBe("测试问卷");
  });
});

describe("applySurveyOps — 页操作", () => {
  it("add_page 追加到末尾或指定页后；缺省 id 生成", () => {
    const appended = apply(makeDefinition(), [{ op: "add_page", title: "第四页" }]);
    expect(appended.definition.pages).toHaveLength(4);
    expect(appended.definition.pages[3]).toMatchObject({ title: "第四页", questionIds: [] });

    const inserted = apply(makeDefinition(), [
      { op: "add_page", afterPageId: "p1", title: "插页" },
    ]);
    expect(inserted.definition.pages.map((page) => page.id)).toEqual(["p1", "px1", "p2", "p3"]);
    expect(inserted.definition.pages[1]!.title).toBe("插页");
  });

  it("add_page 的 afterPageId 不存在被拒", () => {
    const result = apply(makeDefinition(), [{ op: "add_page", afterPageId: "nope", title: "x" }]);
    expect(result.rejected[0]!.reason).toContain("nope");
  });

  it("update_page 改标题、清空说明（空串语义）", () => {
    const def = makeDefinition();
    def.pages[0]!.description = "开场说明";
    const result = apply(def, [
      { op: "update_page", pageId: "p1", title: "开场", description: "" },
    ]);
    expect(result.definition.pages[0]).toMatchObject({ title: "开场" });
    expect(result.definition.pages[0]!.description).toBeUndefined();
  });

  it("remove_page 题目并入相邻页（后一页优先、追加其后）、指向它的跳页删除；最后一页拒绝", () => {
    const result = apply(makeDefinition(), [{ op: "remove_page", pageId: "p1" }]);
    expect(result.definition.pages.map((page) => page.id)).toEqual(["p2", "p3"]);
    expect(result.definition.pages[0]!.questionIds).toEqual(["q3", "q4", "q1", "q2"]);
    expect(result.definition.pages.every((page) => !page.jump)).toBe(true);
    expect(questionIds(result.definition)).toEqual(["q3", "q4", "q1", "q2", "q5"]);

    const singlePage: SurveyDefinition = {
      version: 1,
      title: "独页",
      description: "",
      consent: "",
      questions: [],
      pages: [{ id: "only", title: "唯一", questionIds: [] }],
    };
    const last = apply(singlePage, [{ op: "remove_page", pageId: "only" }]);
    expect(last.rejected[0]!.reason).toContain("最后一页");
  });

  it("set_page_jump 设置与清除；目标页不存在被拒", () => {
    const set = apply(makeDefinition(), [
      { op: "set_page_jump", pageId: "p2", jump: { when: { questionId: "q4", op: "eq", value: 42 }, targetPageId: "p3" } },
    ]);
    expect(set.definition.pages[1]!.jump).toEqual({
      when: { questionId: "q4", op: "eq", value: 42 },
      targetPageId: "p3",
    });
    // 向后跳才是合法语义：issues 报告但不阻断（p3 在 p2 之后，这里无 issue）。
    expect(set.issues).toEqual([]);

    const cleared = apply(set.definition, [{ op: "set_page_jump", pageId: "p2", jump: null }]);
    expect(cleared.definition.pages[1]!.jump).toBeUndefined();

    const missing = apply(makeDefinition(), [
      { op: "set_page_jump", pageId: "p2", jump: { when: { questionId: "q4", op: "eq", value: 1 }, targetPageId: "nope" } },
    ]);
    expect(missing.rejected[0]!.reason).toContain("nope");
  });
});

describe("applySurveyOps — 题目操作", () => {
  it("add_question：指定页与位置插入，questions 按页序重建；缺省 id 生成", () => {
    const result = apply(makeDefinition(), [
      {
        op: "add_question",
        pageId: "p2",
        index: 0,
        question: { type: "text", title: "姓名", required: true },
      },
    ]);
    expect(result.rejected).toEqual([]);
    const newId = result.applied[0]!.op === "add_question" ? String((result.applied[0] as { question: Record<string, unknown> }).question.id) : "";
    expect(newId).toBe("qx1");
    expect(result.definition.pages[1]!.questionIds[0]).toBe(newId);
    expect(questionIds(result.definition)).toEqual(["q1", "q2", newId, "q3", "q4", "q5"]);
  });

  it("add_question：载荷缺选项 id 时生成；statement 必答被拒；页不存在被拒", () => {
    const withIds = apply(makeDefinition(), [
      { op: "add_question", pageId: "p3", question: { type: "single", title: "性别", required: false, options: [{ label: "男" }, { label: "女" }] } },
    ]);
    const added = withIds.applied[0]! as unknown as { question: { options: { id: string }[] } };
    expect(added.question.options.map((option) => option.id)).toEqual(["ox1", "ox2"]);

    const statementRequired = apply(makeDefinition(), [
      { op: "add_question", pageId: "p3", question: { type: "statement", title: "", body: "说明", required: true } },
    ]);
    expect(statementRequired.rejected[0]!.reason).toContain("说明块");

    const noPage = apply(makeDefinition(), [
      { op: "add_question", pageId: "nope", question: { type: "text", title: "x", required: false } },
    ]);
    expect(noPage.rejected[0]!.reason).toContain("nope");
  });

  it("add_question：选项题零选项形状合法、语义非法——操作应用，issue 附回", () => {
    const result = apply(makeDefinition(), [
      { op: "add_question", pageId: "p3", question: { type: "single", title: "坏题", required: false, options: [] } },
    ]);
    // 零选项是形状合法、语义非法（empty_options）：操作应用，issue 附回。
    expect(result.rejected).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain("empty_options");
  });

  it("update_question：同题型 patch 合并；showIf 显式 null 清除", () => {
    const merged = apply(makeDefinition(), [
      { op: "update_question", questionId: "q1", patch: { title: "年级（改）", required: false } },
    ]);
    expect(merged.definition.questions[0]).toMatchObject({ title: "年级（改）", required: false });
    expect(merged.definition.questions[0]!.type === "single" && merged.definition.questions[0]!.options).toHaveLength(2);

    const def = makeDefinition();
    const withShowIf = apply(def, [
      { op: "update_question", questionId: "q3", patch: { showIf: { questionId: "q1", op: "eq", value: "a" } } },
    ]);
    expect(withShowIf.definition.questions[2]!.showIf).toEqual({ questionId: "q1", op: "eq", value: "a" });
    const cleared = apply(withShowIf.definition, [
      { op: "update_question", questionId: "q3", patch: { showIf: null } },
    ]);
    expect(cleared.definition.questions[2]!.showIf).toBeUndefined();
  });

  it("update_question：选项族内换题型保留 options、丢弃 minChoices/maxChoices；矩阵族保留行列", () => {
    const toSingle = apply(makeDefinition(), [
      { op: "update_question", questionId: "q2", patch: { type: "single" } },
    ]);
    const q2 = toSingle.definition.questions[1]!;
    expect(q2.type).toBe("single");
    expect(q2.type === "single" && q2.options.map((option) => option.id)).toEqual(["x", "y", "z"]);
    expect(q2).not.toHaveProperty("minChoices");

    const def = makeDefinition();
    def.questions.push({
      id: "m1",
      type: "matrix_single",
      title: "矩阵",
      required: false,
      rows: [{ id: "r1", label: "行" }],
      columns: [
        { id: "c1", label: "不同意" },
        { id: "c2", label: "同意" },
      ],
    });
    def.pages[2]!.questionIds.push("m1");
    const toMatrixMulti = apply(def, [
      { op: "update_question", questionId: "m1", patch: { type: "matrix_multiple" } },
    ]);
    const matrix = toMatrixMulti.definition.questions[5]!;
    expect(matrix.type).toBe("matrix_multiple");
    expect(matrix.type === "matrix_multiple" && matrix.rows.map((row) => row.id)).toEqual(["r1"]);
  });

  it("update_question：跨族换题型必须给新载荷，缺载荷被拒", () => {
    const withPayload = apply(makeDefinition(), [
      { op: "update_question", questionId: "q1", patch: { type: "text", multiline: true } },
    ]);
    expect(withPayload.rejected).toEqual([]);
    const q1 = withPayload.definition.questions[0]!;
    expect(q1).toMatchObject({ type: "text", multiline: true, title: "单选" });
    expect(q1).not.toHaveProperty("options");

    const noPayload = apply(makeDefinition(), [
      { op: "update_question", questionId: "q1", patch: { type: "matrix_single" } },
    ]);
    expect(noPayload.rejected).toHaveLength(1);
    // 拒绝原因带新题型的载荷缺口（rows 缺失）。
    expect(noPayload.rejected[0]!.reason).toContain("rows");
  });

  it("update_question 不存在的题目被拒", () => {
    const result = apply(makeDefinition(), [
      { op: "update_question", questionId: "ghost", patch: { title: "x" } },
    ]);
    expect(result.rejected[0]!.reason).toContain("ghost");
  });

  it("remove_question：题目、页引用、指向它的 showIf 与跳页一并清理", () => {
    const result = apply(makeDefinition(), [{ op: "remove_question", questionId: "q2" }]);
    expect(questionIds(result.definition)).toEqual(["q1", "q3", "q4", "q5"]);
    expect(result.definition.pages[0]!.jump).toBeUndefined();
    expect(result.definition.questions.map((question) => question.id)).toEqual(["q1", "q3", "q4", "q5"]);
  });

  it("move_question：跨页移动带 index、同页向下拖 index 左移校正", () => {
    const cross = apply(makeDefinition(), [
      { op: "move_question", questionId: "q1", toPageId: "p2", index: 1 },
    ]);
    expect(cross.definition.pages[0]!.questionIds).toEqual(["q2"]);
    expect(cross.definition.pages[1]!.questionIds).toEqual(["q3", "q1", "q4"]);

    const down = apply(makeDefinition(), [
      { op: "move_question", questionId: "q1", toPageId: "p1", index: 2 },
    ]);
    expect(down.definition.pages[0]!.questionIds).toEqual(["q2", "q1"]);

    const ghost = apply(makeDefinition(), [
      { op: "move_question", questionId: "ghost", toPageId: "p2", index: 0 },
    ]);
    expect(ghost.rejected).toHaveLength(1);
  });
});

describe("applySurveyOps — 批量语义", () => {
  it("单个操作失败只拒绝该操作，后续操作继续", () => {
    const result = apply(makeDefinition(), [
      { op: "update_question", questionId: "ghost", patch: { title: "x" } },
      { op: "update_question", questionId: "q3", patch: { required: false } },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.applied).toHaveLength(1);
    expect(result.definition.questions[2]!.required).toBe(false);
  });

  it("超题数上限的加题在整体形状闸被拒（应用后的 definition 恒形状合法）", () => {
    const def = makeDefinition();
    const ops = Array.from({ length: 46 }, (_, i) => ({
      op: "add_question",
      pageId: "p3",
      question: { type: "text", title: `题 ${i}`, required: false },
    }));
    const result = apply(def, ops);
    // 前 45 题到上限（50）为止；第 46 题把 questions 推过 maxQuestions，被拒。
    expect(result.rejected).toHaveLength(1);
    expect(result.definition.questions).toHaveLength(50);
  });

  it("输入未知的 op 形态被拒且保留原样", () => {
    const result = apply(makeDefinition(), [{ op: "destroy_everything" }]);
    expect(result.rejected[0]!.op).toEqual({ op: "destroy_everything" });
  });

  it("clone-on-write：未改动路径保持引用", () => {
    const def = makeDefinition();
    const result = apply(def, [
      { op: "update_question", questionId: "q3", patch: { required: false } },
    ]);
    expect(result.definition.questions[0]).toBe(def.questions[0]);
    expect(result.definition.pages).toBe(def.pages);
  });

  it("整批通过后 issues 反映最终语义状态", () => {
    const result = apply(makeDefinition(), [
      { op: "remove_question", questionId: "q5" },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain("empty_page");
  });
});

describe("retargetQuestionType", () => {
  it("选项族内换题型丢弃多选专属字段并保留选项", () => {
    const def = makeDefinition();
    const q2 = def.questions[1]!;
    const single = retargetQuestionType(q2, "dropdown");
    expect(single.type).toBe("dropdown");
    expect(single).not.toHaveProperty("minChoices");
    expect(single.type === "dropdown" && single.options.map((option) => option.id)).toEqual(["x", "y", "z"]);
  });

  it("跨族只保留公共字段", () => {
    const def = makeDefinition();
    const q1 = def.questions[0]!;
    const text = retargetQuestionType(q1, "text");
    expect(text).toMatchObject({ id: "q1", title: "单选", required: true, type: "text" });
    expect(text).not.toHaveProperty("options");
    expect(text.showIf).toBeUndefined();
  });

  it("图片题型与纯文本选项同族：options 连同 imageFileId 一起保留（载荷不丢，来回切图不丢）", () => {
    const image = retargetQuestionType(
      {
        id: "q9",
        type: "image_single",
        title: "图片单选",
        required: false,
        options: [
          { id: "a", label: "甲", imageFileId: "f1" },
          { id: "b", label: "乙" },
        ],
      },
      "single",
    );
    expect(image.type).toBe("single");
    expect(image.type === "single" && image.options.map((o) => o.id)).toEqual(["a", "b"]);
    // imageFileId 随选项族保留；渲染/校验/导出只在图片题型上认它。
    const result = apply(makeDefinition(), [
      {
        op: "add_question",
        pageId: "p1",
        question: {
          id: "qimg",
          type: "image_single",
          title: "图",
          required: false,
          options: [{ id: "a", label: "甲", imageFileId: "f1" }],
        },
      },
      { op: "update_question", questionId: "qimg", patch: { type: "single" } },
      { op: "update_question", questionId: "qimg", patch: { type: "image_single" } },
    ]);
    expect(result.rejected).toEqual([]);
    const converted = result.definition.questions.find((q) => q.id === "qimg");
    expect(converted?.type).toBe("image_single");
    expect(
      converted?.type === "image_single" && converted.options[0]?.imageFileId,
    ).toBe("f1");
  });

  it("矩阵族：矩阵填空与单/多选矩阵互转保留行；列只在两端都有列时保留", () => {
    const likert = retargetQuestionType(
      {
        id: "q8",
        type: "matrix_single",
        title: "矩阵",
        required: false,
        rows: [{ id: "r1", label: "行一" }],
        columns: [
          { id: "c1", label: "列一" },
          { id: "c2", label: "列二" },
        ],
      },
      "matrix_text",
    );
    expect(likert.type).toBe("matrix_text");
    expect(likert).toHaveProperty("rows");
    expect(likert).not.toHaveProperty("columns");

    // 反向：矩阵填空没有列，转回单选矩阵需要调用方补列（schema 拒缺列）。
    const back = retargetQuestionType(
      { id: "q8", type: "matrix_text", title: "填空", required: false, rows: [{ id: "r1", label: "行一" }] },
      "matrix_single",
    );
    expect(back).not.toHaveProperty("columns");
    // 跨族换到矩阵填空：patch 必须自带行。
    const result = apply(makeDefinition(), [
      {
        op: "update_question",
        questionId: "q5",
        patch: { type: "matrix_text", rows: [{ id: "r1", label: "行一" }] },
      },
    ]);
    expect(result.rejected).toEqual([]);
    const matrixText = result.definition.questions.find((q) => q.id === "q5");
    expect(matrixText?.type).toBe("matrix_text");
    expect(matrixText).toHaveProperty("rows");
    expect(matrixText).not.toHaveProperty("columns");
  });
});

describe("researchDesign（#224）", () => {
  const design = {
    researchQuestion: "研究者在多大程度上使用 AI 辅助写作？",
    population: "高校理工科在读博士生",
    recruitment: "院系邮件列表与学术社群",
    purpose: "describe" as const,
    timeBudgetMinutes: 8,
    constructs: [{ id: "c1", label: "使用频率", definition: "近三个月使用频率", questionIds: ["q1"] }],
    analysisPlan: "描述统计与分组交叉表；不做推断检验",
    assumptions: ["样本可代表同一学科"],
    pendingDecisions: ["是否需要按年级分层"],
  };

  it("旧定义没有 researchDesign 仍合法（向后兼容）", () => {
    const definition = makeDefinition();
    expect(definition).not.toHaveProperty("researchDesign");
    expect(apply(definition, [{ op: "set_meta", title: "旧卷" }]).rejected).toEqual([]);
  });

  it("set_meta 写入研究设计；null 清除，未给字段不动", () => {
    const saved = apply(makeDefinition(), [{ op: "set_meta", researchDesign: design }]);
    expect(saved.rejected).toEqual([]);
    expect(saved.definition.researchDesign).toEqual(design);

    const cleared = apply(saved.definition, [{ op: "set_meta", researchDesign: null }]);
    expect(cleared.rejected).toEqual([]);
    expect(cleared.definition).not.toHaveProperty("researchDesign");
    expect(cleared.definition.title).toBe(saved.definition.title);

    const untouched = apply(saved.definition, [{ op: "set_meta", title: "新标题" }]);
    expect(untouched.definition.researchDesign).toEqual(design);
  });

  it("研究设计形状不合法被拒（未知 purpose / 超上限维度）", () => {
    const bad = apply(makeDefinition(), [
      { op: "set_meta", researchDesign: { ...design, purpose: "predict" } },
    ]);
    expect(bad.rejected).toHaveLength(1);
    expect(bad.definition).not.toHaveProperty("researchDesign");
  });

  it("作者自报的试填记录随设计保存，缺时间戳被拒", () => {
    const pretest = { participantCount: 3, notes: "两位反馈题干歧义", recordedAt: "2026-10-25T00:00:00.000Z" };
    const saved = apply(makeDefinition(), [{ op: "set_meta", researchDesign: { ...design, pretest } }]);
    expect(saved.rejected).toEqual([]);
    expect(saved.definition.researchDesign?.pretest).toEqual(pretest);

    const bad = apply(makeDefinition(), [
      { op: "set_meta", researchDesign: { ...design, pretest: { participantCount: 0, notes: "", recordedAt: "" } } },
    ]);
    expect(bad.rejected).toHaveLength(1);
  });

  it("删除题目摘掉失效映射，不给悬空 id 留「已被测量」的假象", () => {
    const withDesign = apply(makeDefinition(), [{ op: "set_meta", researchDesign: design }]).definition;
    const removed = apply(withDesign, [{ op: "remove_question", questionId: "q1" }]);
    expect(removed.rejected).toEqual([]);
    expect(removed.definition.researchDesign?.constructs[0]?.questionIds).toEqual([]);
    // 只摘映射，不改研究问题与维度定义（不默默重写研究目标）。
    expect(removed.definition.researchDesign?.researchQuestion).toBe(design.researchQuestion);
    expect(removed.definition.researchDesign?.constructs[0]?.definition).toBe(design.constructs[0]!.definition);
    // 维度失去全部题目时给出提示，而不是假装覆盖仍在。
    expect(removed.issues.map((issue) => issue.code)).toContain("design_construct_unmapped");
  });

  it("外部写入的悬空映射被语义校验报出", () => {
    const definition: SurveyDefinition = {
      ...makeDefinition(),
      researchDesign: {
        ...design,
        constructs: [{ ...design.constructs[0]!, questionIds: ["ghost"] }],
      },
    };
    const result = apply(definition, [{ op: "set_meta", title: "校验" }]);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("design_unknown_question");
  });
});
