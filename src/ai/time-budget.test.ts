import { expect, it } from "vitest";
import { hasExplicitTimeBudget } from "./time-budget.js";

it("只将用户明确给出的填写时间作为限制", () => {
  expect(hasExplicitTimeBudget(8, ["填写时间不超过8分钟"])).toBe(true);
  expect(hasExplicitTimeBudget(5, ["请在五分钟内完成问卷"])).toBe(true);
  expect(hasExplicitTimeBudget(8, ["调查过去8分钟的活动"])).toBe(false);
  expect(hasExplicitTimeBudget(8, ["无需在8分钟内完成"])).toBe(false);
  expect(hasExplicitTimeBudget(8, ["作答不要超过8分钟"])).toBe(true);
  expect(hasExplicitTimeBudget(5, ["填写时间不超过15分钟"])).toBe(false);
  expect(hasExplicitTimeBudget(1, ["填写时间不超过十一分钟"])).toBe(false);
  expect(hasExplicitTimeBudget(5, ["finish in five minutes"])).toBe(true);
  expect(hasExplicitTimeBudget(5, ["do not finish in five minutes"])).toBe(false);
});
