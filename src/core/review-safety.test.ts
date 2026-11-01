import { describe, expect, it } from "vitest";
import { humanizeReviewText, sanitizeReviewImpact, sanitizeReviewRecommendation, unresolvedReviewChoice } from "./review-safety.js";
import type { SurveyDefinition } from "../contracts/index.js";

const definition: SurveyDefinition = {
  version: 1, title: "调查", description: "", consent: "",
  questions: [{ id: "q1", type: "text", title: "补充意见", required: false }],
  pages: [{ id: "p1", title: "问题", questionIds: ["q1"] }],
};

describe("AI 建议中的研究取舍", () => {
  it("将选答改为必答或重排题目时转为人工判断", () => {
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { required: true } }], definition)).toBe("required");
    expect(unresolvedReviewChoice([{ op: "move_question", questionId: "q1", toPageId: "p1", index: 0 }], definition)).toBe("order");
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { title: "其他意见（例如方法、工具）" } }], definition)).toBe("scope");
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { title: "其他意见" } }], definition)).toBeNull();
    expect(unresolvedReviewChoice([{ op: "set_meta", description: "补写同意文案", consent: "匿名且仅用于汇总" }], definition)).toBe("metadata");
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { options: [{ id: "other", label: "其他（请注明）" }] } }], definition)).toBe("specify");
  });

  it("来源快照中已经删掉的时间范围不能当作当前问卷的确认依据", () => {
    const withOldSource = { ...definition, sourceRecords: [{ sourceId: "sus-brooke-1996", questionId: "q1", language: "zh-CN", baselineQuestion: '{"title":"过去三个月"}' }] };
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { title: "过去三个月的补充意见" } }], withOldSource)).toBe("period");
  });
  it("题干与同意选项不匹配、变更跳题或破坏既有条件时转为人工核对", () => {
    const choice: SurveyDefinition = { ...definition, questions: [
      { id: "q1", type: "single", title: "你是否同意？", required: false, options: [{ id: "yes", label: "同意" }, { id: "no", label: "不同意" }] },
      { id: "q2", type: "text", title: "为什么？", required: false, showIf: { questionId: "q1", op: "eq", value: "yes" } },
    ], pages: [{ id: "p1", title: "问题", questionIds: ["q1", "q2"] }] };
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { title: "你如何评价？" } }], choice)).toBe("response_format");
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { title: "你同意这项服务有帮助吗？" } }], choice)).toBeNull();
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q2", patch: { showIf: { questionId: "q1", op: "eq", value: "no" } } }], choice)).toBe("routing");
    expect(unresolvedReviewChoice([{ op: "update_question", questionId: "q1", patch: { options: [{ id: "no", label: "不同意" }] } }], choice)).toBe("structure");
  });
  it("拆题后不能丢失原有研究用途到题目的映射", () => {
    const design: SurveyDefinition = { ...definition, researchDesign: {
      researchQuestion: "了解意见", population: "", recruitment: "", analysisPlan: "描述", assumptions: [], pendingDecisions: [],
      constructs: [{ id: "c1", label: "意见", definition: "意见", questionIds: ["q1"] }],
    } };
    expect(unresolvedReviewChoice([{ op: "remove_question", questionId: "q1" }, { op: "add_question", pageId: "p1", question: { id: "q2", type: "text", title: "新问题", required: false } }], design)).toBe("mapping");
    expect(unresolvedReviewChoice([{ op: "add_question", pageId: "p1", question: { id: "q2", type: "text", title: "新问题", required: false } }], design)).toBe("mapping");
    const updatedDesign = { ...design.researchDesign!, constructs: [{ ...design.researchDesign!.constructs[0]!, questionIds: ["q1", "q2"] }] };
    expect(unresolvedReviewChoice([{ op: "add_question", pageId: "p1", question: { id: "q2", type: "text", title: "新问题", required: false } }, { op: "set_meta", researchDesign: updatedDesign }], design)).toBeNull();
    expect(unresolvedReviewChoice([{ op: "set_meta", researchDesign: { ...updatedDesign, population: "模型猜的人群" } }], design)).toBe("metadata");
  });
});

describe("建议交付状态", () => {
  it("向作者展示研究用途而不是内部构念编号", () => {
    expect(humanizeReviewText("c2 构念与构念 c3 的题目需要更新。")).toBe("研究用途与研究用途的题目需要更新。");
  });
  it("没有数据时不把系统性偏差写成已发生", () => {
    expect(sanitizeReviewImpact("预设让同意率系统性偏高，结果不可用。" )).toContain("可能影响");
    expect(sanitizeReviewImpact("次数分布被系统性歪曲。")).toContain("可能影响");
    expect(sanitizeReviewImpact("单选次数分布重复计数。", true)).toContain("可能影响");
    expect(sanitizeReviewImpact("受访者无法选择两个不同的选项。")).toBe("受访者无法选择两个不同的选项。");
  });
  it("移除没有操作时声称已附上、以及尚未确认就声称已应用的句子", () => {
    expect(sanitizeReviewRecommendation("增加不适用选项；也可先筛选。出口方案可直接应用，我已附上。", false)).toBe("增加不适用选项；也可先筛选。");
    expect(sanitizeReviewRecommendation("先确认研究问题；我已按现有内容填入设计。", false)).toBe("先确认研究问题；");
    expect(sanitizeReviewRecommendation("建议调整题干。我已应用修改。", true)).toBe("建议调整题干。");
    expect(sanitizeReviewRecommendation("顺序需要确认，未自动修改。", false)).toBe("顺序需要确认，未自动修改。");
    expect(sanitizeReviewRecommendation("我已附上。", false)).toContain("手动调整");
    expect(sanitizeReviewRecommendation("I have attached it.", false)).toContain("manually");
  });
});
