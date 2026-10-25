import { z } from "zod";
import type { EdgeCase } from "./schema.js";

export function buildBlindEdgePacket(cases: readonly EdgeCase[]) {
  return cases.map((entry, index) => ({
    id: `case-${String(index + 1).padStart(3, "0")}`,
    situation: entry.situation,
    reviewQuestion: entry.reviewQuestion,
  }));
}

const EvidenceSchema = z.object({
  url: z.string().url(),
  locator: z.string().min(1),
  reasoning: z.string().min(1),
});

export const ReviewDecisionSchema = z.object({
  findingId: z.string().min(1),
  verdict: z.enum(["supported", "rejected", "unresolved"]),
  basis: z.enum(["source_verified", "agent_judgment", "human_data"]),
  evidence: z.array(EvidenceSchema),
}).superRefine((entry, ctx) => {
  if (entry.verdict !== "unresolved" && entry.evidence.length === 0) {
    ctx.addIssue({ code: "custom", path: ["evidence"], message: "裁决须保留证据与推理" });
  }
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

// 这是证据支持率，不将 Agent 判断转换成准确率；未决保留在主分母（#224）。
export function summarizeReviewDecisions(raw: readonly ReviewDecision[]) {
  const entries = z.array(ReviewDecisionSchema).parse(raw);
  if (new Set(entries.map((entry) => entry.findingId)).size !== entries.length) {
    throw new Error("duplicate_review_finding");
  }
  const total = entries.length;
  const supported = entries.filter((entry) => entry.verdict === "supported").length;
  const rejected = entries.filter((entry) => entry.verdict === "rejected").length;
  const unresolved = total - supported - rejected;
  const resolved = supported + rejected;
  return {
    total,
    supported,
    rejected,
    unresolved,
    reviewCoverage: total === 0 ? null : resolved / total,
    supportRateLowerBound: total === 0 ? null : supported / total,
    supportRateUpperBound: total === 0 ? null : (supported + unresolved) / total,
    resolvedSupportRate: resolved === 0 ? null : supported / resolved,
    byBasis: {
      source_verified: entries.filter((entry) => entry.basis === "source_verified").length,
      agent_judgment: entries.filter((entry) => entry.basis === "agent_judgment").length,
      human_data: entries.filter((entry) => entry.basis === "human_data").length,
    },
  };
}
