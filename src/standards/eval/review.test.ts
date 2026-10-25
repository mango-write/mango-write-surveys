import { describe, expect, it } from "vitest";
import { edgeCases } from "./edge.js";
import { buildBlindEdgePacket, summarizeReviewDecisions, type ReviewDecision } from "./review.js";

const decision = (findingId: string, verdict: ReviewDecision["verdict"]): ReviewDecision => ({
  findingId,
  verdict,
  basis: "agent_judgment",
  evidence: verdict === "unresolved" ? [] : [{
    url: "https://aapor.org/standards-and-ethics/best-practices/",
    locator: "Designing your questionnaire",
    reasoning: "原文原则结合题目适用条件，记录支持或反对理由。",
  }],
});

describe("Agent 审查口径", () => {
  it("盲审输入只含匿名编号、情境与待判主张，不泄露答案或理由", () => {
    const entry = { ...edgeCases[0], rationale: "secret-answer-rationale" };
    const packet = buildBlindEdgePacket([entry]);
    expect(packet).toEqual([{
      id: "case-001", situation: entry.situation, reviewQuestion: entry.reviewQuestion,
    }]);
    expect(JSON.stringify(packet)).not.toContain("secret-answer-rationale");
    expect(JSON.stringify(packet)).not.toContain(entry.id);
  });

  it("目录外未决发现仍进入分母，同题不同问题分别计数", () => {
    const result = summarizeReviewDecisions([
      decision("q1:leading", "supported"),
      decision("q1:double_barrel", "rejected"),
      decision("q2:outside_catalog", "unresolved"),
    ]);
    expect(result).toMatchObject({
      total: 3, supported: 1, rejected: 1, unresolved: 1,
      reviewCoverage: 2 / 3, supportRateLowerBound: 1 / 3,
      supportRateUpperBound: 2 / 3, resolvedSupportRate: 1 / 2,
      byBasis: { source_verified: 0, agent_judgment: 3, human_data: 0 },
    });
  });

  it("无裁决时不伪造准确率，空集合不可计算", () => {
    expect(summarizeReviewDecisions([decision("unknown", "unresolved")])).toMatchObject({
      supportRateLowerBound: 0, supportRateUpperBound: 1, resolvedSupportRate: null,
    });
    expect(summarizeReviewDecisions([])).toMatchObject({
      reviewCoverage: null, supportRateLowerBound: null, supportRateUpperBound: null,
    });
  });

  it("拒绝重复问题与无证据定论", () => {
    expect(() => summarizeReviewDecisions([
      decision("q1:leading", "supported"), decision("q1:leading", "supported"),
    ])).toThrow("duplicate_review_finding");
    expect(() => summarizeReviewDecisions([
      { ...decision("q1:leading", "supported"), evidence: [] },
    ])).toThrow();
  });
});
