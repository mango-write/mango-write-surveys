<script setup lang="ts">
// AI 建卷起点（issue #224 M3）：列表页唯一主创建入口，hero（首访空态）与
// compact（返回态紧凑卡）两种密度共用同一业务逻辑。提交经 host.copilot——
// 有 sendPrompt 直接发送，无则 fillComposer+focus 落到对话输入框；survey_create
// 交付帧的交接与导航仍归页面既有 handler，本组件不感知。防重复提交由 busy 闸
// 保证；发送失败提示并保留输入；不伪造生成进度——pending 文案只陈述「已发送」。
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Message from "primevue/message";
import Textarea from "primevue/textarea";
import { Sparkles } from "lucide-vue-next";
import { useSurveysHost } from "../host.js";

const props = defineProps<{ variant?: "hero" | "compact" }>();
defineEmits<{ pickTemplate: []; createBlank: [] }>();

const { t } = useI18n();
const host = useSurveysHost();

const hero = computed(() => (props.variant ?? "hero") === "hero");
const idea = ref("");
const busy = ref(false);
const failed = ref(false);
const awaiting = ref(false);
const hasCopilot = computed(() => !!host.copilot);
// sendPrompt 成功返回后的「已发送」态：同文案禁止再点，防误触双发；修改输入
// 即解锁，失败态不进入（输入保留可直接重试）。交付帧到达会导航离开本页。
const sentIdea = ref("");
const alreadySent = computed(
  () => !failed.value && !!sentIdea.value && idea.value.trim() === sentIdea.value,
);

// sendPrompt 正常返回但页面仍在（未收到 survey_create 帧）：如实说明，不假设
// 失败也不假设成功；输入保留，改描述后可重试。
async function submit() {
  const text = idea.value.trim();
  if (!text || busy.value || !host.copilot || alreadySent.value) return;
  busy.value = true;
  failed.value = false;
  awaiting.value = false;
  try {
    const prompt = t("surveys.copilot.createIdea", { idea: text });
    if (host.copilot.sendPrompt) {
      await host.copilot.sendPrompt(prompt);
      awaiting.value = true;
      sentIdea.value = text;
    } else {
      host.copilot.fillComposer(prompt);
      host.copilot.focusComposer();
    }
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="create-start" :class="hero ? 'is-hero' : 'is-compact'">
    <h2 class="create-start-title">
      <Sparkles :size="hero ? 20 : 15" class="create-start-icon" aria-hidden="true" />
      <span>{{ t("surveys.createStart.question") }}</span>
    </h2>
    <p v-if="hero" class="create-start-hint">{{ t("surveys.createStart.hint") }}</p>
    <Textarea
      v-model="idea"
      :rows="hero ? 3 : 2"
      :disabled="!hasCopilot"
      :placeholder="t('surveys.createStart.placeholder')"
      :aria-label="t('surveys.createStart.question')"
      class="create-start-input"
      fluid
      @keydown.meta.enter="submit"
      @keydown.ctrl.enter="submit"
    />
    <div class="create-start-actions">
      <Button
        :label="t('surveys.createStart.submit')"
        icon="pi pi-sparkles"
        :loading="busy"
        :disabled="!idea.trim() || !hasCopilot || alreadySent"
        @click="submit"
      />
    </div>
    <!-- P1-10 入口收敛：模板/空白降为 muted 次级行，主入口只有「生成问卷」。 -->
    <p class="create-start-alt">
      <span>{{ t("surveys.createStart.altPrefix") }}</span>
      <Button
        :label="t('surveys.createStart.altTemplate')"
        severity="secondary"
        variant="text"
        class="create-start-alt-link"
        @click="$emit('pickTemplate')"
      />
      <span aria-hidden="true">/</span>
      <Button
        :label="t('surveys.createStart.altBlank')"
        severity="secondary"
        variant="text"
        class="create-start-alt-link"
        @click="$emit('createBlank')"
      />
    </p>
    <p v-if="!hasCopilot" class="create-start-note">{{ t("surveys.createStart.noCopilot") }}</p>
    <Message v-else-if="failed" severity="error" :closable="false">
      {{ t("surveys.createStart.failed") }}
    </Message>
    <p v-else-if="awaiting && !busy" class="create-start-note" role="status">
      {{ t("surveys.createStart.noDelivery") }}
    </p>
  </section>
</template>
<style scoped>
.create-start {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--layout-card-radius, 0.75rem);
  background: var(--color-surface-raised, var(--color-surface-base));
  padding: 1rem 1.25rem;
}
.create-start.is-hero {
  align-items: center;
  text-align: center;
  gap: 1rem;
  padding: 2rem 1.5rem;
}
.create-start-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.is-hero .create-start-title {
  font-size: 1.15rem;
}
.create-start-icon {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
.create-start-hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-tertiary);
}
.create-start.is-hero .create-start-input {
  text-align: start;
}
.create-start-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.is-hero .create-start-actions {
  justify-content: center;
}
.create-start-alt {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem;
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}
.is-hero .create-start-alt {
  justify-content: center;
}
.create-start-alt :deep(.p-button) {
  font-size: 0.8rem;
  font-weight: 400;
  padding: 0.1rem 0.35rem;
  min-height: 0;
}
.create-start-alt :deep(.p-button .p-button-label) {
  color: var(--color-text-secondary);
}
.create-start-note {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}
</style>
