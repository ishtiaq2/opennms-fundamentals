<template>
  <div class="diff">
    <div v-if="excerpt" class="excerpt">
      <div class="ex-row"><span class="ex-tag del">now</span><code>{{ excerpt.before }}</code></div>
      <div class="ex-row"><span class="ex-tag add">after</span><code>{{ excerpt.after }}</code></div>
      <p class="hint">This file is one long line of compiled JavaScript: the studio shows the text around the change.</p>
    </div>
    <pre v-else-if="diff"><code><span v-for="(line, i) in lines" :key="i" :class="kind(line)">{{ line }}
</span></code></pre>
    <p v-else class="hint">No difference.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ diff?: string; excerpt?: { before: string; after: string } }>()
const lines = computed(() => (props.diff ?? '').replace(/\n$/, '').split('\n'))
function kind(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'head'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return ''
}
</script>

<style scoped>
.diff pre {
  margin: 0;
  max-height: 340px;
  overflow: auto;
  background: var(--code-bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
}
.add { color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, transparent); display: inline-block; width: 100%; }
.del { color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); display: inline-block; width: 100%; }
.hunk { color: var(--accent); }
.head { color: var(--muted); font-weight: 600; }
.excerpt { display: grid; gap: 6px; }
.ex-row { display: grid; grid-template-columns: 56px 1fr; gap: 8px; align-items: start; }
.ex-row code { display: block; background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 12px; word-break: break-all; white-space: pre-wrap; }
.ex-tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 6px; border-radius: 4px; text-align: center; }
.ex-tag.del { background: color-mix(in srgb, var(--bad) 15%, transparent); color: var(--bad); }
.ex-tag.add { background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); }
.hint { color: var(--muted); font-size: 12px; margin: 4px 0 0; }
</style>
