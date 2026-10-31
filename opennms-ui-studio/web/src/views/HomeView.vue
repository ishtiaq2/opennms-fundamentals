<template>
  <div class="page">
    <header class="page-head">
      <h1>OpenNMS UI Studio</h1>
      <p>
        Change how OpenNMS looks, see it at once, try it on the development OpenNMS, then apply it to production.
        Every file the studio touches is named, the commands it runs for you are in the command log at the bottom, and
        every change is in the history of your workspace.
      </p>
    </header>

    <p v-if="store.statusError" class="error">{{ store.statusError }}</p>

    <div class="envs" v-if="s">
      <section class="env dev">
        <h2>Development OpenNMS</h2>
        <p><span class="dot" :class="s.dev.running ? 'up' : 'down'"></span>container <code>{{ s.dev.container }}</code> on this machine: {{ s.dev.running ? 'running' : 'not running (kit/dev.sh up)' }}</p>
        <p>Web: <a :href="devUrl" target="_blank">{{ devUrl }}</a></p>
      </section>
      <section class="env prod">
        <h2>Production</h2>
        <p><span class="dot" :class="s.prod.running ? 'up' : 'down'"></span>container <code>{{ s.prod.container }}</code> on <code>{{ s.prod.ssh }}</code>:
          {{ s.prod.reachable ? (s.prod.running ? 'running' : 'not running') : 'not reachable' }}</p>
        <p v-if="!s.prod.reachable" class="error small">{{ s.prod.message }}</p>
        <p>Web: <a :href="s.prod.url" target="_blank">{{ s.prod.url }}</a></p>
      </section>
      <section class="env ws">
        <h2>Your workspace</h2>
        <p><code>{{ s.workspace.path }}</code></p>
        <p>experiment <code>{{ s.workspace.branch }}</code>, snapshot <code>{{ s.workspace.head }}</code>, {{ s.workspace.changes }} changed file{{ s.workspace.changes === 1 ? '' : 's' }} since then</p>
      </section>
    </div>

    <section class="flow">
      <div class="stage"><h3>1. Preview</h3><p>Edit in the studio. The preview shows the result as you type. OpenNMS does not change.</p></div>
      <div class="arrow">→</div>
      <div class="stage"><h3>2. Development OpenNMS</h3><p>Apply: the studio writes the files into the dev container (<code>podman exec -i … cat &gt; file</code>). Look at the real pages.</p></div>
      <div class="arrow">→</div>
      <div class="stage"><h3>3. Production</h3><p>Apply: the same files go into the production container over ssh, and into its overlay folders, so that a restart keeps them. Undo is one click.</p></div>
    </section>

    <div class="modules">
      <router-link to="/topology" class="module">
        <h2>Topology</h2>
        <p>The look of <code>/opennms/topology</code>: the background behind the icons, frames, labels, links, sizes, and the icon of each node.</p>
        <p class="files">Changes <code>svg/zz-topology-styles.svg</code> and <code>etc/…icons.default.cfg</code></p>
      </router-link>
      <router-link to="/menu" class="module">
        <h2>Menu bar</h2>
        <p>The words in the bar at the top: "Plugins" (or your word) in both bars, and the menu names of <code>dispatcher-servlet.xml</code>.</p>
        <p class="files">Changes <code>navbar.ftl</code>, <code>ui/assets/index-….js</code>, <code>dispatcher-servlet.xml</code></p>
      </router-link>
      <router-link to="/history" class="module">
        <h2>History and experiments</h2>
        <p>Snapshots and experiments of your files (git), and every apply with its checks and backups.</p>
        <p class="files">Your files in <code>workspace/</code>; backups in <code>backups/</code></p>
      </router-link>
    </div>

    <LearnBox title="The OpenNMS files this studio can change (in the container, below /usr/share/opennms)" open>
      <table><tbody>
        <tr><th>File</th><th>Module</th><th>What reads it</th><th>On production also in</th></tr>
        <tr><td><code>jetty-webapps/opennms/svg/zz-topology-styles.svg</code></td><td>Topology</td><td>the topology page, which puts every svg file of that folder into the page</td><td>the jetty-webapps overlay folder (<code>opennms/svg/…</code>)</td></tr>
        <tr><td><code>etc/org.opennms.features.topology.app.icons.default.cfg</code></td><td>Topology</td><td>OpenNMS (Karaf) within a second: the icon of each node</td><td>the etc volume keeps it; an overlay copy is updated where one exists</td></tr>
        <tr><td><code>jetty-webapps/opennms/WEB-INF/templates/navbar.ftl</code></td><td>Menu bar</td><td>NavBarController: the bar of the JSP pages</td><td>the jetty-webapps overlay folder (<code>opennms/WEB-INF/templates/…</code>)</td></tr>
        <tr><td><code>jetty-webapps/opennms/ui/assets/index-&lt;hash&gt;.js</code></td><td>Menu bar</td><td>the browser, on the pages of the Vue app: its compiled menu bar</td><td>the jetty-webapps overlay folder (<code>opennms/ui/assets/…</code>)</td></tr>
        <tr><td><code>jetty-webapps/opennms/WEB-INF/dispatcher-servlet.xml</code></td><td>Menu bar</td><td>/opennms/api/v2/menu at every request (Vue bar); Spring when OpenNMS starts (JSP bar)</td><td>the jetty-webapps overlay folder</td></tr>
      </tbody></table>
      <p>Why the overlay folders: the OpenNMS image copies them into OpenNMS at every start of the container. A file only in the container is replaced by an older overlay copy at the next start, or lost when the container is created again.</p>
    </LearnBox>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import LearnBox from '../components/LearnBox.vue'
import { refreshStatus, store } from '../store'

const s = computed(() => store.status)
const devUrl = computed(() => `${location.protocol}//${location.hostname}:${store.status?.dev.port ?? 8980}/opennms`)
onMounted(refreshStatus)
</script>

<style scoped>
.envs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 14px 0; }
@media (max-width: 1000px) { .envs { grid-template-columns: 1fr; } }
.env { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; border-top: 4px solid var(--accent); font-size: 13.5px; }
.env.dev { border-top-color: var(--dev); }
.env.prod { border-top-color: var(--prod); }
.env h2 { margin: 0 0 6px; font-size: 15px; }
.env p { margin: 4px 0; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--muted); }
.dot.up { background: var(--ok); }
.dot.down { background: var(--bad); }
.flow { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 10px; align-items: center; margin: 18px 0; }
@media (max-width: 1000px) { .flow { grid-template-columns: 1fr; } .arrow { display: none; } }
.stage { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; font-size: 13.5px; }
.stage h3 { margin: 0 0 4px; font-size: 14px; }
.arrow { font-size: 22px; color: var(--muted); }
.modules { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 18px; }
@media (max-width: 1000px) { .modules { grid-template-columns: 1fr; } }
.module { display: block; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; color: inherit; text-decoration: none; }
.module:hover { border-color: var(--accent); }
.module h2 { margin: 0 0 6px; font-size: 16px; color: var(--accent); }
.module p { margin: 4px 0; font-size: 13.5px; }
.files { color: var(--muted); font-size: 12.5px !important; }
.error { color: var(--bad); }
.small { font-size: 12.5px; }
</style>
