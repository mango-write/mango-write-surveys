// 模板注册表用例：每个模板必须是可发布的合法定义（schema + 语义校验双过），
// 题型结构按模板设计断言。版权红线在此兜底：模板只能出自本文件的自制文案。
import { describe, expect, it } from "vitest";
import {
  SurveyDefinitionSchema,
  validateSurveyDefinition,
} from "../../core/index.js";

import { surveyTemplates } from "./templates";
import { createSurveysTestI18n } from "../test-mount.js";

const i18n = createSurveysTestI18n();
const t = ((key: string) => i18n.global.t(key)) as (key: string) => string;

describe("surveyTemplates", () => {
  const templates = surveyTemplates(t);

  it("提供 5 个模板，id 与题目编号唯一", () => {
    expect(templates.map((tpl) => tpl.id)).toEqual([
      "satisfaction",
      "sus",
      "nps",
      "event",
      "baseline",
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
});
