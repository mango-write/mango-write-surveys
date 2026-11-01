// 模板注册表（issue #217）：纯客户端静态 SurveyDefinition，选模板后走既有
// create + save 草稿通道落定义（幂等：创建后立即保存为草稿 v1，标题可改），
// 不新增 API。自制模板内容全部自拟——不收录 SCL-90 等受版权量表；公开量表
// （SUS、GSE、PHQ-9、GAD-7、WHO-5）按各自公开版本的条目整理并挂来源记录。
// 文案经注入的 t：同一模板按当前语言构建。
import type { SurveyDefinition, SurveyQuestion } from "../../contracts/index.js";
import { canonicalSurveyJson } from "../../core/index.js";

type Translate = (key: string) => string;

export interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  scene: string;
  definition: SurveyDefinition;
}

function likertColumns(t: Translate): Array<{ id: string; label: string }> {
  return ["c1", "c2", "c3", "c4", "c5"].map((id) => ({
    id,
    label: t(`surveys.likert.${id}`),
  }));
}

function definition(
  title: string,
  description: string,
  questions: SurveyQuestion[],
  pages: SurveyDefinition["pages"],
): SurveyDefinition {
  return {
    version: 1,
    title,
    description,
    consent: "",
    questions,
    pages,
  };
}

function satisfaction(t: Translate): SurveyDefinition {
  const scale = ["c1", "c2", "c3", "c4", "c5"].map((id) => ({
    id,
    label: t(`surveys.templates.satisfaction.scale.${id}`),
  }));
  return definition(
    t("surveys.templates.satisfaction.name"),
    t("surveys.templates.satisfaction.description"),
    [
      {
        id: "sat_overall",
        title: t("surveys.templates.satisfaction.overall"),
        required: true,
        type: "single",
        options: scale,
      },
      {
        id: "sat_dims",
        title: t("surveys.templates.satisfaction.dims"),
        required: true,
        type: "matrix_single",
        rows: ["r1", "r2", "r3", "r4", "r5"].map((id) => ({
          id,
          label: t(`surveys.templates.satisfaction.dimRow.${id}`),
        })),
        columns: scale,
      },
      {
        id: "sat_focus",
        title: t("surveys.templates.satisfaction.focus"),
        required: false,
        type: "multiple",
        options: ["o1", "o2", "o3", "o4", "o5"].map((id) => ({
          id,
          label: t(`surveys.templates.satisfaction.focusOption.${id}`),
        })),
      },
      {
        id: "sat_open",
        title: t("surveys.templates.satisfaction.suggestion"),
        required: false,
        type: "text",
        multiline: true,
        maxLength: 2000,
      },
    ],
    [
      { id: "sat_p1", title: t("surveys.templates.satisfaction.page1"), questionIds: ["sat_overall", "sat_dims"] },
      { id: "sat_p2", title: t("surveys.templates.satisfaction.page2"), questionIds: ["sat_focus", "sat_open"] },
    ],
  );
}

function sus(t: Translate, language: string): SurveyDefinition {
  const statements = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i + 1}`,
    label: t(`surveys.templates.sus.statement.s${i + 1}`),
  }));
  const result = definition(
    t("surveys.templates.sus.name"),
    t("surveys.templates.sus.description"),
    [
      {
        id: "sus_matrix",
        title: t("surveys.templates.sus.matrix"),
        required: true,
        type: "matrix_single",
        rows: statements,
        columns: likertColumns(t),
      },
    ],
    [
      {
        id: "sus_p1",
        title: t("surveys.templates.sus.page1"),
        description: t("surveys.templates.sus.pageNote"),
        questionIds: ["sus_matrix"],
      },
    ],
  );
  result.sourceRecords = [{ sourceId: "sus-brooke-1996", questionId: "sus_matrix", language,
    baselineQuestion: canonicalSurveyJson(result.questions[0]) }];
  return result;
}

function nps(t: Translate): SurveyDefinition {
  return definition(
    t("surveys.templates.nps.name"),
    t("surveys.templates.nps.description"),
    [
      {
        id: "nps_score",
        title: t("surveys.templates.nps.score"),
        required: true,
        type: "nps",
        minLabel: t("surveys.npsDefaultMin"),
        maxLabel: t("surveys.npsDefaultMax"),
      },
      {
        id: "nps_reason",
        title: t("surveys.templates.nps.reason"),
        required: false,
        type: "text",
        multiline: true,
        maxLength: 2000,
      },
      {
        id: "nps_improve",
        title: t("surveys.templates.nps.improve"),
        required: false,
        type: "single",
        options: ["o1", "o2", "o3", "o4", "o5", "o6"].map((id) => ({
          id,
          label: t(`surveys.templates.nps.improveOption.${id}`),
        })),
      },
    ],
    [
      { id: "nps_p1", title: t("surveys.templates.nps.page1"), questionIds: ["nps_score", "nps_reason", "nps_improve"] },
    ],
  );
}

function event(t: Translate): SurveyDefinition {
  return definition(
    t("surveys.templates.event.name"),
    t("surveys.templates.event.description"),
    [
      {
        id: "ev_rating",
        title: t("surveys.templates.event.overallRating"),
        required: true,
        type: "rating",
        max: 5,
      },
      {
        id: "ev_dims",
        title: t("surveys.templates.event.dims"),
        required: true,
        type: "matrix_single",
        rows: ["r1", "r2", "r3", "r4"].map((id) => ({
          id,
          label: t(`surveys.templates.event.dimRow.${id}`),
        })),
        columns: ["c1", "c2", "c3", "c4", "c5"].map((id) => ({
          id,
          label: t(`surveys.templates.satisfaction.scale.${id}`),
        })),
      },
      {
        id: "ev_helpful",
        title: t("surveys.templates.event.helpful"),
        required: false,
        type: "multiple",
        options: ["o1", "o2", "o3", "o4", "o5"].map((id) => ({
          id,
          label: t(`surveys.templates.event.helpfulOption.${id}`),
        })),
      },
      {
        id: "ev_open",
        title: t("surveys.templates.event.suggestion"),
        required: false,
        type: "text",
        multiline: true,
        maxLength: 2000,
      },
      {
        id: "ev_role",
        title: t("surveys.templates.event.role"),
        required: false,
        type: "single",
        options: ["o1", "o2", "o3", "o4"].map((id) => ({
          id,
          label: t(`surveys.templates.event.roleOption.${id}`),
        })),
      },
      {
        id: "ev_channel",
        title: t("surveys.templates.event.channel"),
        required: false,
        type: "single",
        options: ["o1", "o2", "o3", "o4", "o5"].map((id) => ({
          id,
          label: t(`surveys.templates.event.channelOption.${id}`),
        })),
      },
    ],
    [
      { id: "ev_p1", title: t("surveys.templates.event.page1"), questionIds: ["ev_rating", "ev_dims", "ev_helpful", "ev_open"] },
      { id: "ev_p2", title: t("surveys.templates.event.page2"), questionIds: ["ev_role", "ev_channel"] },
    ],
  );
}

function baseline(t: Translate): SurveyDefinition {
  return definition(
    t("surveys.templates.baseline.name"),
    t("surveys.templates.baseline.description"),
    [
      {
        id: "bl_notice",
        title: t("surveys.templates.baseline.statementTitle"),
        required: false,
        type: "statement",
        body: t("surveys.templates.baseline.statementBody"),
      },
      {
        id: "bl_age",
        title: t("surveys.templates.baseline.age"),
        required: false,
        type: "single",
        options: ["o1", "o2", "o3", "o4", "o5"].map((id) => ({
          id,
          label: t(`surveys.templates.baseline.ageOption.${id}`),
        })),
      },
      {
        id: "bl_gender",
        title: t("surveys.templates.baseline.gender"),
        required: false,
        type: "single",
        options: ["o1", "o2", "o3"].map((id) => ({
          id,
          label: t(`surveys.templates.baseline.genderOption.${id}`),
        })),
      },
      {
        id: "bl_edu",
        title: t("surveys.templates.baseline.education"),
        required: false,
        type: "single",
        options: ["o1", "o2", "o3", "o4"].map((id) => ({
          id,
          label: t(`surveys.templates.baseline.educationOption.${id}`),
        })),
      },
      {
        id: "bl_field",
        title: t("surveys.templates.baseline.field"),
        required: false,
        type: "text",
        maxLength: 200,
      },
      {
        id: "bl_core",
        title: t("surveys.templates.baseline.core"),
        required: true,
        type: "matrix_single",
        rows: ["r1", "r2", "r3", "r4", "r5"].map((id) => ({
          id,
          label: t(`surveys.templates.baseline.coreRow.${id}`),
        })),
        columns: likertColumns(t),
      },
    ],
    [
      { id: "bl_p1", title: t("surveys.templates.baseline.page1"), questionIds: ["bl_notice"] },
      { id: "bl_p2", title: t("surveys.templates.baseline.page2"), questionIds: ["bl_age", "bl_gender", "bl_edu", "bl_field"] },
      { id: "bl_p3", title: t("surveys.templates.baseline.page3"), questionIds: ["bl_core"] },
    ],
  );
}

// 公开可用量表沿用 SUS 的口径：题目按可核验的公开版本整理（条目顺序与计分
// 对齐原版），中文表述为整理时自行翻译，不宣称已验证译本；来源记录挂在矩阵
// 题上，编辑/删除题目的变化判定由 surveySourceState 承担。sourceId 不在 core
// 的 SURVEY_SOURCE_CATALOG 内时，AI 侧来源详情回落为空，这是既有机制的已知
// 边界，不为此改 core。
function scaleDefinition(
  t: Translate,
  templateId: string,
  sourceId: string,
  language: string,
  statementCount: number,
  columnCount: number,
): SurveyDefinition {
  const questionId = `${templateId}_matrix`;
  const result = definition(
    t(`surveys.templates.${templateId}.name`),
    t(`surveys.templates.${templateId}.description`),
    [
      {
        id: questionId,
        title: t(`surveys.templates.${templateId}.matrix`),
        required: true,
        type: "matrix_single",
        rows: Array.from({ length: statementCount }, (_, i) => ({
          id: `s${i + 1}`,
          label: t(`surveys.templates.${templateId}.statement.s${i + 1}`),
        })),
        columns: Array.from({ length: columnCount }, (_, i) => ({
          id: `c${i + 1}`,
          label: t(`surveys.templates.${templateId}.column.c${i + 1}`),
        })),
      },
    ],
    [
      {
        id: `${templateId}_p1`,
        title: t(`surveys.templates.${templateId}.page1`),
        description: t(`surveys.templates.${templateId}.pageNote`),
        questionIds: [questionId],
      },
    ],
  );
  result.sourceRecords = [{ sourceId, questionId, language,
    baselineQuestion: canonicalSurveyJson(result.questions[0]) }];
  return result;
}

function gse(t: Translate, language: string): SurveyDefinition {
  return scaleDefinition(t, "gse", "gse-schwarzer-1995", language, 10, 4);
}

function phq9(t: Translate, language: string): SurveyDefinition {
  return scaleDefinition(t, "phq9", "phq9-kroenke-2001", language, 9, 4);
}

function gad7(t: Translate, language: string): SurveyDefinition {
  return scaleDefinition(t, "gad7", "gad7-spitzer-2006", language, 7, 4);
}

function who5(t: Translate, language: string): SurveyDefinition {
  return scaleDefinition(t, "who5", "who5-who-1998", language, 5, 6);
}

/** 按给定 t（当前 locale）构建模板清单（内容即定义本体）。展示顺序即选择顺序。 */
export function surveyTemplates(t: Translate, language = "und"): SurveyTemplate[] {
  return [
    {
      id: "satisfaction",
      name: t("surveys.templates.satisfaction.name"),
      description: t("surveys.templates.satisfaction.desc"),
      scene: t("surveys.templates.satisfaction.scene"),
      definition: satisfaction(t),
    },
    {
      id: "sus",
      name: t("surveys.templates.sus.name"),
      description: t("surveys.templates.sus.desc"),
      scene: t("surveys.templates.sus.scene"),
      definition: sus(t, language),
    },
    {
      id: "nps",
      name: t("surveys.templates.nps.name"),
      description: t("surveys.templates.nps.desc"),
      scene: t("surveys.templates.nps.scene"),
      definition: nps(t),
    },
    {
      id: "event",
      name: t("surveys.templates.event.name"),
      description: t("surveys.templates.event.desc"),
      scene: t("surveys.templates.event.scene"),
      definition: event(t),
    },
    {
      id: "baseline",
      name: t("surveys.templates.baseline.name"),
      description: t("surveys.templates.baseline.desc"),
      scene: t("surveys.templates.baseline.scene"),
      definition: baseline(t),
    },
    {
      id: "gse",
      name: t("surveys.templates.gse.name"),
      description: t("surveys.templates.gse.desc"),
      scene: t("surveys.templates.gse.scene"),
      definition: gse(t, language),
    },
    {
      id: "phq9",
      name: t("surveys.templates.phq9.name"),
      description: t("surveys.templates.phq9.desc"),
      scene: t("surveys.templates.phq9.scene"),
      definition: phq9(t, language),
    },
    {
      id: "gad7",
      name: t("surveys.templates.gad7.name"),
      description: t("surveys.templates.gad7.desc"),
      scene: t("surveys.templates.gad7.scene"),
      definition: gad7(t, language),
    },
    {
      id: "who5",
      name: t("surveys.templates.who5.name"),
      description: t("surveys.templates.who5.desc"),
      scene: t("surveys.templates.who5.scene"),
      definition: who5(t, language),
    },
  ];
}
