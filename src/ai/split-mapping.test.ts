import { describe, expect, it } from "vitest";
import { connectSplitQuestions } from "./split-mapping.js";
import { applySurveyOps, unresolvedReviewChoice, type SurveyDefinition } from "../core/index.js";
import type { SurveyReviewFinding } from "../contracts/index.js";

const definition: SurveyDefinition = {
  version: 1, title: "调查", description: "", consent: "",
  questions: [{ id: "q1", type: "text", title: "教学和练习如何？", required: false }, { id: "q3", type: "text", title: "其他建议", required: false }],
  pages: [{ id: "p1", title: "问题", questionIds: ["q1", "q3"] }],
  researchDesign: { researchQuestion: "了解教学和练习", population: "已有的人群", recruitment: "", analysisPlan: "描述", assumptions: [], pendingDecisions: ["招募待确认"],
    constructs: [{ id: "c1", label: "课程体验", definition: "教学和练习", questionIds: ["q1"] }] },
};

function split(): SurveyReviewFinding {
  return { id: "f1", checkId: "wording.double_barrel", questionId: "q1", title: "拆题", severity: "major", reason: "两件事", recommendation: "分别提问",
    suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "教学如何？" } },
      { op: "add_question", pageId: "p1", question: { id: "q2", type: "text", title: "练习如何？", required: false } },
      { op: "set_meta", consent: "模型编造的同意说明", description: "模型编造的说明", researchDesign: { ...definition.researchDesign!, population: "模型虚构的人群" } }] };
}

describe("拆题与研究用途", () => {
  it("只有唯一用途时沿用原设计，忽略模型附带的无关设计改写", () => {
    const finding = split();
    connectSplitQuestions(finding, definition);
    const result = applySurveyOps(definition, finding.suggestedOps!);
    expect(result.rejected).toEqual([]);
    expect(result.definition.researchDesign?.population).toBe("已有的人群");
    expect(result.definition.consent).toBe("");
    expect(result.definition.description).toBe("");
    expect(result.definition.researchDesign?.constructs[0]?.questionIds).toEqual(["q1", "q2"]);
    expect(result.definition.pages[0]?.questionIds).toEqual(["q1", "q2", "q3"]);
    expect(unresolvedReviewChoice(finding.suggestedOps!, definition)).toBeNull();
  });
  it("原题属于多个用途或操作涉及其他题时，不猜映射", () => {
    const ambiguous = structuredClone(definition);
    ambiguous.researchDesign!.constructs.push({ id: "c2", label: "其他", definition: "其他", questionIds: ["q1"] });
    const finding = split();
    const original = structuredClone(finding.suggestedOps);
    connectSplitQuestions(finding, ambiguous);
    expect(finding.suggestedOps).toEqual(original);
    finding.suggestedOps!.push({ op: "set_meta", consent: "匿名" });
    connectSplitQuestions(finding, definition);
    expect(finding.suggestedOps!.at(-1)).toEqual({ op: "set_meta", consent: "匿名" });
  });
});
