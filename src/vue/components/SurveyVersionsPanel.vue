<script setup lang="ts">
// 左岛「版本」tab（issue #217）：revision 列表（版本号、发布时间、
// contentHash 前 8 位、当前采集版本标记）+ 状态机操作。发布/状态动作永远
// 显式人工，这里只提供入口，请求与刷新归宿主页。
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Tag from "primevue/tag";

import type { SurveyRevisionSummary, SurveyStatus } from "../../contracts/index.js";

import SurveyStatusActions from "./SurveyStatusActions.vue";

defineProps<{
  revisions: SurveyRevisionSummary[];
  currentRevisionId: string | null;
  status: SurveyStatus;
  canWrite: boolean;
  canDelete: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{
  change: [status: "published" | "paused"];
  close: [];
  remove: [];
}>();
const { t } = useI18n();
function formatTime(value: string) {
  return new Date(value).toLocaleString();
}
</script>
<template>
  <div class="survey-versions">
    <p class="versions-hint">{{ t("surveys.versionsHint") }}</p>
    <p v-if="!revisions.length" class="versions-empty">
      {{ t("surveys.noRevisions") }}
    </p>
    <div
      v-for="revision in revisions"
      :key="revision.id"
      class="revision-row"
      :class="revision.id === currentRevisionId && 'revision-row--current'"
    >
      <div class="revision-head">
        <strong>{{ t("surveys.revisionNumber", { n: revision.revision }) }}</strong>
        <Tag
          v-if="revision.id === currentRevisionId"
          :value="t('surveys.currentRevision')"
          severity="success"
        />
      </div>
      <div class="revision-meta">
        {{ t("surveys.publishedAt") }} {{ formatTime(revision.createdAt) }} ·
        <span class="revision-hash">{{ revision.contentHash.slice(0, 8) }}</span>
      </div>
    </div>
    <SurveyStatusActions
      class="versions-status"
      :status="status"
      :has-revision="!!currentRevisionId"
      :can-write="canWrite"
      :busy="busy"
      @change="emit('change', $event)"
      @close="emit('close')"
    />
    <Button
      class="versions-delete"
      icon="pi pi-trash"
      :label="t('surveys.deleteSurvey')"
      text
      severity="danger"
      :disabled="!canDelete || busy"
      @click="emit('remove')"
    />
  </div>
</template>
<style scoped>
.survey-versions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}
.versions-hint,
.versions-empty {
  margin: 2px 6px 4px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}
.revision-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 8px);
  background: var(--color-surface-base);
}
.revision-row--current {
  border-color: var(--color-brand-200);
  background: var(--color-brand-50);
}
.revision-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12.5px;
  color: var(--color-text-primary);
}
.revision-meta {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  overflow-wrap: anywhere;
}
.revision-hash {
  font-family: var(--font-family-mono);
  letter-spacing: 0.02em;
}
.versions-status {
  margin-top: 4px;
  padding: 0 6px;
}
.versions-delete {
  align-self: flex-start;
}
</style>
