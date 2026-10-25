import { describe, expect, it } from "vitest";

import {
  ResearchCsvError,
  autoMapColumns,
  findDuplicateColumn,
  parseCsvHead,
} from "./research-csv.js";

describe("parseCsvHead", () => {
  it("parses the header and counts data rows, tolerating quoted commas and BOM", () => {
    const csv = "\uFEFFid,score,\"note, extra\"\nr1,1,\"a\"\nr2,2,\"b, c\"";
    expect(parseCsvHead(csv)).toEqual({
      columns: ["id", "score", "note, extra"],
      rowCount: 2,
    });
  });

  it("treats CRLF and a trailing newline as normal records", () => {
    expect(parseCsvHead("a,b\r\n1,2\r\n3,4\r\n")).toEqual({
      columns: ["a", "b"],
      rowCount: 2,
    });
  });

  it("rejects the failure shapes the server also rejects", () => {
    expect(() => parseCsvHead("")).toThrow(ResearchCsvError);
    expect(() => parseCsvHead("")).toThrow(
      new ResearchCsvError("empty"),
    );
    expect(() => parseCsvHead("a,,c\n1,2,3")).toThrow(
      new ResearchCsvError("empty_header"),
    );
    expect(() => parseCsvHead("a,a\n1,2")).toThrow(
      new ResearchCsvError("duplicate_header"),
    );
    expect(() => parseCsvHead('a\n"x')).toThrow(
      new ResearchCsvError("unclosed_quote"),
    );
    expect(() => parseCsvHead("a,b\n")).toThrow(
      new ResearchCsvError("no_data_row"),
    );
  });
});

describe("autoMapColumns", () => {
  const variables = [
    { id: "q1.r1", label: "满意度一" },
    { id: "q1.r2", label: "q1.r2" },
    { id: "q2", label: "购买意愿" },
    { id: "q3", label: "年龄" },
  ];

  it("matches exact id, then row/item id after the dot, then label", () => {
    // 列「q1.r2」同时是 q1.r2 的 exact 与 q1.r1 的 rowItem 候选：codebook 顺序
    // 在前（q1.r1）的 exact/label 优先不抢行 id；q1.r1 命中 exact 前先验证顺序。
    const suggestions = autoMapColumns(variables, [
      "q1.r1",
      "r2",
      "购买意愿",
      "年龄",
    ]);
    expect(suggestions).toEqual([
      { variableId: "q1.r1", column: "q1.r1", matched: "exact" },
      { variableId: "q1.r2", column: "r2", matched: "rowItem" },
      { variableId: "q2", column: "购买意愿", matched: "label" },
      { variableId: "q3", column: "年龄", matched: "label" },
    ]);
  });

  it("leaves conflicting columns to manual confirmation instead of double-using them", () => {
    const suggestions = autoMapColumns(
      [
        { id: "q1.r1", label: "A" },
        { id: "q1.r2", label: "B" },
      ],
      ["r1"],
    );
    expect(suggestions[0]).toEqual({
      variableId: "q1.r1",
      column: "r1",
      matched: "rowItem",
    });
    expect(suggestions[1]).toEqual({
      variableId: "q1.r2",
      column: null,
      matched: "none",
    });
  });
});

describe("findDuplicateColumn", () => {
  it("returns the first column mapped twice and ignores blanks", () => {
    expect(
      findDuplicateColumn([
        { variableId: "a", column: "x" },
        { variableId: "b", column: null },
        { variableId: "c", column: "x" },
      ]),
    ).toBe("x");
    expect(
      findDuplicateColumn([
        { variableId: "a", column: "x" },
        { variableId: "b", column: "y" },
      ]),
    ).toBeNull();
  });
});
