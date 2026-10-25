<script setup lang="ts">
// 状态机快捷操作（暂停/恢复/关闭）：版本 tab 与发放段共用的同一组按钮。
// 关闭是终态，confirm 留在这里（文案沿用既有 keys）；删除只在版本 tab。
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import Button from "primevue/button";

import type { SurveyStatus } from "../../contracts/index.js";

defineProps<{
  status: SurveyStatus;
  /** 从未发布过时不能关闭（没有采集在跑）。 */
  hasRevision: boolean;
  canWrite: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{
  change: [status: "published" | "paused"];
  close: [];
}>();
const { t } = useI18n();
const confirm = useConfirm();

function confirmClose() {
  confirm.require({
    header: t("surveys.close"),
    message: t("surveys.closeConfirm"),
    accept: () => emit("close"),
  });
}
</script>
<template>
  <div class="survey-status-actions">
    <Button
      v-if="status === 'published'"
      :label="t('surveys.pause')"
      severity="secondary"
      text
      :disabled="!canWrite || busy"
      @click="emit('change', 'paused')"
    /><Button
      v-else-if="status === 'paused'"
      :label="t('surveys.resume')"
      severity="secondary"
      text
      :disabled="!canWrite || busy"
      @click="emit('change', 'published')"
    />
    <Button
      v-if="status !== 'closed' && hasRevision"
      :label="t('surveys.close')"
      severity="secondary"
      text
      :disabled="!canWrite || busy"
      @click="confirmClose"
    />
  </div>
</template>
<style scoped>
.survey-status-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
