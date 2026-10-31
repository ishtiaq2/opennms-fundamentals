<template>
  <div class="editor">
    <div class="gutter" ref="gutter" aria-hidden="true">
      <div v-for="n in lineCount" :key="n">{{ n }}</div>
    </div>
    <textarea
      ref="area"
      :value="modelValue"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      aria-label="topology.css"
      @input="onInput"
      @scroll="syncScroll"
      @keydown.tab.prevent="insertTab"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const area = ref<HTMLTextAreaElement>()
const gutter = ref<HTMLDivElement>()
const lineCount = computed(() => props.modelValue.split('\n').length)

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}
function syncScroll() {
  if (gutter.value && area.value) gutter.value.scrollTop = area.value.scrollTop
}
function insertTab() {
  const el = area.value
  if (!el) return
  const { selectionStart: s, selectionEnd: e, value } = el
  const next = `${value.slice(0, s)}  ${value.slice(e)}`
  emit('update:modelValue', next)
  requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
}
/** Puts text at the cursor (or at the end). */
function insert(text: string) {
  const el = area.value
  const value = props.modelValue
  const at = el && document.activeElement === el ? el.selectionStart : value.length
  const before = value.slice(0, at)
  const glue = before && !before.endsWith('\n') ? '\n' : ''
  emit('update:modelValue', `${before}${glue}${text}${value.slice(at)}`)
}
defineExpose({ insert })
</script>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: auto 1fr;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--code-bg);
  height: 100%;
  min-height: 320px;
}
.gutter {
  overflow: hidden;
  padding: 10px 6px 10px 10px;
  color: var(--muted);
  font: 12.5px/1.5 var(--mono);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--line);
  background: color-mix(in srgb, var(--code-bg) 80%, var(--panel));
}
textarea {
  border: 0;
  outline: none;
  resize: none;
  padding: 10px 12px;
  font: 12.5px/1.5 var(--mono);
  background: transparent;
  color: var(--text);
  white-space: pre;
  overflow: auto;
  tab-size: 2;
}
</style>
