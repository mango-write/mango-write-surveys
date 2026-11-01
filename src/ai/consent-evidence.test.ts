import { describe, expect, it } from "vitest";
import { hasUnverifiedConsentClaim } from "./consent-evidence.js";

describe("建卷参与说明的依据", () => {
  it("不把不收集身份信息推导成匿名或保密", () => {
    expect(hasUnverifiedConsentClaim("问卷匿名，资料保密", ["不收集姓名等个人身份信息"])).toBe(true);
    expect(hasUnverifiedConsentClaim("问卷匿名", ["数据不是匿名的"])).toBe(true);
    expect(hasUnverifiedConsentClaim("Your answers are anonymous", ["The answers are not anonymous"])).toBe(true);
    expect(hasUnverifiedConsentClaim("问卷匿名", ["匿名方式是否可行待确认"])).toBe(true);
    expect(hasUnverifiedConsentClaim("问卷匿名", ["可以匿名吗？"])).toBe(true);
  });
  it("用户明确给出依据时保留承诺，并分别检查不同处理方式", () => {
    expect(hasUnverifiedConsentClaim("问卷匿名", ["本研究采用匿名问卷"])).toBe(false);
    expect(hasUnverifiedConsentClaim("数据匿名且加密", ["本研究采用匿名问卷"])).toBe(true);
    expect(hasUnverifiedConsentClaim("参与自愿，可随时退出", [])).toBe(false);
    expect(hasUnverifiedConsentClaim("数据仅用于汇总分析", [])).toBe(true);
    expect(hasUnverifiedConsentClaim("数据仅用于汇总分析", ["数据仅用于汇总分析"])).toBe(false);
    expect(hasUnverifiedConsentClaim("数据仅用于汇总分析", ["不要写仅用于汇总分析"])).toBe(true);
    expect(hasUnverifiedConsentClaim("本问卷用于学术研究", [])).toBe(true);
    expect(hasUnverifiedConsentClaim("本问卷用于了解研究生的学习情况", [])).toBe(false);
    expect(hasUnverifiedConsentClaim("本问卷用于组内学术交流，旨在了解认同情况", [])).toBe(true);
    expect(hasUnverifiedConsentClaim("本问卷用于组内学术交流", ["结果用于组内学术交流"])).toBe(false);
    expect(hasUnverifiedConsentClaim("结果将向导师汇报", [])).toBe(true);
    expect(hasUnverifiedConsentClaim("数据为教学改进提供参考", [])).toBe(true);
    expect(hasUnverifiedConsentClaim("退出不会带来任何不利影响", [])).toBe(true);
    expect(hasUnverifiedConsentClaim("退出不会带来任何不利影响", ["退出不会带来任何不利影响"])).toBe(false);
  });
});
