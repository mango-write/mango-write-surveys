<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import Button from "primevue/button";
import { Pause, Play, Square } from "lucide-vue-next";

import type { SurveyStatus } from "../../contracts/index.js";

withDefaults(defineProps<{
  status: SurveyStatus;
  hasRevision: boolean;
  canWrite: boolean;
  busy?: boolean;
  layout?: "inline" | "cards";
}>(), { layout: "inline" });
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
    acceptLabel: t("surveys.close"),
    rejectLabel: t("surveys.cancel"),
    rejectProps: { severity: "secondary", text: true },
    acceptProps: { severity: "danger" },
    accept: () => emit("close"),
  });
}
</script>

<template>
  <div class="survey-status-actions" :class="`survey-status-actions--${layout}`">
    <template v-if="layout === 'cards'">
      <div v-if="status === 'published'" class="management-row">
        <span class="management-row__icon"><Pause :size="18" /></span>
        <div class="management-row__copy">
          <strong>{{ t("surveys.pause") }}</strong>
          <p>{{ t("surveys.pauseHint") }}</p>
        </div>
        <Button :label="t('surveys.pause')" severity="secondary" variant="outlined"
          :disabled="!canWrite || busy" @click="emit('change', 'paused')" />
      </div>
      <div v-else-if="status === 'paused'" class="management-row">
        <span class="management-row__icon"><Play :size="18" /></span>
        <div class="management-row__copy">
          <strong>{{ t("surveys.resume") }}</strong>
          <p>{{ t("surveys.resumeHint") }}</p>
        </div>
        <Button :label="t('surveys.resume')" :disabled="!canWrite || busy"
          @click="emit('change', 'published')" />
      </div>
      <div v-if="status !== 'closed' && hasRevision" class="management-row management-row--danger">
        <span class="management-row__icon"><Square :size="17" /></span>
        <div class="management-row__copy">
          <strong>{{ t("surveys.close") }}</strong>
          <p>{{ t("surveys.closeHint") }}</p>
        </div>
        <Button :label="t('surveys.close')" severity="danger" variant="outlined"
          :disabled="!canWrite || busy" @click="emit('close')" />
      </div>
      <div v-else-if="status === 'closed'" class="management-row management-row--danger">
        <span class="management-row__icon"><Square :size="17" /></span>
        <div class="management-row__copy">
          <strong>{{ t("surveys.status.closed") }}</strong>
          <p>{{ t("surveys.closedHint") }}</p>
        </div>
      </div>
    </template>
    <template v-else>
      <Button v-if="status === 'published'" :label="t('surveys.pause')" severity="secondary" text
        :disabled="!canWrite || busy" @click="emit('change', 'paused')" />
      <Button v-else-if="status === 'paused'" :label="t('surveys.resume')" severity="secondary" text
        :disabled="!canWrite || busy" @click="emit('change', 'published')" />
      <Button v-if="status !== 'closed' && hasRevision" :label="t('surveys.close')" severity="secondary" text
        :disabled="!canWrite || busy" @click="confirmClose" />
    </template>
  </div>
</template>

<style scoped>
.survey-status-actions--inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.survey-status-actions--cards {
  display: grid;
}
.management-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
}
.management-row:first-child { padding-top: 0; }
.management-row:last-child { padding-bottom: 0; }
.management-row + .management-row { border-top: 1px solid var(--color-border-subtle); }
.management-row__icon {
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
  color: var(--color-text-secondary);
}
.management-row--danger .management-row__icon {
  background: var(--color-danger-surface);
  color: var(--color-danger-700);
}
.management-row__copy strong {
  font-size: var(--font-size-body-sm);
  font-weight: 600;
}
.management-row__copy p {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-body);
}
@media (max-width: 767.98px) {
  .management-row {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
  }
  .management-row > .p-button { grid-column: 2; justify-self: start; }
}
</style>
