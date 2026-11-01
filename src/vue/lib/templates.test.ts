// 模板注册表用例：每个模板必须是可发布的合法定义（schema + 语义校验双过）。
import { describe, expect, it } from "vitest";
import {
  SurveyDefinitionSchema,
  applySurveyOps,
  surveySourceState,
  validateSurveyDefinition,
} from "../../core/index.js";

import { surveyTemplates } from "./templates";
import { createSurveysTestI18n } from "../test-mount.js";

const i18n = createSurveysTestI18n();
const t = ((key: string) => i18n.global.t(key)) as (key: string) => string;

describe("surveyTemplates", () => {
  const templates = surveyTemplates(t);

  it("提供 9 个模板，id 与题目编号唯一", () => {
    expect(templates.map((tpl) => tpl.id)).toEqual([
      "satisfaction",
      "sus",
      "nps",
      "event",
      "baseline",
      "gse",
      "phq9",
      "gad7",
      "who5",
    ]);
    for (const template of templates) {
      const questionIds = template.definition.questions.map((q) => q.id);
      expect(new Set(questionIds).size).toBe(questionIds.length);
      const pageIds = template.definition.pages.map((p) => p.id);
      expect(new Set(pageIds).size).toBe(pageIds.length);
    }
  });

  it("每个模板通过 schema 与语义校验（可直接落草稿、可发布）", () => {
    for (const template of templates) {
      const parsed = SurveyDefinitionSchema.safeParse(template.definition);
      expect(parsed.success, template.id).toBe(true);
      expect(validateSurveyDefinition(template.definition), template.id).toEqual([]);
    }
  });

  it("模板名称、描述、场景非空且随 locale（zh）构建", () => {
    for (const template of templates) {
      expect(template.name).toBe(
        i18n.global.t(`surveys.templates.${template.id}.name`),
      );
      expect(template.description).toBeTruthy();
      expect(template.scene).toBeTruthy();
      expect(template.definition.title).toBe(template.name);
    }
  });

  it("基础满意度：Likert 五点矩阵单选 5 行，总体满意度 5 选项", () => {
    const template = templates[0]!;
    const dims = template.definition.questions.find((q) => q.id === "sat_dims")!;
    expect(dims.type).toBe("matrix_single");
    if (dims.type !== "matrix_single") return;
    expect(dims.rows).toHaveLength(5);
    expect(dims.columns.map((c) => c.label)).toEqual([
      "非常不满意",
      "不满意",
      "一般",
      "满意",
      "非常满意",
    ]);
  });

  it("SUS：单题 10 行矩阵（经典 10 陈述 × 5 档），描述如实说明结构，两端锚点为「非常不同意/非常同意」", () => {
    const template = templates[1]!;
    // minor③：描述与元数据口径一致——是「1 页 · 1 题」的单题 10 行矩阵。
    expect(template.description).toContain("10 行矩阵");
    const matrix = template.definition.questions.find((q) => q.id === "sus_matrix")!;
    expect(matrix.type).toBe("matrix_single");
    if (matrix.type !== "matrix_single") return;
    expect(matrix.rows).toHaveLength(10);
    expect(matrix.columns).toHaveLength(5);
    expect(matrix.columns[0]!.label).toBe(i18n.global.t("surveys.likert.c1"));
    expect(matrix.columns.at(-1)!.label).toBe(i18n.global.t("surveys.likert.c5"));
    // 奇偶题正负交替：偶数题文案必须与奇数题区分（SUS 规范的关键锚点）。
    const [s1, s2] = matrix.rows;
    expect(s1!.label).not.toBe(s2!.label);
  });

  it("SUS 来源随问卷保留，并据实际题目判断编辑和删除状态", () => {
    const definition = surveyTemplates(t, "zh-CN")[1]!.definition;
    const record = definition.sourceRecords![0]!;
    expect(record.language).toBe("zh-CN");
    expect(SurveyDefinitionSchema.parse(definition).sourceRecords).toEqual(definition.sourceRecords);
    expect(surveySourceState(definition, record.questionId, record.baselineQuestion)).toBe("unchanged");
    const meta = applySurveyOps(definition, [{ op: "set_meta", title: "新标题" }]);
    expect(meta.definition.sourceRecords).toEqual(definition.sourceRecords);
    const result = applySurveyOps(definition, [{ op: "update_question", questionId: "sus_matrix", patch: { title: "更新后的表述" } }]);
    expect(result.definition.sourceRecords).toEqual(definition.sourceRecords);
    expect(surveySourceState(result.definition, record.questionId, record.baselineQuestion)).toBe("modified");
    const removed = applySurveyOps(definition, [{ op: "remove_question", questionId: "sus_matrix" }]);
    expect(surveySourceState(removed.definition, record.questionId, record.baselineQuestion)).toBe("missing");
  });

  it("NPS：nps 题 0–10，两端锚点用默认文案", () => {
    const template = templates[2]!;
    const score = template.definition.questions.find((q) => q.id === "nps_score")!;
    expect(score.type).toBe("nps");
    if (score.type !== "nps") return;
    expect(score.minLabel).toBe(i18n.global.t("surveys.npsDefaultMin"));
    expect(score.maxLabel).toBe(i18n.global.t("surveys.npsDefaultMax"));
  });

  it("活动反馈：2 页结构，末页是人口学信息", () => {
    const template = templates[3]!;
    expect(template.definition.pages).toHaveLength(2);
    expect(template.definition.pages[1]!.questionIds).toEqual(["ev_role", "ev_channel"]);
  });

  it("研究基线：说明块 + 人口学页 + 基线量表页，说明块不是必答", () => {
    const template = templates[4]!;
    expect(template.definition.pages).toHaveLength(3);
    const notice = template.definition.questions.find((q) => q.id === "bl_notice")!;
    expect(notice.type).toBe("statement");
    expect(notice.required).toBe(false);
    if (notice.type !== "statement") return;
    // 演示 markdown 能力：正文含标题与列表。
    expect(notice.body).toContain("###");
    expect(notice.body).toContain("- ");
  });

  // 公开量表模板：单页单矩阵 + 每模板一条来源记录，条目数对齐原版。
  const scaleShapes = [
    { id: "gse", questionId: "gse_matrix", sourceId: "gse-schwarzer-1995", rows: 10, columns: 4 },
    { id: "phq9", questionId: "phq9_matrix", sourceId: "phq9-kroenke-2001", rows: 9, columns: 4 },
    { id: "gad7", questionId: "gad7_matrix", sourceId: "gad7-spitzer-2006", rows: 7, columns: 4 },
    { id: "who5", questionId: "who5_matrix", sourceId: "who5-who-1998", rows: 5, columns: 6 },
  ] as const;

  it.each(scaleShapes)(
    "$id：单页 1 题 $rows 行 × $columns 列矩阵，来源记录挂矩阵题且基线快照未变",
    ({ id, questionId, sourceId, rows, columns }) => {
      const template = templates.find((tpl) => tpl.id === id)!;
      expect(template.definition.pages).toHaveLength(1);
      expect(template.definition.questions).toHaveLength(1);
      const matrix = template.definition.questions.find((q) => q.id === questionId)!;
      expect(matrix.type).toBe("matrix_single");
      expect(matrix.required).toBe(true);
      if (matrix.type !== "matrix_single") return;
      expect(matrix.rows).toHaveLength(rows);
      expect(matrix.columns).toHaveLength(columns);
      const record = template.definition.sourceRecords![0]!;
      expect(record.sourceId).toBe(sourceId);
      expect(record.questionId).toBe(questionId);
      expect(record.baselineQuestion).toBeTruthy();
    },
  );

  it("公开量表的来源随问卷保留，按当前语言记录且基线快照未变", () => {
    for (const { id, questionId } of scaleShapes) {
      const definition = surveyTemplates(t, "zh-CN").find((tpl) => tpl.id === id)!.definition;
      const record = definition.sourceRecords![0]!;
      expect(record.language).toBe("zh-CN");
      expect(SurveyDefinitionSchema.parse(definition).sourceRecords).toEqual(definition.sourceRecords);
      expect(surveySourceState(definition, record.questionId, record.baselineQuestion)).toBe("unchanged");
      const meta = applySurveyOps(definition, [{ op: "set_meta", title: "新标题" }]);
      expect(meta.definition.sourceRecords).toEqual(definition.sourceRecords);
      const result = applySurveyOps(definition, [{ op: "update_question", questionId, patch: { title: "更新后的表述" } }]);
      expect(surveySourceState(result.definition, record.questionId, record.baselineQuestion)).toBe("modified");
    }
  });

  it("GSE：4 级为『完全不正确…完全正确』，描述写明 10–40 计分与无反向题", () => {
    const template = templates.find((tpl) => tpl.id === "gse")!;
    const matrix = template.definition.questions[0]!;
    if (matrix.type !== "matrix_single") return;
    expect(matrix.columns.map((c) => c.label)).toEqual([
      "完全不正确",
      "几乎不正确",
      "基本正确",
      "完全正确",
    ]);
    expect(template.definition.description).toContain("10–40");
    expect(template.definition.description).toContain("无反向题");
  });

  it("PHQ-9：4 级为 0–3 频率档，第 9 题自伤条目保留原位，描述含筛查边界", () => {
    const template = templates.find((tpl) => tpl.id === "phq9")!;
    const matrix = template.definition.questions[0]!;
    if (matrix.type !== "matrix_single") return;
    expect(matrix.columns.map((c) => c.label)).toEqual([
      "完全没有",
      "有几天",
      "超过一半的天数",
      "几乎每天",
    ]);
    // 条目顺序对齐原版：第 9 条是自伤条目且仍收尾。
    expect(matrix.rows.at(-1)!.label).toContain("伤害自己");
    expect(template.definition.description).toContain("不构成临床诊断");
    expect(template.definition.description).toContain("第 9 题");
  });

  it("GAD-7：7 题保留原版顺序（第 7 条为惊恐式表述），描述含筛查边界与 0–21 计分", () => {
    const template = templates.find((tpl) => tpl.id === "gad7")!;
    const matrix = template.definition.questions[0]!;
    if (matrix.type !== "matrix_single") return;
    expect(matrix.rows[0]!.label).toContain("紧张");
    expect(matrix.rows.at(-1)!.label).toContain("可怕的事情");
    expect(template.definition.description).toContain("0–21");
    expect(template.definition.description).toContain("不构成临床诊断");
  });

  it("WHO-5：6 级为『所有时间…完全没有』，全部条目正向且描述写明 0–25 折算百分比", () => {
    const template = templates.find((tpl) => tpl.id === "who5")!;
    const matrix = template.definition.questions[0]!;
    if (matrix.type !== "matrix_single") return;
    expect(matrix.columns[0]!.label).toBe("所有时间");
    expect(matrix.columns.at(-1)!.label).toBe("完全没有");
    expect(template.definition.description).toContain("0–25");
    expect(template.definition.description).toContain("无反向题");
  });
});
