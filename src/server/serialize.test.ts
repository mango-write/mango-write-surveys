// 纯函数层回归：这两个函数是「导出可信」与「幂等判据」的唯一实现，值得单测。

import { describe, expect, it } from "vitest";

import {
  buildCsv,
  canonicalJson,
  csvCell,
  hashAnswers,
  hashSessionToken,
  newSessionToken,
  newSurveySlug,
  sha256Hex,
} from "./serialize.js";

describe("会话凭证", () => {
  it("明文是 256bit URL-safe 随机，库里只落哈希", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    const hash = hashSessionToken(a);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(sha256Hex(a));
    expect(hash).not.toContain(a);
  });

  it("公开 slug 高熵且 URL-safe", () => {
    const slug = newSurveySlug();
    expect(slug).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(newSurveySlug()).not.toBe(slug);
  });
});

describe("答案哈希", () => {
  it("保留 JSON 自有键，不能让非法保留字段与合法答案共享哈希", () => {
    const answers = JSON.parse('{"q1":"x","__proto__":"x"}');
    expect(canonicalJson(answers)).toBe('{"__proto__":"x","q1":"x"}');
    expect(hashAnswers(answers)).not.toBe(hashAnswers({ q1: "x" }));
  });
  it("键序无关、内容敏感", () => {
    expect(hashAnswers({ a: "1", b: ["x", "y"] })).toBe(
      hashAnswers({ b: ["x", "y"], a: "1" }),
    );
    expect(hashAnswers({ a: "1" })).not.toBe(hashAnswers({ a: "2" }));
    expect(hashAnswers({ a: [1, 2] })).not.toBe(hashAnswers({ a: [2, 1] }));
  });

  it("canonicalJson 递归排序对象键、保留数组顺序", () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 0 })).toBe(
      '{"a":0,"b":{"c":2,"d":1}}',
    );
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("CSV 导出", () => {
  it("公式前缀被中和，数值不加引号", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+34")).toBe("'+34");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(null)).toBe("");
  });

  it("逗号/引号/换行按 RFC 4180 转义", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("列序由调用方给定，不随行内键序漂移", () => {
    const csv = buildCsv(
      ["q1", "q2"],
      [
        ["a", 1],
        ["b", null],
      ],
    );
    expect(csv.startsWith("\uFEFFq1,q2\r\n")).toBe(true);
    expect(csv).toBe("\uFEFFq1,q2\r\na,1\r\nb,\r\n");
  });
});
