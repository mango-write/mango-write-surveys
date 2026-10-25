<script setup lang="ts">
// 问卷列表页一族的页面头：结构对齐主站 shared/PageHeader（title + icon/actions
// 槽），样式类沿用 mw-page-header 令牌；主站版本是宿主规章组件不外迁，独立站
// 由本组件承接同一形态。
defineProps<{ title: string }>();
</script>
<template>
  <header class="mw-page-header survey-page-header">
    <span
      v-if="$slots.icon"
      class="survey-page-header__icon tw:grid tw:h-8 tw:w-8 tw:shrink-0 tw:place-items-center tw:rounded-lg tw:bg-primary-50 tw:text-primary-600"
    >
      <slot name="icon" />
    </span>
    <h1 class="tw:m-0 tw:min-w-0 tw:text-lg tw:font-semibold tw:leading-tight">{{ title }}</h1>
    <div v-if="$slots.actions" class="tw:ml-auto tw:flex tw:shrink-0 tw:items-center tw:gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
<style scoped>
.survey-page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 8px var(--layout-card-padding-compact, 1rem);
  border-bottom: 1px solid var(--color-border-subtle);
}
</style>
