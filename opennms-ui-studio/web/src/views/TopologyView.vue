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
          <td><code>topology/icons/&lt;name&gt;.svg</code> (only when you make one)</td>
          <td><code>jetty-webapps/opennms/svg/&lt;name&gt;.svg</code>: your copy of an icon file, for example one with its ids repaired</td>
          <td>The same folder, the same way: the page asks for every <code>*.svg</code> in it. A changed file comes with a reload; a file that is new needs a new browser tab.</td>
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
            <option value="parts" :disabled="!selected">The parts of the icon you clicked (its classes and colours)</option>
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
        <details class="reach" v-if="reaches.length" :open="reachBad + reachWarn > 0">
          <summary>
            What your rules reach in this preview
            <span v-if="reachBad" class="bad">{{ reachBad }} match{{ reachBad === 1 ? 'es' : '' }} nothing</span>
            <span v-if="reachWarn" class="warn">{{ reachWarn }} may not show</span>
          </summary>
          <ul>
            <li v-for="(r, i) in reaches" :key="i" :class="r.verdict.level">
              <code>{{ r.reach.selector }}</code>
              <span>{{ r.verdict.text }}</span>
            </li>
          </ul>
          <p class="hint">
            Counted in the preview, with the files of {{ source === 'dev' ? 'dev' : 'production' }}. A rule for the parts of an icon (<code>#id .cls-1</code>) reaches
            the shapes of the drawing, and every node shows a copy of them.
          </p>
        </details>
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
          <TopologyPreview ref="preview" :data="shownData" :css="css" :nodes="previewNodes" :edges="previewEdges" @select="select" />
          <p v-if="previewError" class="error overlay-msg">{{ previewError }}</p>
        </div>
        <div class="inspector" v-if="selected">
          <h3>{{ selected.label }} <small>{{ selected.key }}</small></h3>
          <p>
            Drawn with <code>{{ selected.icon }}</code>{{ selected.defined ? '' : ' (no svg file defines it: OpenNMS draws only a frame and the label)' }},
            because of {{ selected.why }}. iconKey in the view: <code>{{ selected.iconKey || 'none' }}</code>.
          </p>
          <p v-if="selectedErrors.length" class="flaw">
            <strong>{{ selectedIcon?.file.name }} is built so that this icon does not show what its colours say.</strong>
            {{ selectedErrors[0].message }}
            <button type="button" class="link" @click="scrollToIcons">What to do: Icon files, below</button>
          </p>
          <p v-else-if="selectedIcon?.fromCopy" class="hint">Drawn from your repaired copy of {{ selectedIcon.file.name }}.</p>
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

    <section class="icon-files" id="icon-files" v-if="iconReport">
      <div class="icons-head">
        <h2>Icon files</h2>
        <button type="button" class="ghost" @click="loadIcons(true)">Check again</button>
      </div>
      <p class="hint">
        OpenNMS draws a node with <code>&lt;use href="#X"&gt;</code>, which draws <em>everything</em> inside the element with the id X; under the mouse it
        draws <code>#X_rollover</code> and when selected <code>#X_active</code>. So a file needs three groups <em>next to each other</em> (the stock files put them in
        <code>&lt;g id="X_icon"&gt;</code>). The files of {{ source === 'dev' ? 'the development OpenNMS' : 'production' }} are checked for that.
      </p>
      <ul v-if="skipped.length" class="problems">
        <li v-for="f in skipped" :key="f.name"><code>{{ f.name }}</code> is not well-formed XML ({{ f.error }}): OpenNMS skips it, and so does the preview.</li>
      </ul>
      <p v-if="iconError" class="error">{{ iconError }}</p>
      <ul class="ifiles">
        <li v-for="f in iconReport.files" :key="f.name" class="ifile" :class="fileLevel(f)">
          <div class="ihead">
            <code class="iname">{{ f.name }}</code>
            <span v-if="f.icons.length" class="ids">icon{{ f.icons.length > 1 ? 's' : '' }}: <code v-for="i in f.icons" :key="i.id">{{ i.id }}</code></span>
            <span class="verdict">{{ fileVerdict(f) }}</span>
          </div>
          <div v-for="p in f.problems" :key="p.kind + p.icon" class="problem" :class="p.severity">
            <p>{{ p.message }}</p>
            <p v-if="p.fix" class="fix">The repair: {{ p.fix.summary }}. In the file: <template v-for="(r, i) in p.fix.renames" :key="r.from"><template v-if="i">, </template><code>id="{{ r.from }}"</code> becomes <code>id="{{ r.to }}"</code></template>. Nothing else changes.</p>
            <p v-else-if="p.noFix" class="muted">No automatic repair: {{ p.noFix }}</p>
          </div>
          <div v-if="f.copy" class="copy">
            <p>
              Your copy: <code>workspace/topology/icons/{{ f.name }}</code>
              <template v-if="f.copy.same"> is what {{ source === 'dev' ? 'dev' : 'production' }} has.</template>
              <template v-else-if="f.missing"> is a new file for the OpenNMS: Apply sends it.</template>
              <template v-else> differs from the file of {{ source === 'dev' ? 'dev' : 'production' }}: the preview draws your copy, and Apply sends it.</template>
              <template v-if="f.copy.problems.some((p) => p.severity === 'error')"> It still has a flaw (above, for the copy).</template>
              <template v-else> It has no flaw.</template>
            </p>
            <div v-for="p in f.copy.problems.filter((q) => q.severity === 'error')" :key="'c' + p.kind + p.icon" class="problem error"><p>{{ p.message }}</p></div>
          </div>
          <div class="actions">
            <button v-if="canRepair(f)" type="button" class="primary" :disabled="repairing === f.name" @click="repair(f.name)">
              {{ f.copy ? 'Repair my copy' : 'Make a repaired copy in the workspace' }}
            </button>
            <button v-if="f.copy" type="button" class="ghost" @click="removeCopy(f.name)">Remove my copy (the studio stops sending it)</button>
          </div>
        </li>
      </ul>
      <p v-if="!iconReport.files.length" class="muted">No svg files were found there.</p>
      <p class="hint">
        A copy is an ordinary file in your workspace (a git repository): edit it with any editor, the studio sees the change, and the history keeps it.
        Apply sends it like the CSS, keeps the old file, and Undo puts it back.
      </p>
    </section>

    <section class="apply">
      <h2>Apply</h2>
      <div class="states">
        <div v-for="s in states" :key="s.target" class="state" :class="s.target">
          <strong>{{ s.target === 'dev' ? 'Development OpenNMS' : 'Production' }}</strong>
          <span :class="s.style.same ? 'ok' : 'bad'">{{ s.style.same ? 'has your CSS' : s.style.inContainer ? 'has another version of the CSS' : 'has no style file yet' }}</span>
          <span :class="s.style.served.same ? 'ok' : 'muted'">serves it: {{ s.style.served.status ? `HTTP ${s.style.served.status}${s.style.served.same ? ', your version' : ''}` : 'no answer' }}<template v-if="s.style.served.cacheControl">, Cache-Control: {{ s.style.served.cacheControl }}</template></span>
          <span v-if="s.target === 'prod'" class="muted">overlay copy: {{ s.style.overlays.length ? s.style.overlays.map((o) => `${o.onHost}${o.md5 === s.style.expected ? ' (yours)' : o.md5 ? ' (another version)' : ' (none yet)'}`).join(', ') : s.style.overlayNote }}</span>
          <span :class="s.mappings.upToDate ? 'ok' : 'bad'">icon mappings {{ s.mappings.upToDate ? 'as yours' : 'differ from yours' }}</span>
          <span v-for="i in s.icons ?? []" :key="i.name" :class="i.same ? 'ok' : 'bad'">{{ i.name }}: {{ i.same ? 'as your copy' : i.present ? 'differs from your copy' : 'not there yet' }}</span>
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
import { api, type IconFileReport, type IconsInfo, type PreviewData, type TargetName, type TopologyState, type TopologySummary } from '../api'
import CssEditor from '../components/CssEditor.vue'
import LearnBox from '../components/LearnBox.vue'
import TargetPanel from '../components/TargetPanel.vue'
import TopologyPreview, { type RuleReach } from '../components/TopologyPreview.vue'
import { describeReach, flawedGroup, iconOf, layersOf, partsCss, type Verdict } from '../lib/iconRules'
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
const iconReport = ref<IconsInfo | null>(null)
const iconError = ref('')
const repairing = ref('')
const skipped = ref<{ name: string; error: string }[]>([])
const reachRaw = ref<RuleReach[]>([])

const status = computed(() => store.status)
const devUrl = computed(() => `${location.protocol}//${location.hostname}:${store.status?.dev.port ?? 8980}/opennms`)
const saveText = computed(() => ({ saved: 'saved', saving: 'saving…', dirty: 'changed', error: `not saved: ${saveError.value}` })[saveState.value])

// The files of that OpenNMS, with your copies of icon files in place of the files of the same name: what an apply would give.
const shownData = computed<PreviewData | null>(() => {
  const d = data.value
  if (!d) return null
  const mine = iconReport.value?.workspace ?? []
  if (!mine.length) return d
  const byName = new Map(d.svgFiles.map((f) => [f.name, f]))
  for (const m of mine) byName.set(m.name, { name: m.name, text: m.text })
  return { ...d, svgFiles: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) }
})
const graphs = computed<Graph[]>(() => {
  if (!shownData.value) return []
  const all = shownData.value.views.flatMap((v) => parseGraphml(v.file, v.text))
  const withNodes = all.filter((g) => g.nodes.length)
  return withNodes.length ? withNodes : [demoGraph(iconIds(shownData.value.svgFiles))]
})
const icons = computed(() => (shownData.value ? iconIds(shownData.value.svgFiles) : []))
const nodes = computed<DrawnNode[]>(() => {
  const g = graphs.value[graphIndex.value]
  if (!g || !shownData.value) return []
  return drawnNodes(g, mappingTable(shownData.value, mappings.value), definedIds(shownData.value.svgFiles))
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
const selectedIcon = computed(() => (selected.value ? iconOf(iconReport.value?.files, selected.value.icon) : null))
const selectedErrors = computed(() => (selectedIcon.value?.problems ?? []).filter((p) => p.severity === 'error'))

const reaches = computed<{ reach: RuleReach; verdict: Verdict }[]>(() =>
  reachRaw.value.map((reach) => ({ reach, verdict: describeReach(reach, (group) => flawedGroup(iconReport.value?.files, group)) })),
)
const reachBad = computed(() => reaches.value.filter((r) => r.verdict.level === 'bad').length)
const reachWarn = computed(() => reaches.value.filter((r) => r.verdict.level === 'warn').length)

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

async function loadIcons(refresh = false) {
  iconError.value = ''
  try {
    iconReport.value = await api.icons(source.value, refresh)
  } catch (e) {
    iconError.value = `Could not check the icon files of ${source.value === 'dev' ? 'the development OpenNMS' : 'production'}: ${(e as Error).message}`
  }
}

function fileLevel(f: IconFileReport): 'ok' | 'warn' | 'bad' {
  const errors = (list: { severity: string }[]) => list.some((p) => p.severity === 'error')
  if (f.stock) return 'ok'
  if (errors(f.problems) && !(f.copy && !errors(f.copy.problems))) return 'bad'
  if (errors(f.problems)) return 'warn'
  if (f.copy && errors(f.copy.problems)) return 'bad'
  return 'ok'
}

function fileVerdict(f: IconFileReport): string {
  const where = source.value === 'dev' ? 'dev' : 'production'
  if (f.stock) return 'OpenNMS’s own file: not checked'
  const level = fileLevel(f)
  if (f.missing && f.copy) return 'your new file (not in OpenNMS yet)'
  if (level === 'warn') return `flawed in ${where}; your repaired copy waits for an apply`
  if (f.copy?.same) return `${where} has your copy`
  if (level === 'bad') return 'has a flaw'
  if (f.problems.length) return 'works (notes below)'
  return f.icons.length || f.hasStyle ? 'fine' : 'no icon in it'
}

/** A repair is offered when there is a flaw that has one: in the file, or in your copy of it. */
function canRepair(f: IconFileReport): boolean {
  const list = f.copy ? f.copy.problems : f.problems
  return list.some((p) => p.severity === 'error' && p.fix)
}

async function repair(name: string) {
  repairing.value = name
  iconError.value = ''
  try {
    iconReport.value = await api.repairIcon(source.value, name)
    planKey.value++
    void loadStates()
  } catch (e) {
    iconError.value = (e as Error).message
  } finally {
    repairing.value = ''
  }
}

async function removeCopy(name: string) {
  iconError.value = ''
  try {
    iconReport.value = await api.removeIconCopy(source.value, name)
    planKey.value++
    void loadStates()
  } catch (e) {
    iconError.value = (e as Error).message
  }
}

function scrollToIcons() {
  document.getElementById('icon-files')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// What the rules reach is counted in the preview page, a moment after the CSS or the drawing changed.
let reachTimer: number | undefined
function scheduleReach() {
  clearTimeout(reachTimer)
  reachTimer = window.setTimeout(() => {
    reachRaw.value = preview.value?.rules() ?? []
    skipped.value = preview.value?.skipped() ?? []
  }, 350)
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

watch(source, async () => {
  await loadPreview()
  await loadIcons()
})
watch(() => store.workspaceVersion, () => {
  void loadSummary(false)
  void loadIcons()
})
watch([css, shownData, previewNodes], scheduleReach)
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

/** Rules made from the drawing of the icon you clicked: its classes, and the colours the browser gives them. */
function insertParts() {
  const node = selected.value
  if (!node) return
  const found = selectedIcon.value
  const layers = layersOf(node.icon, found?.info ?? null)
  const read = preview.value?.partsOf(layers.map((l) => l.group)) ?? []
  const stacked = found?.problems.find((p) => p.kind === 'stacked')
  const note = stacked
    ? `${found?.file.name} holds the drawings of ${node.icon} inside #${node.icon}, so a node shows the last one, #${found?.info.visible}. Repair the file (Icon files, below) to colour the normal look on its own.`
    : null
  editor.value?.insert(
    partsCss(node.icon, found?.file.name ?? null, layers.map((l, i) => ({ when: l.when, use: l.use, group: read[i] ?? { id: l.group, found: false, parts: [], unclassed: 0 } })), note),
  )
  snippet.value = ''
}

function insertSnippet() {
  if (snippet.value === 'parts') return insertParts()
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

async function afterApply() {
  void loadStates()
  planKey.value++
  await loadPreview(true)
  await loadIcons(true)
}

onMounted(async () => {
  await loadSummary(true)
  await loadPreview()
  await loadIcons()
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
.warn { color: var(--warn); }
.link { background: none; border: 0; padding: 0; color: var(--link, #1d5fd1); text-decoration: underline; cursor: pointer; font: inherit; }
.reach { border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; background: var(--panel); font-size: 13px; }
.reach summary { cursor: pointer; display: flex; gap: 12px; flex-wrap: wrap; font-weight: 600; }
.reach summary span { font-weight: normal; }
.reach ul { list-style: none; padding: 0; margin: 8px 0; }
.reach li { display: grid; grid-template-columns: minmax(120px, 36%) 1fr; gap: 10px; padding: 4px 0 4px 8px; border-left: 3px solid var(--line); margin-bottom: 4px; }
.reach li code { font-size: 12px; word-break: break-all; }
.reach li.ok { border-left-color: var(--ok); }
.reach li.warn { border-left-color: var(--warn); }
.reach li.bad { border-left-color: var(--bad); }
.reach li.info { border-left-color: var(--muted); }
.flaw { border: 1px solid var(--warn); border-left-width: 4px; border-radius: 6px; padding: 6px 10px; background: color-mix(in srgb, var(--warn) 8%, transparent); }
.icon-files { margin-top: 18px; }
.icons-head { display: flex; align-items: baseline; gap: 12px; }
.icons-head h2 { margin: 0; }
.ifiles { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 8px; }
.ifile { border: 1px solid var(--line); border-left-width: 4px; border-radius: 8px; padding: 8px 12px; background: var(--panel); font-size: 13px; }
.ifile.ok { border-left-color: var(--ok); }
.ifile.warn { border-left-color: var(--warn); }
.ifile.bad { border-left-color: var(--bad); }
.ihead { display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline; }
.iname { font-weight: 600; }
.ids code { margin-left: 4px; }
.verdict { margin-left: auto; color: var(--muted); }
.ifile.bad .verdict { color: var(--bad); }
.ifile.warn .verdict { color: var(--warn); }
.problem { margin: 6px 0; padding-left: 8px; border-left: 3px solid var(--line); }
.problem.error { border-left-color: var(--bad); }
.problem p { margin: 2px 0; }
.fix { color: var(--text); }
.copy { margin: 6px 0; padding: 4px 8px; border-radius: 6px; background: color-mix(in srgb, var(--ok) 6%, transparent); }
.copy p { margin: 2px 0; }
.ifile .actions { margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap; }
.problems { color: var(--warn); font-size: 13px; }
</style>
