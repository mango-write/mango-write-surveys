<script setup lang="ts">
// AI 建卷浮动面板（独立站最小 Copilot 的 UI 面）：标题 + 需求简述 → 服务端
// /api/ai/generate（生成 + 幂等建卷一次完成）→ 成功后经宿主 copilot 桥把
// survey_create 交付帧交给当前页面处理（导航进工作区，与主站同一条链）。
// 提交失败保留 operationId：网络重试复用同一操作身份，服务端不会重复建卷。
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";

import type { ToolSurveyDelivery } from "@mango-write/surveys/vue";

import type { StandaloneAiState } from "./standalone-copilot";

const { t } = useI18n();
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
    props.state.error = t("standalone.aiRequired");
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
        props.state.error = t("standalone.aiUnavailable");
        operationId = null;
      } else {
        props.state.error = value?.detail ?? t("standalone.aiFailed");
      }
      return;
    }
    if (!value?.surveyId) {
      props.state.error = t("standalone.aiFailed");
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
    props.state.error = t("standalone.networkError");
  } finally {
    props.state.busy = false;
  }
}
</script>

<template>
  <div v-if="state.open" class="ai-panel" role="dialog" :aria-label="t('standalone.aiTitle')">
    <header class="ai-panel__head">
      <span>{{ t("standalone.aiTitle") }}</span>
      <Button
        icon="pi pi-times"
        text
        severity="secondary"
        :aria-label="t('standalone.close')"
        :disabled="state.busy"
        @click="close"
      />
    </header>
    <label class="ai-panel__field">
      <span>{{ t("standalone.surveyTitle") }}</span>
      <InputText v-model="state.title" :disabled="state.busy" :placeholder="t('standalone.titleExample')" fluid />
    </label>
    <label class="ai-panel__field">
      <span>{{ t("standalone.brief") }}</span>
      <Textarea
        v-model="state.brief"
        :disabled="state.busy"
        rows="6"
        auto-resize
        :placeholder="t('standalone.briefExample')" fluid
      />
    </label>
    <p v-if="state.error" class="ai-panel__error">{{ state.error }}</p>
    <footer class="ai-panel__foot">
      <Button
        :label="t('standalone.generate')"
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
