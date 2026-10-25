import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SurveysApiError } from "../host.js";

import {
  useSurveyAutosave,
  type SurveyAutosaveOptions,
} from "./useSurveyAutosave";
import type { SurveyDraftState } from "./useSurveyDraftHistory";

function stateOf(title: string): SurveyDraftState {
  return {
    definition: {
      version: 1,
      title,
      description: "",
      consent: "",
      questions: [],
      pages: [],
    },
    responseLimit: 100,
  };
}

function makeOptions(
  overrides: Partial<SurveyAutosaveOptions> = {},
): SurveyAutosaveOptions & { saved: SurveyDraftState[] } {
  const saved: SurveyDraftState[] = [];
  let version = 1;
  return {
    saved,
    getState: () => stateOf("current"),
    getVersion: () => version,
    setVersion: (v) => (version = v),
    save: async (state) => {
      saved.push(state);
      return version + 1;
    },
    enabled: () => true,
    debounceMs: 1500,
    ...overrides,
  };
}

async function tickSave() {
  // run() 内部 await inflight；微任务排空让保存落地。
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSurveyAutosave", () => {
  it("schedule 防抖 1.5s 后保存一次；连续变更只发一发", async () => {
    const options = makeOptions();
    const autosave = useSurveyAutosave(options);
    expect(autosave.status.value).toBe("idle");

    autosave.schedule();
    expect(autosave.status.value).toBe("pending");
    await vi.advanceTimersByTimeAsync(1499);
    expect(options.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    await tickSave();
    expect(options.saved).toHaveLength(1);
    expect(autosave.status.value).toBe("saved");

    // 保存后的新变更再排一发。
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(1600);
    await tickSave();
    expect(options.saved).toHaveLength(2);
  });

  it("flush 立即落盘并返回结果；无脏内容时不动", async () => {
    const options = makeOptions();
    const autosave = useSurveyAutosave(options);
    autosave.schedule();
    expect(await autosave.flush()).toBe(true);
    expect(options.saved).toHaveLength(1);

    options.save = vi
      .fn<(state: SurveyDraftState, expectedVersion: number) => Promise<number>>()
      .mockRejectedValueOnce(new SurveysApiError(500, "server", null))
      .mockResolvedValue(9);
    autosave.schedule();
    expect(await autosave.flush()).toBe(false);
    expect(autosave.status.value).toBe("error");
    expect(autosave.hasUnsaved()).toBe(true);

    autosave.retry();
    await tickSave();
    expect(autosave.status.value).toBe("saved");
    expect(autosave.hasUnsaved()).toBe(false);
  });

  it("409 → conflict 终态：不再自动保存，直到 settled", async () => {
    const options = makeOptions();
    const autosave = useSurveyAutosave(options);
    options.save = vi.fn(async () => {
      throw new SurveysApiError(409, "version_conflict", null);
    });
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(1600);
    await tickSave();
    expect(autosave.status.value).toBe("conflict");
    expect(autosave.hasUnsaved()).toBe(true);

    // 冲突后 schedule 是 no-op：绝不覆盖其他窗口的修改。
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(5000);
    expect(options.save).toHaveBeenCalledTimes(1);

    autosave.settled();
    expect(autosave.hasUnsaved()).toBe(false);
    expect(autosave.status.value).toBe("idle");
  });

  it("保存期间的新变更在其落地后再排一发（单飞不并发）", async () => {
    const gates: Array<(v: number) => void> = [];
    const options = makeOptions();
    options.save = (state, expectedVersion) =>
      new Promise<number>((resolve) => {
        gates.push(() => resolve(expectedVersion + 1));
        void state;
      });
    const release = (v: number) => gates.shift()!(v);
    const autosave = useSurveyAutosave(options);

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    expect(autosave.status.value).toBe("saving");

    // 在途期间又改了一次。
    autosave.schedule();
    expect(autosave.status.value).toBe("pending");
    release(2);
    await tickSave();
    // 第一发落地后 dirty 仍在 → 状态回到 pending，第二发在计时器里排队。
    expect(autosave.status.value).toBe("pending");
    await vi.advanceTimersByTimeAsync(1600);
    expect(autosave.status.value).toBe("saving");
    release(3);
    await tickSave();
    expect(gates).toHaveLength(0);
    expect(autosave.status.value).toBe("saved");
  });

  it("enabled=false（只读）不触发保存", async () => {
    const options = makeOptions({ enabled: () => false });
    const autosave = useSurveyAutosave(options);
    autosave.schedule();
    expect(autosave.status.value).toBe("idle");
    await vi.advanceTimersByTimeAsync(5000);
    expect(options.saved).toHaveLength(0);
    expect(autosave.hasUnsaved()).toBe(false);
  });

  it("hasUnsaved 在在途保存期间也为真：此刻刷新会让 PATCH 半途而废", async () => {
    const gates: Array<(v: number) => void> = [];
    const options = makeOptions();
    options.save = (state, expectedVersion) =>
      new Promise<number>((resolve) => {
        gates.push(() => resolve(expectedVersion + 1));
        void state;
      });
    const autosave = useSurveyAutosave(options);
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    expect(autosave.status.value).toBe("saving");
    expect(autosave.hasUnsaved()).toBe(true);
    gates.shift()!(2);
    await tickSave();
    expect(autosave.hasUnsaved()).toBe(false);
  });

  it("flushBeacon：仅在确有未落盘内容时以当前快照同步发出，并清脏", () => {
    const beacons: Array<{ state: SurveyDraftState; expectedVersion: number }> = [];
    const options = makeOptions();
    let version = 7;
    options.getVersion = () => version;
    options.beacon = (state, expectedVersion) => {
      beacons.push({ state, expectedVersion });
    };
    const autosave = useSurveyAutosave(options);

    // 干净时不发。
    autosave.flushBeacon();
    expect(beacons).toHaveLength(0);

    autosave.schedule();
    expect(autosave.hasUnsaved()).toBe(true);
    autosave.flushBeacon();
    expect(beacons).toHaveLength(1);
    expect(beacons[0]!.expectedVersion).toBe(7);
    // 发出即视为已交给浏览器：不再重复发，也不再挡离开。
    autosave.flushBeacon();
    expect(beacons).toHaveLength(1);
    expect(autosave.hasUnsaved()).toBe(false);
  });

  it("flushBeacon 在 conflict 终态与禁用时不发", async () => {
    const beacons: unknown[] = [];
    const options = makeOptions();
    options.save = vi.fn(async () => {
      throw new SurveysApiError(409, "version_conflict", null);
    });
    options.beacon = () => beacons.push(1);
    const autosave = useSurveyAutosave(options);
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(1600);
    await tickSave();
    expect(autosave.status.value).toBe("conflict");
    autosave.schedule();
    autosave.flushBeacon();
    expect(beacons).toHaveLength(0);
  });
});
