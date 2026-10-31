<template>
  <div class="page">
    <header class="page-head">
      <h1>Topology</h1>
      <p>
        Your CSS for the topology page and the icon of each node. The preview on the right is built the way OpenNMS builds
        <code>/opennms/topology</code>, with the svg files and the views of {{ source === 'dev' ? 'the development OpenNMS' : 'production' }}:
        it changes as you type. Nothing changes in OpenNMS until you apply.
      </p>
    </header>

    <LearnBox title="Which OpenNMS files this module changes, and why it works">
      <table><tbody>
        <tr><th>Your file (workspace/)</th><th>File in OpenNMS (below <code>/usr/share/opennms</code>)</th><th>Who reads it, when</th></tr>
        <tr>
          <td><code>topology/topology.css</code></td>
          <td><code>jetty-webapps/opennms/svg/zz-topology-styles.svg</code>: <code>&lt;svg&gt;&lt;style&gt;&lt;![CDATA[</code> your CSS <code>]]&gt;&lt;/style&gt;&lt;/svg&gt;</code></td>
          <td>The topology page loads every file of <code>svg/</code> into its <code>&lt;defs&gt;</code> (IconRepositoryManager, D3.injectSVGDef), so a <code>&lt;style&gt;</code> in one of them styles the whole page. A new browser tab gets a new file; a reload gets a changed one.</td>
        </tr>
        <tr>
          <td><code>topology/icon-mappings.json</code></td>
          <td>lines <code>&lt;namespace&gt;.&lt;node id&gt; = &lt;icon id&gt;</code> between two comments of the studio in <code>etc/org.opennms.features.topology.app.icons.default.cfg</code></td>
          <td>OpenNMS (Karaf) reads a changed <code>.cfg</code> file of <code>etc/</code> within a second; the next reload of the page draws the node with that icon.</td>
        </tr>
      </tbody></table>
      <p>
        The stock stylesheet of the page (<code>topo_default/styles.css</code>) is inside a jar of OpenNMS and paints the
        frame behind each icon (<code>rect.status</code>) in the colour of the node's alarm: green (<code>#336600</code>) when there is none.
        Your rules win when they start with <code>svg</code> and name at least the classes of the stock rule. The stock file of this OpenNMS came from:
        <code>{{ data?.stockCssFrom ?? '…' }}</code>.
      </p>
    </LearnBox>

    <div class="workbench">
      <section class="pane">
        <div class="toolbar">
          <strong>workspace/topology/topology.css</strong>
          <span class="save" :class="saveState">{{ saveText }}</span>
          <select v-model="snippet" aria-label="Rules to start from">
            <option value="">Insert rules to start from…</option>
            <option v-for="(s, i) in SNIPPETS" :key="s.name" :value="String(i)">{{ s.name }}</option>
          </select>
          <button type="button" :disabled="snippet === ''" @click="insertSnippet">Insert</button>
        </div>
        <div class="editor-wrap"><CssEditor ref="editor" v-model="css" /></div>
        <div class="generated">
          <span>Becomes <code>{{ summary?.generated.rel }}</code> ({{ summary?.generated.size ?? 0 }} bytes, md5 {{ summary?.generated.md5.slice(0, 8) }}).</span>
          <span v-if="summary?.mark">The page will show the label <code>topology.css {{ summary.mark }}</code>.</span>
          <button type="button" class="link" @click="showGenerated = !showGenerated">{{ showGenerated ? 'Hide' : 'Show' }} the file</button>
          <details class="import">
            <summary>Import a CSS file (for example the one of your old topology kit)</summary>
            <input v-model="importPath" placeholder="~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6/styles/topology.css" />
            <button type="button" @click="importCss">Import</button>
          </details>
        </div>
        <pre v-if="showGenerated" class="generated-file">{{ summary?.generated.text }}</pre>
      </section>

      <section class="pane">
        <div class="toolbar">
          <label>Files of <select v-model="source"><option value="dev">dev</option><option value="prod">production</option></select></label>
          <label>View <select v-model="graphIndex"><option v-for="(g, i) in graphs" :key="g.file + g.id" :value="i">{{ g.label }}</option></select></label>
          <label>Status <select v-model="statusMode">
            <option value="normal">no alarms (normal)</option>
            <option value="mixed">mixed alarms</option>
            <option value="none">a view without alarm colours</option>
          </select></label>
          <button type="button" class="ghost" @click="loadPreview(true)">Read the files again</button>
        </div>
        <div class="preview-wrap">
          <TopologyPreview ref="preview" :data="data" :css="css" :nodes="previewNodes" :edges="previewEdges" @select="select" />
          <p v-if="previewError" class="error overlay-msg">{{ previewError }}</p>
        </div>
        <div class="inspector" v-if="selected">
          <h3>{{ selected.label }} <small>{{ selected.key }}</small></h3>
          <p>
            Drawn with <code>{{ selected.icon }}</code>{{ selected.defined ? '' : ' (no svg file defines it: OpenNMS draws only a frame and the label)' }},
            because of {{ selected.why }}. iconKey in the view: <code>{{ selected.iconKey || 'none' }}</code>.
          </p>
          <div class="row">
            <label>Another icon for this node
              <select :value="mappings[selected.key] ?? ''" @change="setIcon(($event.target as HTMLSelectElement).value)">
                <option value="">(no line of the studio)</option>
                <option v-for="id in icons" :key="id" :value="id">{{ id }}</option>
              </select>
            </label>
            <label>Status <select :value="effectiveStatus(selected.key)" @change="statusOf[selected.key] = ($event.target as HTMLSelectElement).value">
              <option v-for="s in STATUSES" :key="s" :value="s">{{ s || '(none: a view without alarm colours)' }}</option>
            </select></label>
          </div>
          <p v-if="computedStyle" class="computed">
            What the browser computes for its frame (<code>rect.{{ computedStyle.frame.className.replace(' ', '.') }}</code>):
            fill <span class="swatch" :style="{ background: computedStyle.frame.fill }"></span><code>{{ computedStyle.frame.fill }}</code>,
            stroke <span class="swatch" :style="{ background: computedStyle.frame.stroke }"></span><code>{{ computedStyle.frame.stroke }}</code>,
            stroke-width <code>{{ computedStyle.frame.strokeWidth }}</code>; label <code>{{ computedStyle.label.fontSize }}</code> <code>{{ computedStyle.label.fill }}</code>.
          </p>
        </div>
        <p v-else class="hint">Click a node in the preview: you see why it has its icon, can give it another one, and see the colours your CSS gives it.</p>
      </section>
    </div>

    <section class="apply">
      <h2>Apply</h2>
      <div class="states">
        <div v-for="s in states" :key="s.target" class="state" :class="s.target">
          <strong>{{ s.target === 'dev' ? 'Development OpenNMS' : 'Production' }}</strong>
          <span :class="s.style.same ? 'ok' : 'bad'">{{ s.style.same ? 'has your CSS' : s.style.inContainer ? 'has another version of the CSS' : 'has no style file yet' }}</span>
          <span :class="s.style.served.same ? 'ok' : 'muted'">serves it: {{ s.style.served.status ? `HTTP ${s.style.served.status}${s.style.served.same ? ', your version' : ''}` : 'no answer' }}<template v-if="s.style.served.cacheControl">, Cache-Control: {{ s.style.served.cacheControl }}</template></span>
          <span v-if="s.target === 'prod'" class="muted">overlay copy: {{ s.style.overlays.length ? s.style.overlays.map((o) => `${o.onHost}${o.md5 === s.style.expected ? ' (yours)' : o.md5 ? ' (another version)' : ' (none yet)'}`).join(', ') : s.style.overlayNote }}</span>
          <span :class="s.mappings.upToDate ? 'ok' : 'bad'">icon mappings {{ s.mappings.upToDate ? 'as yours' : 'differ from yours' }}</span>
        </div>
      </div>
      <div class="panels">
        <TargetPanel module="topology" target="dev" :where="status?.dev ? `container ${status.dev.container} on this machine` : ''" :refresh-key="planKey" @applied="afterApply" @undone="afterApply" />
        <TargetPanel module="topology" target="prod" :where="status?.prod ? `container ${status.prod.container} on ${status.prod.ssh}` : ''" :refresh-key="planKey" @applied="afterApply" @undone="afterApply" />
      </div>
      <p class="hint">
        After an apply: reload the topology page of that OpenNMS (dev: <a :href="devUrl + '/topology'" target="_blank">{{ devUrl }}/topology</a>).
        The first time the style file reaches an OpenNMS, open the page in a new browser tab: an open tab keeps its list of svg files.
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, type PreviewData, type TargetName, type TopologyState, type TopologySummary } from '../api'
import CssEditor from '../components/CssEditor.vue'
import LearnBox from '../components/LearnBox.vue'
import TargetPanel from '../components/TargetPanel.vue'
import TopologyPreview from '../components/TopologyPreview.vue'
import { SNIPPETS } from '../lib/snippets'
import { definedIds, demoGraph, drawnNodes, iconIds, mappingTable, parseGraphml, type DrawnNode, type Graph } from '../lib/topologyModel'
import { store } from '../store'

const STATUSES = ['normal', 'cleared', 'indeterminate', 'warning', 'minor', 'major', 'critical', '']
const MIXED = ['normal', 'warning', 'normal', 'major', 'normal', 'critical', 'minor', 'cleared']

const summary = ref<TopologySummary | null>(null)
const css = ref('')
const savedCss = ref('')
const saveState = ref<'saved' | 'saving' | 'dirty' | 'error'>('saved')
const saveError = ref('')
const showGenerated = ref(false)
const snippet = ref('')
const importPath = ref('')
const editor = ref<InstanceType<typeof CssEditor>>()
const preview = ref<InstanceType<typeof TopologyPreview>>()

const source = ref<TargetName>('dev')
const data = ref<PreviewData | null>(null)
const previewError = ref('')
const graphIndex = ref(0)
const statusMode = ref<'normal' | 'mixed' | 'none'>('normal')
const statusOf = reactive<Record<string, string>>({})
const selectedKey = ref('')
const computedStyle = ref<{ frame: { className: string; fill: string; stroke: string; strokeWidth: string }; label: { fontSize: string; fill: string } } | null>(null)
const mappings = ref<Record<string, string>>({})
const states = ref<TopologyState[]>([])
const planKey = ref(0)

const status = computed(() => store.status)
const devUrl = computed(() => `${location.protocol}//${location.hostname}:${store.status?.dev.port ?? 8980}/opennms`)
const saveText = computed(() => ({ saved: 'saved', saving: 'saving…', dirty: 'changed', error: `not saved: ${saveError.value}` })[saveState.value])

const graphs = computed<Graph[]>(() => {
  if (!data.value) return []
  const all = data.value.views.flatMap((v) => parseGraphml(v.file, v.text))
  const withNodes = all.filter((g) => g.nodes.length)
  return withNodes.length ? withNodes : [demoGraph(iconIds(data.value.svgFiles))]
})
const icons = computed(() => (data.value ? iconIds(data.value.svgFiles) : []))
const nodes = computed<DrawnNode[]>(() => {
  const g = graphs.value[graphIndex.value]
  if (!g || !data.value) return []
  return drawnNodes(g, mappingTable(data.value, mappings.value), definedIds(data.value.svgFiles))
})
function effectiveStatus(key: string): string {
  const i = nodes.value.findIndex((n) => n.key === key)
  return statusOf[key] ?? (statusMode.value === 'none' ? '' : statusMode.value === 'mixed' ? MIXED[Math.max(0, i) % MIXED.length] : 'normal')
}
const previewNodes = computed(() =>
  nodes.value.map((n) => ({
    key: n.key,
    label: n.label,
    icon: n.icon,
    status: effectiveStatus(n.key),
    selected: n.key === selectedKey.value,
  })),
)
// A new choice for all nodes replaces the choices made for single nodes.
watch(statusMode, () => {
  for (const k of Object.keys(statusOf)) delete statusOf[k]
})
const previewEdges = computed(() => {
  const g = graphs.value[graphIndex.value]
  if (!g) return []
  return g.edges.map((e) => ({ source: `${g.namespace}.${e.source}`, target: `${g.namespace}.${e.target}` }))
})
const selected = computed(() => nodes.value.find((n) => n.key === selectedKey.value) ?? null)

async function loadSummary(replace: boolean) {
  const s = await api.topology()
  summary.value = s
  mappings.value = { ...s.mappings }
  if (replace || css.value === savedCss.value) {
    css.value = s.css
    savedCss.value = s.css
    saveState.value = 'saved'
  }
}

async function loadPreview(refresh = false) {
  previewError.value = ''
  try {
    data.value = await api.preview(source.value, refresh)
    if (graphIndex.value >= graphs.value.length) graphIndex.value = 0
  } catch (e) {
    previewError.value = `Could not read the files of ${source.value === 'dev' ? 'the development OpenNMS' : 'production'}: ${(e as Error).message}`
  }
}

async function loadStates() {
  const out: TopologyState[] = []
  for (const t of ['dev', 'prod'] as TargetName[]) {
    try {
      out.push(await api.topologyState(t))
    } catch {
      // that OpenNMS is not reachable: its panel says why
    }
  }
  states.value = out
}

let timer: number | undefined
watch(css, (value) => {
  if (value === savedCss.value) {
    clearTimeout(timer)
    if (saveState.value !== 'saving') saveState.value = 'saved'
    return
  }
  saveState.value = 'dirty'
  clearTimeout(timer)
  timer = window.setTimeout(async () => {
    saveState.value = 'saving'
    try {
      summary.value = await api.saveCss(value)
      savedCss.value = value
      saveState.value = css.value === value ? 'saved' : 'dirty'
      planKey.value++
    } catch (e) {
      saveError.value = (e as Error).message
      saveState.value = 'error'
    }
  }, 700)
})

watch(source, () => loadPreview())
watch(() => store.workspaceVersion, () => loadSummary(false))
watch([selectedKey, css, () => previewNodes.value], () => {
  requestAnimationFrame(() => {
    computedStyle.value = selectedKey.value ? ((preview.value?.inspect(selectedKey.value) as typeof computedStyle.value) ?? null) : null
  })
})

function select(key: string) {
  selectedKey.value = key === selectedKey.value ? '' : key
}

async function setIcon(icon: string) {
  if (!selected.value) return
  const next = { ...mappings.value }
  if (icon) next[selected.value.key] = icon
  else delete next[selected.value.key]
  const s = await api.saveMappings(next)
  mappings.value = { ...s.mappings }
  planKey.value++
}

function insertSnippet() {
  const s = SNIPPETS[Number(snippet.value)]
  if (!s) return
  const icon = selected.value?.icon ?? icons.value[0] ?? 'server'
  editor.value?.insert(s.css.replace(/\{icon\}/g, icon))
  snippet.value = ''
}

async function importCss() {
  try {
    await api.importCss(importPath.value.trim())
    await loadSummary(true)
  } catch (e) {
    saveError.value = (e as Error).message
    saveState.value = 'error'
  }
}

function afterApply() {
  void loadStates()
  planKey.value++
}

onMounted(async () => {
  await loadSummary(true)
  await loadPreview()
  await loadStates()
})
</script>

<style scoped>
.workbench { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(380px, 1.25fr); gap: 14px; margin: 14px 0; }
@media (max-width: 1100px) { .workbench { grid-template-columns: 1fr; } }
.pane { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; }
.save { font-size: 12px; color: var(--muted); }
.save.dirty, .save.saving { color: var(--warn); }
.save.error { color: var(--bad); }
.editor-wrap { height: 460px; }
.preview-wrap { height: 460px; position: relative; }
.overlay-msg { position: absolute; left: 10px; bottom: 10px; right: 10px; background: var(--panel); padding: 8px; border-radius: 6px; }
.generated { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: 12.5px; color: var(--muted); }
.generated-file { max-height: 260px; overflow: auto; background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; font-size: 12px; white-space: pre-wrap; }
.import { width: 100%; }
.import input { width: min(640px, 100%); margin: 4px 6px 0 0; }
.inspector { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; background: var(--panel); font-size: 13px; }
.inspector h3 { margin: 0 0 4px; font-size: 15px; }
.inspector small { color: var(--muted); font-weight: normal; font-family: var(--mono); }
.row { display: flex; gap: 16px; flex-wrap: wrap; }
.computed { color: var(--muted); }
.swatch { display: inline-block; width: 12px; height: 12px; border: 1px solid var(--line); border-radius: 3px; vertical-align: -2px; margin: 0 3px; }
.apply h2 { margin: 18px 0 8px; }
.states { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 10px; }
.state { display: flex; flex-direction: column; gap: 2px; font-size: 13px; padding: 8px 12px; border-radius: 8px; background: var(--panel); border-left: 4px solid var(--dev); }
.state.prod { border-left-color: var(--prod); }
.panels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 1100px) { .panels, .states { grid-template-columns: 1fr; } }
.ok { color: var(--ok); }
.bad { color: var(--bad); }
.muted { color: var(--muted); }
.hint { color: var(--muted); font-size: 13px; }
.error { color: var(--bad); }
</style>
