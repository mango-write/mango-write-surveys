<script setup lang="ts">
// AI 建卷浮动面板（独立站最小 Copilot 的 UI 面）：标题 + 需求简述 → 服务端
// /api/ai/generate（生成 + 幂等建卷一次完成）→ 成功后经宿主 copilot 桥把
// survey_create 交付帧交给当前页面处理（导航进工作区，与主站同一条链）。
// 提交失败保留 operationId：网络重试复用同一操作身份，服务端不会重复建卷。
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";

import type { ToolSurveyDelivery } from "@mango-write/surveys/vue";

import type { StandaloneAiState } from "./standalone-copilot";

const props = defineProps<{ state: StandaloneAiState }>();
const emit = defineEmits<{ delivery: [delivery: ToolSurveyDelivery] }>();

let operationId: string | null = null;

function close() {
  if (props.state.busy) return;
  props.state.open = false;
}

async function generate() {
  const title = props.state.title.trim();
  const brief = props.state.brief.trim();
  if (!title || !brief) {
    props.state.error = "请填写问卷标题与需求简述。";
    return;
  }
  props.state.busy = true;
  props.state.error = null;
  // 同一次提交（含失败重试）恒用同一操作身份；成功或放弃（关闭面板）后重置。
  operationId ??= crypto.randomUUID();
  const usedOperationId = operationId;
  try {
    const response = await fetch("/api/ai/generate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, brief, operationId: usedOperationId }),
    });
    const value = (await response.json().catch(() => null)) as {
      surveyId?: string;
      detail?: string;
    } | null;
    if (!response.ok) {
      if (response.status === 503) {
        props.state.error = "AI 未配置：请在服务端设置 SURVEYS_AI_URL / _API_KEY / _MODEL。";
        operationId = null;
      } else {
        props.state.error = value?.detail ?? "生成失败，请调整描述后重试（重试不会重复建卷）。";
      }
      return;
    }
    if (!value?.surveyId) {
      props.state.error = "生成失败，请重试。";
      return;
    }
    operationId = null;
    props.state.open = false;
    emit("delivery", {
      type: "survey_create",
      surveyId: value.surveyId,
      operationId: usedOperationId,
      title,
    });
  } catch {
    props.state.error = "网络错误，可直接重试（不会重复建卷）。";
  } finally {
    props.state.busy = false;
  }
}
</script>

<template>
  <div v-if="state.open" class="ai-panel" role="dialog" aria-label="AI 生成问卷">
    <header class="ai-panel__head">
      <span>AI 生成问卷</span>
      <Button
        icon="pi pi-times"
        text
        severity="secondary"
        size="small"
        aria-label="关闭"
        :disabled="state.busy"
        @click="close"
      />
    </header>
    <label class="ai-panel__field">
      <span>问卷标题</span>
      <InputText v-model="state.title" :disabled="state.busy" placeholder="如：科研工具使用习惯调查" />
    </label>
    <label class="ai-panel__field">
      <span>需求简述</span>
      <Textarea
        v-model="state.brief"
        :disabled="state.busy"
        rows="6"
        auto-resize
        placeholder="研究主题、目标人群、期望题量、是否需要知情同意说明…"
      />
    </label>
    <p v-if="state.error" class="ai-panel__error">{{ state.error }}</p>
    <footer class="ai-panel__foot">
      <Button
        label="生成"
        :loading="state.busy"
        @click="generate"
      />
    </footer>
  </div>
</template>

<style scoped>
.ai-panel {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  width: min(360px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--p-content-border-color, #ddd);
  background: var(--p-content-background, #fff);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
}
.ai-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}
.ai-panel__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: var(--p-text-muted-color, #666);
}
.ai-panel__error {
  margin: 0;
  font-size: 12.5px;
  color: var(--p-red-500, #e02424);
  overflow-wrap: anywhere;
}
.ai-panel__foot {
  display: flex;
  justify-content: flex-end;
}
</style>
