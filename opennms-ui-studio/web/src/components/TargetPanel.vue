<template>
  <div class="target-panel" :class="target">
    <div class="head">
      <h3>{{ target === 'dev' ? 'Development OpenNMS' : 'Production' }}</h3>
      <span class="where" v-if="where">{{ where }}</span>
      <button type="button" class="ghost" @click="load" :disabled="loading">{{ loading ? 'Reading…' : 'Read again' }}</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="plan">
      <p v-if="!changing.length" class="same">
        {{ target === 'dev' ? 'The development OpenNMS' : 'Production' }} has all of this already: nothing to apply.
      </p>
      <p v-else class="intro">An apply writes {{ changing.length }} file{{ changing.length > 1 ? 's' : '' }} into the {{ where }}{{ target === 'prod' ? ' and the overlay folders below' : '' }}:</p>
      <ul v-if="problems.length" class="problems">
        <li v-for="p in problems" :key="p">{{ p }}</li>
      </ul>
      <article v-for="f in changing" :key="f.rel" class="file">
        <header>
          <code class="path">{{ f.rel }}</code>
          <span class="md5">md5 {{ short(f.md5Before) }} → {{ short(f.md5After) }}</span>
        </header>
        <p class="why">{{ f.why }}</p>
        <p v-if="target === 'prod'" class="overlay">
          <template v-if="f.overlays.length">Overlay copy (kept at every start): <code v-for="o in f.overlays" :key="o">{{ o }}</code></template>
          <template v-else>{{ f.overlayNote }}</template>
        </p>
        <p v-if="target === 'prod' && f.ownedByOpenNMS && f.overlays.length" class="upgrade">
          This is a file of OpenNMS itself. Before you upgrade OpenNMS (a new image), remove its overlay copy: at every start the
          copy replaces the file of the new version. Then apply your changes to the new version again.
        </p>
        <DiffBlock :diff="f.diff" :excerpt="f.excerpt" />
      </article>

      <div class="actions">
        <template v-if="!confirming">
          <button type="button" :class="target === 'prod' ? 'danger' : 'primary'" :disabled="!changing.length || working" @click="startApply">
            {{ working ? 'Working…' : target === 'dev' ? 'Apply to the development OpenNMS' : 'Apply to production…' }}
          </button>
          <button type="button" class="ghost" :disabled="working || !canUndo" :title="lastApply ? `${lastApply.id}: ${lastApply.files.map((f) => f.rel).join(', ')}` : ''" @click="startUndo">Undo the last {{ module }} apply on {{ target }}</button>
        </template>
        <div v-else class="confirm">
          <p>
            {{ confirming === 'apply' ? 'This changes production now. The files it replaces are kept, and Undo puts them back.' : `This puts back the files of the last ${module} apply on production (${lastApply?.id ?? ''}).` }}
            Type <strong>production</strong> to go ahead.
          </p>
          <input v-model="typed" placeholder="production" @keyup.enter="confirmed" autofocus />
          <button type="button" class="danger" :disabled="typed !== 'production'" @click="confirmed">{{ confirming === 'apply' ? 'Apply to production' : 'Undo on production' }}</button>
          <button type="button" class="ghost" @click="cancel">Cancel</button>
        </div>
      </div>
    </template>

    <div v-if="result" class="result">
      <h4>{{ result.title }}</h4>
      <ul>
        <li v-for="c in result.checks" :key="c.what" :class="c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'unknown'">
          <span class="mark">{{ c.ok === true ? '✓' : c.ok === false ? '✗' : '?' }}</span> {{ c.what }} <span class="detail">({{ c.detail }})</span>
        </li>
      </ul>
      <p v-if="result.note" class="note">{{ result.note }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, type ApplyRecord, type Check, type PlannedFile, type TargetName } from '../api'
import { refreshStatus } from '../store'
import DiffBlock from './DiffBlock.vue'

const props = defineProps<{ module: 'topology' | 'menu'; target: TargetName; where?: string; refreshKey?: number }>()
const emit = defineEmits<{ applied: []; undone: [] }>()

const plan = ref<PlannedFile[] | null>(null)
const problems = ref<string[]>([])
const loading = ref(false)
const working = ref(false)
const error = ref('')
const confirming = ref<'apply' | 'undo' | null>(null)
const typed = ref('')
const canUndo = ref(false)
const lastApply = ref<ApplyRecord | null>(null)
const result = ref<{ title: string; checks: Check[]; note?: string } | null>(null)

const changing = computed(() => (plan.value ?? []).filter((f) => f.md5Before !== f.md5After))
const short = (s: string | null) => (s ? s.slice(0, 8) : 'none')

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (props.module === 'topology') {
      plan.value = await api.topologyPlan(props.target)
      problems.value = []
    } else {
      const p = await api.menuPlan(props.target)
      plan.value = p.files
      problems.value = p.problems
    }
    const deploys = await api.deploys() // newest first
    lastApply.value = deploys.find((d) => d.target === props.target && d.module === props.module && !d.undone) ?? null
    canUndo.value = lastApply.value !== null
  } catch (e) {
    error.value = (e as Error).message
    plan.value = null
  } finally {
    loading.value = false
  }
}

function startApply() {
  if (props.target === 'prod') {
    confirming.value = 'apply'
    typed.value = ''
  } else void apply()
}
function startUndo() {
  if (props.target === 'prod') {
    confirming.value = 'undo'
    typed.value = ''
  } else void undo()
}
function cancel() {
  confirming.value = null
}
function confirmed() {
  if (typed.value !== 'production') return
  const what = confirming.value
  confirming.value = null
  if (what === 'apply') void apply()
  else void undo()
}

async function apply() {
  working.value = true
  error.value = ''
  result.value = null
  try {
    const record = props.module === 'topology' ? await api.applyTopology(props.target) : await api.applyMenu(props.target)
    result.value = {
      title: `Applied (${record.files.length} file${record.files.length > 1 ? 's' : ''}; the old ones are kept in ${record.backupDir}/; snapshot ${record.commit ?? '-'})`,
      checks: record.checks,
      note: props.target === 'dev' ? 'Reload the page of the development OpenNMS to see it.' : 'Reload production’s page to see it.',
    }
    emit('applied')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    working.value = false
    await load()
    void refreshStatus()
  }
}

async function undo() {
  working.value = true
  error.value = ''
  result.value = null
  try {
    const r = await api.undo(props.target, props.module)
    result.value = { title: `Undone: ${r.record.id} (${r.record.module})`, checks: r.checks }
    emit('undone')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    working.value = false
    await load()
    void refreshStatus()
  }
}

onMounted(load)
watch(() => props.refreshKey, load)
defineExpose({ load })
</script>

<style scoped>
.target-panel { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--panel); border-top: 4px solid var(--dev); }
.target-panel.prod { border-top-color: var(--prod); }
.head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.head h3 { margin: 0; font-size: 16px; }
.where { color: var(--muted); font-size: 12.5px; }
.head button { margin-left: auto; }
.intro, .same { margin: 8px 0; }
.same { color: var(--ok); }
.file { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
.file header { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
.path { font: 12.5px var(--mono); font-weight: 600; word-break: break-all; }
.md5 { color: var(--muted); font: 11.5px var(--mono); }
.why { margin: 4px 0; font-size: 13px; }
.overlay { font-size: 12.5px; color: var(--muted); margin: 4px 0 6px; }
.overlay code { display: block; font: 12px var(--mono); color: var(--text); word-break: break-all; }
.problems { color: var(--warn); font-size: 13px; }
.upgrade { font-size: 12.5px; color: var(--warn); margin: 2px 0 6px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.confirm { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; border: 1px solid var(--prod); border-radius: 8px; padding: 8px 10px; background: color-mix(in srgb, var(--prod) 6%, transparent); }
.confirm p { margin: 0; flex-basis: 100%; font-size: 13px; }
.result { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; }
.result h4 { margin: 0 0 4px; font-size: 13.5px; }
.result ul { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.result li { padding: 2px 0; }
.result .ok .mark { color: var(--ok); font-weight: 700; }
.result .bad { color: var(--bad); }
.result .unknown .mark { color: var(--warn); font-weight: 700; }
.detail { color: var(--muted); font-size: 12px; }
.note { color: var(--muted); font-size: 12.5px; }
.error { color: var(--bad); }
</style>
