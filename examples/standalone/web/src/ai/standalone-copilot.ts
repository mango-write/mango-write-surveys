// 独立站 Copilot 桥：建卷使用 App 级浮动面板；专业审查经 sendPrompt 调真实
// 服务端链路，交付帧回到包页面既有处理器，不另造审查 UI。
import { reactive } from "vue";

import { ToolSurveyDeliverySchema } from "@mango-write/surveys/contracts";
import {
  SurveysApiError,
  type SurveysCopilotHandlers,
  type SurveysCopilotHost,
  type SurveysCopilotSurface,
  type ToolSurveyDelivery,
} from "@mango-write/surveys/vue";

export interface StandaloneAiState {
  open: boolean;
  title: string;
  brief: string;
  busy: boolean;
  error: string | null;
}

export function createStandaloneCopilot(): {
  host: SurveysCopilotHost;
  state: StandaloneAiState;
  emitDelivery: (delivery: ToolSurveyDelivery) => void;
} {
  const state = reactive<StandaloneAiState>({
    open: false,
    title: "",
    brief: "",
    busy: false,
    error: null,
  });
  let handlers: SurveysCopilotHandlers | null = null;
  let surface: (() => SurveysCopilotSurface | null) | null = null;
  const host: SurveysCopilotHost = {
    registerHandlers(next, opts) {
      handlers = next;
      surface = opts?.surface ?? null;
      return () => {
        if (handlers !== next) return;
        handlers = null;
        surface = null;
      };
    },
    setContextRefs() {},
    fillComposer(text) {
      state.brief = text;
      state.open = true;
    },
    focusComposer() {
      state.open = true;
    },
    async sendPrompt(text, toolNames) {
      if (!toolNames?.includes("survey_review")) {
        host.fillComposer(text);
        host.focusComposer();
        return;
      }
      const scope = surface?.();
      if (!scope) throw new Error("survey_scope_missing");
      state.busy = true;
      state.error = null;
      try {
        const response = await fetch("/api/ai/review", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surveyId: scope.id, operationId: crypto.randomUUID(), prompt: text }),
        });
        const value: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new SurveysApiError(response.status, "review_failed", value);
        const delivery = ToolSurveyDeliverySchema.safeParse(value);
        if (!delivery.success || delivery.data.type !== "survey_review") {
          throw new Error("invalid_review_response");
        }
        if (surface?.()?.id === scope.id) handlers?.onSurveyDeliveryFrame?.(delivery.data);
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        state.busy = false;
      }
    },
    releasePageState() {
      state.error = null;
    },
  };
  return {
    host,
    state,
    emitDelivery: (delivery) => void handlers?.onSurveyDeliveryFrame?.(delivery),
  };
}
