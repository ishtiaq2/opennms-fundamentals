<template>
  <section class="log" :class="{ open: store.logOpen }">
    <header @click="store.logOpen = !store.logOpen">
      <strong>Command log</strong>
      <span class="sub" title="Left out: the quiet checks the pages repeat on their own (is the container running, the md5 sums of the state lines)">the commands the studio runs for you, as you would type them ({{ commands }} so far)</span>
      <span class="last" v-if="last && !store.logOpen">{{ last.text }}</span>
      <button class="link" type="button">{{ store.logOpen ? 'Hide' : 'Show' }}</button>
    </header>
    <div v-if="store.logOpen" class="entries" ref="box">
      <div v-for="e in store.log" :key="e.kind + e.id" class="entry" :class="[e.kind, okClass(e)]">
        <span class="target" :class="e.target">{{ e.target || '·' }}</span>
        <div class="main">
          <code v-if="e.kind === 'command'" class="cmd">$ {{ e.text }}</code>
          <span v-else class="step">{{ e.text }}</span>
          <div v-if="e.kind === 'command' && e.code !== undefined" class="meta">
            exit {{ e.code }} · {{ e.ms }} ms
            <details v-if="e.output"><summary>output</summary><pre>{{ e.output }}</pre></details>
          </div>
        </div>
      </div>
      <p v-if="!store.log.length" class="empty">Nothing yet. The commands appear here while the studio runs them.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store, type LogEntry } from '../store'

const box = ref<HTMLDivElement>()
const commands = computed(() => store.log.filter((e) => e.kind === 'command').length)
const last = computed(() => store.log[store.log.length - 1])
function okClass(e: LogEntry) {
  if (e.kind === 'command') return e.code === undefined ? 'running' : e.code === 0 ? 'ok' : 'failed'
  return e.ok === true ? 'ok' : e.ok === false ? 'failed' : ''
}
watch(
  () => store.log.length,
  async () => {
    await nextTick()
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  },
)
</script>

<style scoped>
.log { border-top: 1px solid var(--line); background: var(--panel); }
header { display: flex; gap: 10px; align-items: baseline; padding: 6px 14px; cursor: pointer; user-select: none; }
.sub { color: var(--muted); font-size: 12px; }
.last { flex: 1; color: var(--muted); font: 12px var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link { margin-left: auto; }
.entries { max-height: 34vh; overflow: auto; padding: 4px 14px 10px; font-size: 12.5px; }
.entry { display: grid; grid-template-columns: 74px 1fr; gap: 8px; padding: 4px 0; border-bottom: 1px dashed var(--line); }
.target { font-size: 11px; text-transform: uppercase; color: white; background: var(--muted); border-radius: 4px; padding: 1px 6px; align-self: start; text-align: center; }
.target.dev { background: var(--dev); }
.target.prod { background: var(--prod); }
.target.workspace { background: var(--accent); }
.cmd { font: 12px var(--mono); word-break: break-all; white-space: pre-wrap; }
.step { color: var(--text); }
.entry.failed .cmd, .entry.failed .step { color: var(--bad); }
.entry.ok .step { color: var(--ok); }
.meta { color: var(--muted); font-size: 11.5px; }
.meta pre { white-space: pre-wrap; word-break: break-all; background: var(--code-bg); padding: 6px; border-radius: 4px; max-height: 160px; overflow: auto; }
.empty { color: var(--muted); }
</style>
