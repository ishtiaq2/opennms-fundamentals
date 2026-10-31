<template>
  <div class="page">
    <header class="page-head">
      <h1>Menu bar</h1>
      <p>
        The words in the bar at the top of every OpenNMS page. Type your words: the bars below show the result at once.
        Nothing changes in OpenNMS until you apply.
      </p>
    </header>

    <LearnBox title="Why there are two bars, and where each word comes from">
      <p>
        OpenNMS 33.1.8 draws the bar with two different programs. The JSP pages (<code>index.jsp</code> and most others,
        also the topology map) get it from <code>NavBarController</code>, which fills the template
        <code>jetty-webapps/opennms/WEB-INF/templates/navbar.ftl</code>. The pages of the newer Vue app
        (<code>/opennms/ui/#/…</code>, which include every plugin page) draw their own bar with <code>Menubar.vue</code>,
        compiled into one JavaScript file <code>jetty-webapps/opennms/ui/assets/index-&lt;hash&gt;.js</code>. That is why
        renaming "Plugins" in <code>navbar.ftl</code> alone gave "Tools" on index.jsp and "Plugins" on the plugin page.
      </p>
      <table><tbody>
        <tr><th>Words</th><th>Written in</th><th>A change shows</th></tr>
        <tr><td>Info, Status, Reports, Dashboards, Maps and their entries (and Search, which keeps its name: the Vue bar looks for it by name)</td><td><code>WEB-INF/dispatcher-servlet.xml</code> (Spring beans of class <code>…NavBarEntry</code>): both bars read it</td><td>Vue bar: at the next page load (<code>/opennms/api/v2/menu</code> reads the file at every request). JSP bar: after a restart of OpenNMS (the beans are made when it starts).</td></tr>
        <tr><td>Plugins</td><td><code>navbar.ftl</code> line 94 and <code>Menubar.vue</code> line 54 (compiled into the bundle)</td><td>JSP bar: within about 5 seconds (FreeMarker reads a changed template again). Vue bar: at the next page load.</td></tr>
        <tr><td>Help, the user menu, Quick-Add Node, …</td><td><code>navbar.ftl</code> and <code>MenuProvider.java</code> (compiled into <code>WEB-INF/lib/opennms-webapp-rest-*.jar</code>)</td><td>Only with a new build of OpenNMS: the studio shows them and leaves them alone.</td></tr>
      </tbody></table>
    </LearnBox>

    <div class="toolbar">
      <label>Read the files of <select v-model="source"><option value="dev">dev</option><option value="prod">production</option></select></label>
      <button type="button" class="ghost" @click="load">Read again</button>
      <span class="hint" v-if="state">{{ state.where }}</span>
      <span class="error" v-if="error">{{ error }}</span>
    </div>

    <section class="card">
      <h2>The Plugins menu</h2>
      <div class="row">
        <label class="big">Your word
          <input v-model="plugins" placeholder="leave empty to keep what OpenNMS has" maxlength="40" />
        </label>
        <span class="save" :class="{ bad: !!labelError }">{{ labelError || labelState }}</span>
      </div>
      <table v-if="state" class="sources"><tbody>
        <tr><th>Bar</th><th>File in OpenNMS (below <code>/usr/share/opennms</code>)</th><th>Says now</th></tr>
        <tr>
          <td>JSP</td>
          <td><code>{{ state.plugins.jsp.file }}</code><span v-if="state.plugins.jsp.line" class="muted">, line {{ state.plugins.jsp.line }}</span></td>
          <td><strong>{{ state.plugins.jsp.text ?? '(not found)' }}</strong></td>
        </tr>
        <tr v-for="b in state.plugins.vue.bundles" :key="b.file">
          <td>Vue</td>
          <td>
            <code>{{ state.plugins.vue.dir }}/{{ b.file }}</code>
            <span class="muted">{{ b.loadedByPage ? ' (ui/index.html loads this one)' : ' (not loaded by ui/index.html: an older build left in the folder?)' }}</span>
          </td>
          <td><strong>{{ b.labels.join(', ') || '(no label found)' }}</strong></td>
        </tr>
        <tr v-if="!state.plugins.vue.bundles.length"><td>Vue</td><td colspan="2" class="muted">no bundle with the compiled menu bar found in {{ state.plugins.vue.dir }}</td></tr>
      </tbody></table>
      <p class="hint">
        The entries of this menu ({{ state?.pluginEntries?.map((p) => p.menuEntry).join(', ') || 'none found' }}; {{ state?.pluginEntriesNote }}) come from
        <code>/rest/plugins</code>: each plugin names its own.
      </p>
    </section>

    <section class="card">
      <h2>Live preview of both bars</h2>
      <MenuPreview :state="state" :labels="{ plugins: plugins || null, menuNames: names }" />
    </section>

    <section class="card">
      <h2>Menu names from <code>dispatcher-servlet.xml</code> <small>(advanced: the JSP bar shows them after a restart)</small></h2>
      <table v-if="state" class="names"><tbody>
        <tr><th>Menu</th><th>Now</th><th>Your name</th><th>Line</th><th>id</th></tr>
        <tr v-for="n in state.names" :key="n.id" :class="{ item: !n.top }">
          <td>{{ n.top ? 'top' : `in ${n.parent}` }}</td>
          <td>{{ n.name }}</td>
          <td>
            <input v-if="!n.locked" :value="names[n.id] ?? ''" :placeholder="n.name" maxlength="40" @input="setName(n.id, n.name, ($event.target as HTMLInputElement).value)" />
            <span v-else class="locked" :title="n.locked">keeps its name (point here: why)</span>
          </td>
          <td class="muted">{{ n.line }}</td>
          <td><code>{{ n.id }}</code></td>
        </tr>
      </tbody></table>
    </section>

    <section class="card">
      <h2>Words the studio does not change</h2>
      <table v-if="state" class="fixed"><tbody>
        <tr><th>Words</th><th>JSP bar</th><th>Vue bar</th><th>Why</th></tr>
        <tr v-for="f in state.fixed" :key="f.text"><td>{{ f.text }}</td><td>{{ f.jsp }}</td><td>{{ f.vue }}</td><td>{{ f.why }}</td></tr>
      </tbody></table>
    </section>

    <section class="apply">
      <h2>Apply</h2>
      <div class="panels">
        <TargetPanel module="menu" target="dev" :where="status?.dev ? `container ${status.dev.container} on this machine` : ''" :refresh-key="planKey" @applied="afterApply" @undone="afterApply" />
        <TargetPanel module="menu" target="prod" :where="status?.prod ? `container ${status.prod.container} on ${status.prod.ssh}` : ''" :refresh-key="planKey" @applied="afterApply" @undone="afterApply" />
      </div>
      <div class="restart card">
        <p>
          New names from <code>dispatcher-servlet.xml</code> reach the JSP bar when OpenNMS starts again. On the development
          OpenNMS the studio can do that (<code>podman restart {{ status?.dev.container }}</code>, a few minutes). Production is
          never restarted by the studio: do it in your maintenance window.
        </p>
        <button type="button" class="ghost" :disabled="restarting" @click="restart">{{ restarting ? 'Restarting… (see the command log)' : 'Restart the development OpenNMS' }}</button>
        <span v-if="restartResult" class="hint">{{ restartResult }}</span>
      </div>
      <p class="hint">
        Check it in the real pages after an apply: <a :href="devUrl + '/index.jsp'" target="_blank">index.jsp</a> (JSP bar) and
        <a :href="devUrl + '/ui/index.html'" target="_blank">the Vue app</a> (Vue bar) of the development OpenNMS.
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, type MenuState, type TargetName } from '../api'
import LearnBox from '../components/LearnBox.vue'
import MenuPreview from '../components/MenuPreview.vue'
import TargetPanel from '../components/TargetPanel.vue'
import { store } from '../store'

const source = ref<TargetName>('dev')
const state = ref<MenuState | null>(null)
const error = ref('')
const plugins = ref('')
const names = ref<Record<string, string>>({})
const labelState = ref('saved')
const labelError = ref('')
const planKey = ref(0)
const restarting = ref(false)
const restartResult = ref('')

const status = computed(() => store.status)
const devUrl = computed(() => `${location.protocol}//${location.hostname}:${store.status?.dev.port ?? 8980}/opennms`)

async function load() {
  error.value = ''
  try {
    state.value = await api.menuState(source.value)
    if (labelState.value === 'saved') {
      quiet = true
      plugins.value = state.value.desired.plugins ?? ''
      names.value = { ...state.value.desired.menuNames }
      await Promise.resolve()
      quiet = false
    }
  } catch (e) {
    error.value = (e as Error).message
  }
}

let timer: number | undefined
let quiet = false
function scheduleSave() {
  if (quiet) return
  labelState.value = 'changed'
  clearTimeout(timer)
  timer = window.setTimeout(async () => {
    labelState.value = 'saving…'
    try {
      await api.saveLabels({ plugins: plugins.value.trim() || null, menuNames: names.value })
      labelState.value = 'saved'
      labelError.value = ''
      planKey.value++
    } catch (e) {
      labelError.value = (e as Error).message
      labelState.value = 'changed'
    }
  }, 600)
}

function setName(id: string, now: string, value: string) {
  const next = { ...names.value }
  if (value.trim() && value.trim() !== now) next[id] = value.trim()
  else delete next[id]
  names.value = next
  scheduleSave()
}

watch(plugins, () => scheduleSave(), { flush: 'sync' })
watch(source, load)
watch(() => store.workspaceVersion, () => {
  if (labelState.value === 'saved') void load()
})

async function restart() {
  restarting.value = true
  restartResult.value = ''
  store.logOpen = true
  try {
    const r = await api.restartDev()
    restartResult.value = r.ok ? `The development OpenNMS answers again after ${r.seconds} s.` : 'It did not answer within 15 minutes: see kit/dev.sh status.'
  } catch (e) {
    restartResult.value = (e as Error).message
  } finally {
    restarting.value = false
    await load()
    planKey.value++
  }
}

function afterApply() {
  void load()
  planKey.value++
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 12px 0; font-size: 13px; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--panel); margin-bottom: 14px; }
.card h2 { margin: 0 0 8px; font-size: 16px; }
.card h2 small { font-weight: normal; color: var(--muted); font-size: 12.5px; }
.row { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
.big input { font-size: 16px; width: 280px; display: block; margin-top: 4px; }
.save { font-size: 12px; color: var(--muted); }
.save.bad { color: var(--bad); }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 8px; }
th, td { border-bottom: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
.names tr.item td:first-child { padding-left: 22px; color: var(--muted); }
.names input { width: 100%; min-width: 140px; }
.locked { color: var(--muted); font-size: 12.5px; cursor: help; border-bottom: 1px dotted var(--muted); }
.fixed td { font-size: 12.5px; }
.panels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 1100px) { .panels { grid-template-columns: 1fr; } }
.restart { margin-top: 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.restart p { margin: 0; flex: 1 1 420px; font-size: 13px; }
.muted, .hint { color: var(--muted); }
.hint { font-size: 13px; }
.error { color: var(--bad); }
</style>
