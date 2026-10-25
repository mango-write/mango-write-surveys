// 草稿自动保存（issue #217）：变更后防抖 PATCH（expectedVersion 乐观锁）。
// 状态机：idle → pending（防抖中）→ saving → saved / error / conflict。
// 同一时刻只有一发在途；在途期间的新变更会在其落地后再次排队。conflict 是
// 终态（不再自动保存），必须由用户重新加载解决——绝不覆盖其他窗口的修改。
import { ref } from "vue";

import { SurveysApiError } from "../host.js";

import type { SurveyDraftState } from "./useSurveyDraftHistory";

export type SurveySaveStatus =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  | "error"
  | "conflict";

export interface SurveyAutosaveOptions {
  getState: () => SurveyDraftState;
  getVersion: () => number;
  setVersion: (version: number) => void;
  /** 返回服务端新 draftVersion。 */
  save: (
    state: SurveyDraftState,
    expectedVersion: number,
  ) => Promise<number>;
  /** canWrite=false（只读者/已关闭）时不保存。 */
  enabled: () => boolean;
  debounceMs?: number;
  /**
   * pagehide 时的同步落盘通道（fetch keepalive）：不等响应、发完即走。给出即
   * 启用 flushBeacon()；失败静默——它只是卸载瞬间的尽力而为，不是常规保存。
   */
  beacon?: (state: SurveyDraftState, expectedVersion: number) => void;
}

export function useSurveyAutosave(options: SurveyAutosaveOptions) {
  const status = ref<SurveySaveStatus>("idle");
  const savedAt = ref<Date | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let dirty = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    if (!options.enabled() || status.value === "conflict") return;
    dirty = true;
    clearTimer();
    status.value = "pending";
    timer = setTimeout(() => void run(), options.debounceMs ?? 1500);
  }

  async function run(): Promise<void> {
    if (inflight) await inflight;
    clearTimer();
    if (!dirty || !options.enabled() || status.value === "conflict") {
      if (!dirty && status.value === "pending") status.value = "saved";
      return;
    }
    dirty = false;
    status.value = "saving";
    inflight = (async () => {
      try {
        const version = await options.save(
          options.getState(),
          options.getVersion(),
        );
        options.setVersion(version);
        savedAt.value = new Date();
        status.value = dirty ? "pending" : "saved";
      } catch (cause) {
        // 没存上仍是脏的：错误态下离开保护依然拦。
        dirty = true;
        const code =
          cause instanceof SurveysApiError ? cause.code : undefined;
        if (
          code === "version_conflict" ||
          code === "survey_version_conflict"
        ) {
          status.value = "conflict";
        } else {
          status.value = "error";
        }
      } finally {
        inflight = null;
      }
    })();
    await inflight;
  }

  /** 立即落盘（发布前、离开路由前）。返回是否已无未保存内容。 */
  async function flush(): Promise<boolean> {
    clearTimer();
    await run();
    return (
      !dirty && status.value !== "error" && status.value !== "conflict"
    );
  }

  function retry(): void {
    if (status.value !== "error") return;
    void run();
  }

  /**
   * pagehide（刷新/关闭/进 bfcache）瞬间的尽力落盘：keepalive 发出即返回，
   * 不等响应。仅在确有未落盘内容时发；响应无人消费，版本号照常单调。
   */
  function flushBeacon(): void {
    if (!options.beacon || !dirty || !options.enabled() || status.value === "conflict")
      return;
    dirty = false;
    clearTimer();
    options.beacon(options.getState(), options.getVersion());
  }

  /** 服务端回包（load / 冲突重载）对齐本地状态后调用：清脏与计时。 */
  function settled(): void {
    clearTimer();
    dirty = false;
    inflight = null;
    status.value = "idle";
    savedAt.value = null;
  }

  /** 有内容未落盘（防抖中 / 在途 / 失败）——离开保护与 beforeunload 认它。
   *  在途也算：此刻刷新会让 PATCH 半途而废，服务端停留在更旧的正文。 */
  function hasUnsaved(): boolean {
    return dirty || status.value === "error" || status.value === "saving";
  }

  return {
    status,
    savedAt,
    schedule,
    flush,
    retry,
    settled,
    flushBeacon,
    hasUnsaved,
  };
}
