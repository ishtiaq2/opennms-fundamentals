<template>
  <iframe ref="frame" class="preview" src="/preview-frame.html" title="Topology preview" @load="onLoad"></iframe>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PreviewData } from '../api'

export interface PreviewNode {
  key: string
  label: string
  icon: string
  status: string
  selected: boolean
}

const props = defineProps<{
  data: PreviewData | null
  css: string
  nodes: PreviewNode[]
  edges: { source: string; target: string }[]
}>()
const emit = defineEmits<{ select: [key: string] }>()

interface PreviewApi {
  load(d: { stockCss: string; svgFiles: { name: string; text: string }[] }): void
  setCss(css: string): void
  draw(nodes: PreviewNode[], edges: { source: string; target: string }[]): void
  inspect(key: string): unknown
  rulesUnderstood(): number
}

const frame = ref<HTMLIFrameElement>()
let ready = false
let loadedData: PreviewData | null = null

function win(): PreviewApi | null {
  const w = frame.value?.contentWindow as (Window & { preview?: PreviewApi }) | null | undefined
  return w?.preview ?? null
}

function render(all: boolean) {
  const p = win()
  if (!p || !ready || !props.data) return
  if (all || loadedData !== props.data) {
    p.load({ stockCss: props.data.stockCss, svgFiles: props.data.svgFiles })
    loadedData = props.data
  }
  p.setCss(props.css)
  p.draw(JSON.parse(JSON.stringify(props.nodes)), JSON.parse(JSON.stringify(props.edges)))
}

function onLoad() {
  ready = !!win()
  render(true)
}

function onMessage(e: MessageEvent) {
  if (e.source !== frame.value?.contentWindow) return
  const d = e.data as { source?: string; type?: string; key?: string }
  if (d?.source !== 'topology-preview') return
  if (d.type === 'ready') {
    ready = true
    render(true)
  }
  if (d.type === 'select' && d.key) emit('select', d.key)
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

watch(() => props.data, () => render(true))
watch(() => props.css, (css) => win()?.setCss(css))
watch(() => [props.nodes, props.edges], () => render(false), { deep: true })

defineExpose({
  inspect: (key: string) => win()?.inspect(key) ?? null,
  rulesUnderstood: () => win()?.rulesUnderstood() ?? 0,
})
</script>

<style scoped>
.preview { width: 100%; height: 100%; min-height: 360px; border: 1px solid var(--line); border-radius: 8px; background: white; display: block; }
</style>
