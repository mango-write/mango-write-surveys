<script setup lang="ts">
import Button from "primevue/button";
import type { SurveyStageNavigation } from "../workspace-navigation.js";

defineProps<{ model: SurveyStageNavigation }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <nav class="stage-navigation" :aria-label="model.title">
    <header class="stage-navigation__head">
      <strong>{{ model.title }}</strong>
      <Button
        v-if="model.actionId && model.actionLabel"
        icon="pi pi-plus"
        text
        :aria-label="model.actionLabel"
        v-tooltip.bottom="model.actionLabel"
        @click="emit('select', model.actionId)"
      />
    </header>
    <section v-for="group in model.groups" :key="group.id" class="stage-navigation__group">
      <h3 v-if="group.label">{{ group.label }}</h3>
      <button
        v-for="item in group.items"
        :key="item.id"
        type="button"
        class="stage-navigation__item"
        :class="{ 'is-active': item.active }"
        :aria-current="item.active ? 'page' : undefined"
        @click="emit('select', item.id)"
      >
        <span>{{ item.label }}</span>
        <small v-if="item.meta">{{ item.meta }}</small>
      </button>
      <p v-if="!group.items.length" class="stage-navigation__empty">—</p>
    </section>
  </nav>
</template>

<style scoped>
.stage-navigation {
  display: grid;
  align-content: start;
  gap: var(--layout-card-padding);
  padding: 12px;
}
.stage-navigation__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  gap: 8px;
  padding: 0 4px;
}
.stage-navigation__group {
  display: grid;
  gap: 4px;
}
.stage-navigation__group h3 {
  margin: 0 8px 4px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  font-weight: 500;
}
.stage-navigation__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.stage-navigation__item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.stage-navigation__item.is-active {
  background: rgb(var(--color-brand-500-rgb) / 0.1);
  color: var(--color-brand-700);
}
.stage-navigation__item span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.stage-navigation__item small {
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.stage-navigation__empty {
  margin: 0;
  padding: 8px 10px;
  color: var(--color-text-tertiary);
}
</style>
