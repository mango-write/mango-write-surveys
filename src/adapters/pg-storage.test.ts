import { describe, expect, it, vi } from "vitest";

const { poolSql, txTag } = vi.hoisted(() => {
  const txTag = vi.fn(async (strings: TemplateStringsArray) => {
    const sqlText = strings.join("");
    if (sqlText.includes("count(*)")) {
      return [{ n: 3 }];
    }
    return [];
  });
  const poolSql = Object.assign(
    vi.fn(async () => {
      throw new Error("pool sql must not be called inside withSurveyLock");
    }),
    {
      begin: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(txTag)),
      end: vi.fn(async () => undefined),
    },
  );
  return { poolSql, txTag };
});

vi.mock("postgres", () => ({
  default: () => poolSql,
}));

import { createPgStorage } from "./pg-storage.js";

describe("pg-storage makeLock.countStarted (R2-P1-11)", () => {
  it("withSurveyLock 锁内 countStarted 直接走事务连接 tx 而非池级 sql", async () => {
    const storage = createPgStorage("postgres://unit-test");
    const count = await storage.withSurveyLock("00000000-0000-4000-8000-000000000001", async (tx) => {
      return tx.countStarted("00000000-0000-4000-8000-000000000001");
    });

    expect(count).toBe(3);
    expect(poolSql).not.toHaveBeenCalled();
    expect(txTag).toHaveBeenCalledTimes(2); // FOR UPDATE + countStarted
  });
});
