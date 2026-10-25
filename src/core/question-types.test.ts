// 新题型（issue #217）：每种题型至少覆盖定义校验、答案校验（合法/非法/必答）
// 与变量展开口径。展开是变量字典/CSV/research-data 三处的共同事实源，这里钉死。
import { describe, expect, it } from "vitest";

import {
  SurveyDefinitionSchema,
  surveyCellValue,
  surveyVariables,
  validateSurveyAnswers,
  validateSurveyDefinition,
  type SurveyDefinition,
  type SurveyQuestion,
} from "./index.js";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function rowsOf(n: number, prefix = "r"): { id: string; label: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, label: `行 ${i + 1}` }));
}
function colsOf(n: number, prefix = "c"): { id: string; label: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, label: `列 ${i + 1}` }));
}
function optionsOf(n: number, prefix = "o"): { id: string; label: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, label: `选项 ${i + 1}` }));
}

export function makeTypesDefinition(): SurveyDefinition {
  const questions: SurveyQuestion[] = [
    { id: "d1", type: "dropdown", title: "下拉", required: true, options: optionsOf(3, "d") },
    { id: "ra", type: "rating", title: "评分", required: true, max: 5 },
    { id: "np", type: "nps", title: "推荐", required: false, minLabel: "完全不可能", maxLabel: "极有可能" },
    { id: "dt", type: "date", title: "日期", required: false, min: "2026-01-01", max: "2026-12-31" },
    { id: "tm", type: "time", title: "时间", required: false },
    {
      id: "rk",
      type: "ranking",
      title: "排序",
      required: true,
      options: optionsOf(3, "k"),
    },
    {
      id: "ms",
      type: "matrix_single",
      title: "矩阵单选",
      required: true,
      rows: rowsOf(2),
      columns: colsOf(3),
    },
    {
      id: "mm",
      type: "matrix_multiple",
      title: "矩阵多选",
      required: false,
      rows: rowsOf(2),
      columns: colsOf(2, "m"),
    },
    {
      id: "mt",
      type: "multi_text",
      title: "多项填空",
      required: true,
      items: [
        { id: "i1", label: "项一" },
        { id: "i2", label: "项二" },
      ],
    },
    { id: "st", type: "statement", title: "", required: false, body: "**欢迎**参与" },
    {
      id: "ims",
      type: "image_single",
      title: "图片单选",
      required: true,
      options: [
        { id: "p1", label: "方案一", imageFileId: "f1" },
        { id: "p2", label: "方案二" },
      ],
    },
    {
      id: "imm",
      type: "image_multiple",
      title: "图片多选",
      required: false,
      options: [
        { id: "g1", label: "图一", imageFileId: "f1" },
        { id: "g2", label: "图二" },
      ],
    },
    {
      id: "mtx",
      type: "matrix_text",
      title: "矩阵填空",
      required: true,
      rows: rowsOf(2),
    },
  ];
  return {
    version: 1,
    title: "新题型问卷",
    description: "",
    consent: "",
    questions,
    pages: [
      { id: "p1", title: "一", questionIds: ["d1", "ra", "np", "dt", "tm"] },
      { id: "p2", title: "二", questionIds: ["rk", "ms", "mm", "mt", "st"] },
      { id: "p3", title: "三", questionIds: ["ims", "imm", "mtx"] },
    ],
  };
}

const LEGAL_ANSWERS = {
  d1: "d2",
  ra: 4,
  np: 10,
  dt: "2026-06-01",
  tm: "08:30",
  rk: ["k3", "k1", "k2"],
  ms: { r1: "c2", r2: "c3" },
  mm: { r1: ["m1", "m2"] },
  mt: { i1: "第一项", i2: "第二项" },
  ims: "p2",
  imm: ["g1"],
  mtx: { r1: "第一行文本", r2: "第二行文本" },
};

describe("新题型：定义校验", () => {
  it("接受全部新题型的合法基准定义", () => {
    expect(validateSurveyDefinition(makeTypesDefinition())).toEqual([]);
    expect(SurveyDefinitionSchema.safeParse(makeTypesDefinition()).success).toBe(
      true,
    );
  });

  it("说明块不可必答；可带空题干；答案/字典层面不产生变量", () => {
    const def = makeTypesDefinition();
    const st = def.questions[9];
    if (st?.type !== "statement") throw new Error("fixture");
    expect(codes(validateSurveyDefinition({ ...def, questions: [...def.questions.slice(0, 9), { ...st, required: true }] }))).toContain(
      "statement_not_required",
    );
  });

  it("矩阵行/列与填空项 id 重复拒绝；date 下限晚于上限拒绝", () => {
    const dup = makeTypesDefinition();
    const ms = dup.questions[6];
    if (ms?.type !== "matrix_single") throw new Error("fixture");
    dup.questions[6] = { ...ms, rows: [...ms.rows, { id: "r1", label: "重复行" }] };
    expect(codes(validateSurveyDefinition(dup))).toContain("duplicate_id");

    const range = makeTypesDefinition();
    const dt = range.questions[3];
    if (dt?.type !== "date") throw new Error("fixture");
    range.questions[3] = { ...dt, min: "2026-12-31", max: "2026-01-01" };
    expect(codes(validateSurveyDefinition(range))).toContain("invalid_date_range");
  });

  it("排序少于 2 个选项拒绝；rating 档位越界与 date 非法格式被 schema 拦", () => {
    const one = makeTypesDefinition();
    const rk = one.questions[5];
    if (rk?.type !== "ranking") throw new Error("fixture");
    one.questions[5] = { ...rk, options: [rk.options[0]!] };
    expect(codes(validateSurveyDefinition(one))).toContain("empty_options");

    expect(
      SurveyDefinitionSchema.safeParse({
        ...makeTypesDefinition(),
        questions: makeTypesDefinition().questions.map((q) =>
          q.type === "rating" ? { ...q, max: 11 } : q,
        ),
      }).success,
    ).toBe(false);

    const badDate = makeTypesDefinition();
    const dt = badDate.questions[3];
    if (dt?.type !== "date") throw new Error("fixture");
    badDate.questions[3] = { ...dt, min: "2026-02-30" };
    expect(SurveyDefinitionSchema.safeParse(badDate).success).toBe(false);
  });

  it("矩阵/排序/多项填空/说明块不能作为条件源", () => {
    // 条件源在前、引用者在后：先过 condition_not_previous 才轮到题型判定。
    const def: SurveyDefinition = {
      version: 1,
      title: "条件源",
      description: "",
      consent: "",
      questions: [
        {
          id: "ms",
          type: "matrix_single",
          title: "矩阵",
          required: false,
          rows: rowsOf(1),
          columns: colsOf(2),
        },
        {
          id: "np",
          type: "nps",
          title: "推荐",
          required: false,
          showIf: { questionId: "ms", op: "eq", value: "c1" },
        },
        { id: "st", type: "statement", title: "", required: false, body: "说明" },
        {
          id: "rk",
          type: "ranking",
          title: "排序",
          required: false,
          options: optionsOf(2, "k"),
          showIf: { questionId: "st", op: "eq", value: "x" },
        },
        {
          id: "mt",
          type: "multi_text",
          title: "填空",
          required: false,
          items: [{ id: "i1", label: "项" }],
          showIf: { questionId: "rk", op: "eq", value: "k1" },
        },
        {
          id: "mm",
          type: "matrix_multiple",
          title: "矩阵多选",
          required: false,
          rows: rowsOf(1),
          columns: colsOf(2, "m"),
          showIf: { questionId: "mt", op: "eq", value: "i1" },
        },
        {
          id: "mtx",
          type: "matrix_text",
          title: "矩阵填空",
          required: false,
          rows: rowsOf(1),
          showIf: { questionId: "mm", op: "contains", value: "m1" },
        },
      ],
      pages: [
        { id: "p1", title: "一", questionIds: ["ms", "np", "st", "rk", "mt", "mm", "mtx"] },
      ],
    };
    const result = codes(validateSurveyDefinition(def));
    expect(result.filter((c) => c === "condition_unsupported_source")).toHaveLength(5);
  });

  it("图片单选/多选可以作为条件源且算子与 single/multiple 同集", () => {
    const def: SurveyDefinition = {
      version: 1,
      title: "图片条件源",
      description: "",
      consent: "",
      questions: [
        {
          id: "ims",
          type: "image_single",
          title: "图片单选",
          required: false,
          options: [{ id: "p1", label: "一" }],
        },
        {
          id: "imm",
          type: "image_multiple",
          title: "图片多选",
          required: false,
          options: [{ id: "g1", label: "一" }],
        },
        {
          id: "t1",
          type: "text",
          title: "文本",
          required: false,
          showIf: { questionId: "ims", op: "eq", value: "p1" },
        },
        {
          id: "t2",
          type: "text",
          title: "文本二",
          required: false,
          showIf: { questionId: "imm", op: "contains", value: "g1" },
        },
      ],
      pages: [{ id: "p1", title: "一", questionIds: ["ims", "imm", "t1", "t2"] }],
    };
    expect(validateSurveyDefinition(def)).toEqual([]);
  });

  it("图片题至少一个选项；矩阵填空行 id 重复拒绝", () => {
    const noOptions = makeTypesDefinition();
    const ims = noOptions.questions[10];
    if (ims?.type !== "image_single") throw new Error("fixture");
    noOptions.questions[10] = { ...ims, options: [] };
    expect(codes(validateSurveyDefinition(noOptions))).toContain("empty_options");

    const dup = makeTypesDefinition();
    const mtx = dup.questions[12];
    if (mtx?.type !== "matrix_text") throw new Error("fixture");
    dup.questions[12] = { ...mtx, rows: [...mtx.rows, { id: "r1", label: "重复行" }] };
    expect(codes(validateSurveyDefinition(dup))).toContain("duplicate_id");
  });

  it("dropdown/rating/nps/date/time 可以作为条件源且值域受检", () => {
    const def = makeTypesDefinition();
    const np = def.questions[2];
    if (np?.type !== "nps") throw new Error("fixture");
    def.questions[2] = { ...np, showIf: { questionId: "ra", op: "eq", value: 5 } };
    def.questions[3] = {
      id: "dt",
      type: "date",
      title: "日期",
      required: false,
      showIf: { questionId: "np", op: "eq", value: 3 },
    };
    expect(validateSurveyDefinition(def)).toEqual([]);

    const outOfRange = makeTypesDefinition();
    const np2 = outOfRange.questions[2];
    if (np2?.type !== "nps") throw new Error("fixture");
    outOfRange.questions[2] = {
      ...np2,
      showIf: { questionId: "ra", op: "eq", value: 9 },
    };
    expect(codes(validateSurveyDefinition(outOfRange))).toContain(
      "condition_type_mismatch",
    );
  });
});

describe("新题型：答案校验", () => {
  it("接受沿路径的完整合法答案", () => {
    expect(validateSurveyAnswers(makeTypesDefinition(), LEGAL_ANSWERS)).toEqual(
      [],
    );
  });

  it("rating/nps：非整数与越界拒绝", () => {
    const def = makeTypesDefinition();
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ra: 6 }))).toContain("out_of_range");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ra: 4.5 }))).toContain("invalid_type");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, np: -1 }))).toContain("out_of_range");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, np: 0 }))).toEqual([]);
  });

  it("date：非法格式与范围外拒绝；time：非法格式拒绝", () => {
    const def = makeTypesDefinition();
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, dt: "2026-13-01" }))).toContain("invalid_type");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, dt: "2025-12-31" }))).toContain("out_of_range");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, dt: "2026-12-31" }))).toEqual([]);
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, tm: "24:00" }))).toContain("invalid_type");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, tm: "23:59" }))).toEqual([]);
  });

  it("ranking：必须全排列且无重复", () => {
    const def = makeTypesDefinition();
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, rk: ["k1", "k2"] }))).toContain("ranking_incomplete");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, rk: ["k1", "k1", "k3"] }))).toContain("duplicate_option");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, rk: ["k1", "k2", "zz"] }))).toContain("invalid_option");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, rk: "k1" }))).toContain("invalid_type");
  });

  it("matrix_single：必答每行都答、列必须在定义内、未知行拒绝", () => {
    const def = makeTypesDefinition();
    expect(
      codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ms: { r1: "c1" } })),
    ).toEqual(expect.arrayContaining(["required_missing"]));
    expect(
      codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ms: { r1: "zz", r2: "c1" } })),
    ).toContain("invalid_column");
    expect(
      codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ms: { r1: "c1", r2: "c2", r9: "c1" } })),
    ).toContain("invalid_row");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ms: ["c1"] }))).toContain(
      "invalid_type",
    );
  });

  it("matrix_multiple：行值是列 id 数组、可留空（非必答）、重复列拒绝", () => {
    const def = makeTypesDefinition();
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mm: { r1: "m1" } }))).toContain(
      "invalid_column",
    );
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mm: { r1: ["m1", "m1"] } }))).toContain(
      "duplicate_option",
    );
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mm: { r2: [] } }))).toEqual([]);
  });

  it("multi_text：必答每项都填、未知项拒绝", () => {
    const def = makeTypesDefinition();
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mt: { i1: "只有一项" } }))).toContain(
      "required_missing",
    );
    // 填空项值是数字：答案 record 的子值域不含数字，schema 层整体拒绝。
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mt: { i1: "a", i2: 1 } }))).toContain(
      "schema.invalid_union",
    );
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mt: { i1: "a", i2: "b", i9: "c" } }))).toContain(
      "invalid_item",
    );
  });

  it("statement：提交带答案一律拒绝；空对象矩阵按未答计", () => {
    const def = makeTypesDefinition();
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, st: "x" }))).toContain(
      "statement_answer",
    );
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ms: {} }))).toContain(
      "required_missing",
    );
  });

  it("image_single/image_multiple：作答值域与 single/multiple 相同", () => {
    const def = makeTypesDefinition();
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ims: "zz" }))).toContain(
      "invalid_option",
    );
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, ims: ["p1"] }))).toContain(
      "invalid_type",
    );
    expect(
      codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, imm: ["g1", "g1"] })),
    ).toContain("duplicate_option");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, imm: "g1" }))).toContain(
      "invalid_type",
    );
    // 互斥选项与其他选项同选拒绝（值域与 multiple 同一口径）。
    const exclusive = makeTypesDefinition();
    const imm = exclusive.questions[11];
    if (imm?.type !== "image_multiple") throw new Error("fixture");
    exclusive.questions[11] = {
      ...imm,
      options: imm.options.map((o, i) => ({ ...o, exclusive: i === 0 })),
    };
    expect(
      codes(validateSurveyAnswers(exclusive, { ...LEGAL_ANSWERS, imm: ["g1", "g2"] })),
    ).toContain("exclusive_conflict");
  });

  it("matrix_text：必答全行非空、空串按未作答、未知行拒绝", () => {
    const def = makeTypesDefinition();
    expect(
      codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mtx: { r1: "只有一行" } })),
    ).toEqual(expect.arrayContaining(["required_missing"]));
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mtx: { r1: "", r2: "x" } }))).toEqual(
      expect.arrayContaining(["required_missing"]),
    );
    expect(
      codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mtx: { r1: "a", r2: "b", r9: "c" } })),
    ).toContain("invalid_row");
    expect(codes(validateSurveyAnswers(def, { ...LEGAL_ANSWERS, mtx: "文本" }))).toContain(
      "invalid_type",
    );
    // 非必答：留空的行不拦。
    const optional = makeTypesDefinition();
    const mtx = optional.questions[12];
    if (mtx?.type !== "matrix_text") throw new Error("fixture");
    optional.questions[12] = { ...mtx, required: false };
    expect(
      codes(validateSurveyAnswers(optional, { ...LEGAL_ANSWERS, mtx: { r2: "" } })),
    ).toEqual([]);
  });
});

describe("新题型：变量字典展开", () => {
  it("单变量题保持题目 id；矩阵/排序/多项填空按行/选项/项展开", () => {
    const variables = surveyVariables(makeTypesDefinition());
    const ids = variables.map((v) => v.id);
    expect(ids).toEqual([
      "d1",
      "ra",
      "np",
      "dt",
      "tm",
      "rk.k1",
      "rk.k2",
      "rk.k3",
      "ms.r1",
      "ms.r2",
      "mm.r1",
      "mm.r2",
      "mt.i1",
      "mt.i2",
      "ims",
      "imm",
      "mtx.r1",
      "mtx.r2",
    ]);
    const kinds = Object.fromEntries(variables.map((v) => [v.id, v.kind]));
    expect(kinds).toMatchObject({
      d1: "categorical",
      ra: "ordinal",
      np: "ordinal",
      dt: "date",
      tm: "text",
      "rk.k1": "ordinal",
      "ms.r1": "ordinal",
      "mm.r1": "multiple",
      "mt.i1": "text",
      ims: "categorical",
      imm: "multiple",
      "mtx.r1": "text",
    });
    // 说明块不进字典。
    expect(ids).not.toContain("st");
  });

  it("图片题的取值域只有选项文案，imageFileId 不进字典", () => {
    const byId = Object.fromEntries(
      surveyVariables(makeTypesDefinition()).map((v) => [v.id, v]),
    );
    expect(byId["ims"]!.options).toEqual([
      { id: "p1", label: "方案一" },
      { id: "p2", label: "方案二" },
    ]);
    expect(JSON.stringify(byId["imm"])).not.toContain("imageFileId");
  });

  it("ordinal 变量的 options 描述取值域：rating 1..max、nps 0..10、矩阵列位次映射列文案", () => {
    const variables = surveyVariables(makeTypesDefinition());
    const byId = Object.fromEntries(variables.map((v) => [v.id, v]));
    expect(byId["ra"]!.options).toHaveLength(5);
    expect(byId["np"]!.options).toEqual(
      Array.from({ length: 11 }, (_, i) => ({ id: String(i), label: String(i) })),
    );
    expect(byId["ms.r1"]!.options).toEqual([
      { id: "1", label: "列 1" },
      { id: "2", label: "列 2" },
      { id: "3", label: "列 3" },
    ]);
    expect(byId["mm.r1"]!.options).toEqual([
      { id: "m1", label: "列 1" },
      { id: "m2", label: "列 2" },
    ]);
    expect(byId["ms.r1"]!.label).toBe("矩阵单选·行 1");
  });

  it("surveyCellValue 把答案投影到展开变量：排序名次、矩阵列位次、多选集合、填空文本", () => {
    const def = makeTypesDefinition();
    const byType = Object.fromEntries(def.questions.map((q) => [q.id, q]));
    expect(surveyCellValue(byType["rk"]!, "rk.k2", ["k3", "k1", "k2"])).toBe(3);
    expect(surveyCellValue(byType["rk"]!, "rk.k3", undefined)).toBeNull();
    expect(surveyCellValue(byType["ms"]!, "ms.r2", { r1: "c1", r2: "c3" })).toBe(3);
    expect(surveyCellValue(byType["ms"]!, "ms.r1", { r2: "c3" })).toBeNull();
    expect(surveyCellValue(byType["mm"]!, "mm.r1", { r1: ["m2"] })).toEqual(["m2"]);
    expect(surveyCellValue(byType["mt"]!, "mt.i2", { i1: "a", i2: "b" })).toBe("b");
    expect(surveyCellValue(byType["ra"]!, "ra", 4)).toBe(4);
    expect(surveyCellValue(byType["st"]!, "st", undefined)).toBeNull();
    expect(surveyCellValue(byType["ims"]!, "ims", "p2")).toBe("p2");
    expect(surveyCellValue(byType["imm"]!, "imm", ["g1", "g2"])).toEqual(["g1", "g2"]);
    expect(surveyCellValue(byType["mtx"]!, "mtx.r2", { r1: "a", r2: "b" })).toBe("b");
    expect(surveyCellValue(byType["mtx"]!, "mtx.r1", { r2: "b" })).toBeNull();
  });
});
