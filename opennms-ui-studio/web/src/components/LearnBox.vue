<template>
  <details class="learn" :open="open">
    <summary>
      <span class="badge">How it works</span>
      {{ title }}
    </summary>
    <div class="body"><slot /></div>
  </details>
</template>

<script setup lang="ts">
defineProps<{ title: string; open?: boolean }>()
</script>

<style scoped>
.learn {
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
  background: color-mix(in srgb, var(--accent) 5%, var(--panel));
  border-radius: 8px;
  padding: 8px 12px;
}
summary { cursor: pointer; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.badge { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; background: var(--accent); color: white; border-radius: 4px; padding: 2px 6px; }
.body { font-size: 13.5px; line-height: 1.55; }
.body :deep(code) { background: var(--code-bg); padding: 1px 4px; border-radius: 3px; font-size: 12.5px; }
.body :deep(table) { border-collapse: collapse; margin: 6px 0; font-size: 13px; }
.body :deep(td), .body :deep(th) { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
</style>
