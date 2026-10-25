// code 是稳定错误契约；数据库约束细节不得透传。
import type { SurveyIssue } from "../core/index.js";

export class SurveyError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string,
    readonly issues?: SurveyIssue[],
  ) {
    super(message ?? code);
    this.name = "SurveyError";
  }
}
