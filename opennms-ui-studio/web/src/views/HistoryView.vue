<template>
  <div class="page">
    <header class="page-head">
      <h1>History and experiments</h1>
      <p>
        Your workspace (<code>workspace/</code>) is a git repository. A <strong>snapshot</strong> is a git commit of your
        files; an <strong>experiment</strong> is a git branch, a line of snapshots you can try and come back from. Every apply
        makes a snapshot too, so you can always see which version each OpenNMS got. The command log shows the git commands.
      </p>
    </header>

    <LearnBox title="The same in a terminal">
      <table><tbody>
        <tr><th>In the studio</th><th>git, in the folder workspace/</th></tr>
        <tr><td>Snapshot</td><td><code>git add -A &amp;&amp; git commit -m "your message"</code></td></tr>
        <tr><td>Changes since the last snapshot</td><td><code>git diff HEAD</code></td></tr>
        <tr><td>New experiment</td><td><code>git switch -c experiment/&lt;name&gt;</code> (your current changes go with you)</td></tr>
        <tr><td>Switch to an experiment</td><td><code>git switch &lt;branch&gt;</code></td></tr>
        <tr><td>Compare two snapshots</td><td><code>git diff &lt;one&gt; &lt;other&gt;</code></td></tr>
        <tr><td>Take files back from a snapshot</td><td><code>git restore --source=&lt;snapshot&gt; -- topology menu</code></td></tr>
      </tbody></table>
    </LearnBox>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="grid" v-if="info">
      <section class="card">
        <h2>Now: <code>{{ info.branch }}</code> at <code>{{ info.head }}</code></h2>
        <p v-if="!info.changes.length" class="muted">No changes since the last snapshot.</p>
        <template v-else>
          <p>Changed since the last snapshot:</p>
          <ul class="files"><li v-for="c in info.changes" :key="c.path"><code>{{ c.status }}</code> {{ c.path }}</li></ul>
          <DiffBlock :diff="info.diff" />
        </template>
        <div class="row">
          <input v-model="message" placeholder="What did you try? (the message of the snapshot)" @keyup.enter="snapshot" />
          <button type="button" class="primary" :disabled="!info.changes.length" @click="snapshot">Snapshot</button>
        </div>
      </section>

      <section class="card">
        <h2>Experiments</h2>
        <ul class="branches">
          <li v-for="b in info.branches" :key="b.name" :class="{ current: b.current }">
            <code>{{ b.name }}</code> <span class="muted">{{ b.short }} · {{ when(b.date) }} · {{ b.message }}</span>
            <button v-if="!b.current" type="button" class="ghost small" @click="switchTo(b.name)">Switch</button>
            <span v-else class="badge">current</span>
          </li>
        </ul>
        <div class="row">
          <input v-model="experiment" placeholder="name of a new experiment, for example amber-backgrounds" @keyup.enter="newExperiment" />
          <button type="button" @click="newExperiment" :disabled="!experiment.trim()">New experiment</button>
        </div>
        <p class="hint">A new experiment starts from where you are, with your current changes. Switching needs a snapshot of your changes first.</p>
      </section>
    </div>

    <section class="card" v-if="info">
      <h2>Snapshots of <code>{{ info.branch }}</code></h2>
      <p class="hint">Pick two to compare (the older first), or take the files of one back into your workspace.</p>
      <table class="log"><tbody>
        <tr><th></th><th>Snapshot</th><th>When</th><th>Message</th><th></th></tr>
        <tr v-for="s in info.log" :key="s.hash">
          <td><input type="checkbox" :checked="picked.includes(s.short)" @change="pick(s.short)" /></td>
          <td><code>{{ s.short }}</code> <span v-if="s.refs" class="refs">{{ s.refs }}</span></td>
          <td class="muted">{{ when(s.date) }}</td>
          <td>{{ s.message }}</td>
          <td><button type="button" class="ghost small" @click="restore(s.short)">Take its files back</button></td>
        </tr>
      </tbody></table>
      <div class="row">
        <button type="button" :disabled="picked.length !== 2" @click="compare">Compare the two picked</button>
        <button type="button" class="ghost" :disabled="picked.length !== 1" @click="compareNow">Compare the picked one with now</button>
      </div>
      <DiffBlock v-if="comparison !== null" :diff="comparison" />
    </section>

    <section class="card">
      <h2>Applies</h2>
      <p class="hint">Every apply, newest first: what went where, the snapshot it applied, the checks. The files it replaced are in its backup folder.</p>
      <table class="deploys"><tbody>
        <tr><th>When</th><th>Where</th><th>Module</th><th>Snapshot</th><th>Files</th><th>Checks</th><th></th></tr>
        <tr v-for="d in deploys" :key="d.id" :class="{ undone: d.undone }">
          <td class="muted">{{ when(d.time) }}</td>
          <td><span class="tag" :class="d.target">{{ d.target }}</span></td>
          <td>{{ d.module }}</td>
          <td><code>{{ d.commit ?? '-' }}</code></td>
          <td><div v-for="f in d.files" :key="f.rel"><code>{{ f.rel }}</code><span v-for="o in f.overlays" :key="o.onHost" class="muted"> + {{ o.onHost }}</span></div></td>
          <td>{{ d.checks.filter((c) => c.ok === true).length }} ok<span v-if="d.checks.some((c) => c.ok === false)" class="bad">, {{ d.checks.filter((c) => c.ok === false).length }} failed</span></td>
          <td class="muted">{{ d.undone ? `undone ${when(d.undone)}` : d.backupDir }}</td>
        </tr>
      </tbody></table>
      <p v-if="!deploys.length" class="muted">Nothing applied yet.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, type ApplyRecord, type HistoryInfo } from '../api'
import DiffBlock from '../components/DiffBlock.vue'
import LearnBox from '../components/LearnBox.vue'
import { refreshStatus, store } from '../store'

const info = ref<HistoryInfo | null>(null)
const deploys = ref<ApplyRecord[]>([])
const error = ref('')
const message = ref('')
const experiment = ref('')
const picked = ref<string[]>([])
const comparison = ref<string | null>(null)

const when = (iso: string) => new Date(iso).toLocaleString()

async function load() {
  try {
    info.value = await api.history()
    deploys.value = await api.deploys()
    error.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function act(work: () => Promise<unknown>) {
  try {
    await work()
    error.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
  await load()
  void refreshStatus()
}

const snapshot = () => act(async () => {
  await api.snapshot(message.value || 'Snapshot')
  message.value = ''
})
const newExperiment = () => act(async () => {
  await api.newExperiment(experiment.value)
  experiment.value = ''
})
const switchTo = (b: string) => act(() => api.switchBranch(b))
const restore = (commit: string) => act(() => api.restore(commit, ['topology', 'menu']))

function pick(short: string) {
  picked.value = picked.value.includes(short) ? picked.value.filter((x) => x !== short) : [...picked.value, short].slice(-2)
}
async function compare() {
  const [a, b] = picked.value
  const order = info.value?.log.map((s) => s.short) ?? []
  const [older, newer] = order.indexOf(a) > order.indexOf(b) ? [a, b] : [b, a]
  comparison.value = (await api.diff(older, newer)).diff
}
async function compareNow() {
  comparison.value = (await api.diff(picked.value[0])).diff
}

watch(() => store.workspaceVersion, load)
onMounted(load)
</script>

<style scoped>
.grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; margin: 14px 0; }
@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--panel); margin-bottom: 14px; }
.card h2 { margin: 0 0 8px; font-size: 16px; }
.row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.row input { flex: 1 1 260px; }
.files { margin: 4px 0 8px; padding-left: 18px; font-size: 13px; }
.branches { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.branches li { padding: 4px 0; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.branches li.current code { font-weight: 700; }
.badge { font-size: 11px; background: var(--accent); color: white; border-radius: 4px; padding: 1px 6px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border-bottom: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
th { color: var(--muted); font-size: 12px; }
.refs { font-size: 11px; color: var(--accent); }
.tag { color: white; border-radius: 4px; padding: 1px 6px; font-size: 11px; text-transform: uppercase; }
.tag.dev { background: var(--dev); }
.tag.prod { background: var(--prod); }
.undone { opacity: 0.55; }
.small { padding: 2px 8px; font-size: 12px; }
.muted, .hint { color: var(--muted); }
.hint { font-size: 13px; }
.bad { color: var(--bad); }
.error { color: var(--bad); }
</style>
