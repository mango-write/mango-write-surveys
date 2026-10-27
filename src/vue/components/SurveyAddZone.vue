<script setup lang="ts">
// 加题插入带（issue #217）：分隔线 +「+」+ 题型菜单锚点，卡间与页尾共用单份
// markup。插入位置由画布裁决：toggle/select/dragover/drop 全部上抛事件。
import Button from "primevue/button";
import { useI18n } from "vue-i18n";
import { Plus } from "lucide-vue-next";

import type { SurveyQuestion } from "../../contracts/index.js";
import SurveyTypeMenu from "./SurveyTypeMenu.vue";

defineProps<{ menuOpen: boolean; active?: boolean }>();
const emit = defineEmits<{
  toggle: [];
  select: [type: SurveyQuestion["type"]];
  close: [];
  dragover: [event: DragEvent];
  drop: [event: DragEvent];
}>();
const { t } = useI18n();
</script>
<template>
  <div
    class="add-zone"
    :class="{ 'add-zone--active': active }"
    @dragover="emit('dragover', $event)"
    @drop="emit('drop', $event)"
  >
    <span class="add-zone__line" aria-hidden="true" />
    <div class="menu-anchor">
      <Button
        severity="secondary"
        variant="text"
        class="add-zone__btn"
        :aria-label="t('surveys.addQuestion')"
        v-tooltip.top="t('surveys.addQuestion')"
        @click="emit('toggle')"
      >
        <template #icon><Plus :size="16" /></template>
      </Button>
      <SurveyTypeMenu
        :open="menuOpen"
        @select="(type) => emit('select', type)"
        @close="emit('close')"
      />
    </div>
    <slot name="review" />
    <span class="add-zone__line" aria-hidden="true" />
  </div>
</template>
<style scoped>
.add-zone {
  display: flex;
  align-items: center;
  gap: 8px;
}
.add-zone__line {
  flex: 1;
  height: 1px;
  background: transparent;
}
.add-zone:hover .add-zone__line,
.add-zone--active .add-zone__line {
  background: var(--color-border-strong);
}
.menu-anchor {
  position: relative;
}
</style>
