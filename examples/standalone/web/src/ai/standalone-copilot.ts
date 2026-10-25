// 独立站最小 Copilot（issue #223 §6 验收）：实现包的 SurveysCopilotHost 契约，
// 但不自带对话岛——UI 是 App 级浮动面板（标题 + 需求简述 → POST /api/ai/generate
// → 服务端生成 + 幂等建卷 → 经包页注册的交付处理链导航进工作台）。
// 交付帧出口与页面处理器走和主站同一条 registerHandlers 缝，包页面不改。
import { reactive } from "vue";

import type {
  SurveysCopilotHandlers,
  SurveysCopilotHost,
  ToolSurveyDelivery,
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
  const host: SurveysCopilotHost = {
    registerHandlers(next) {
      handlers = next;
      return () => {
        handlers = null;
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
