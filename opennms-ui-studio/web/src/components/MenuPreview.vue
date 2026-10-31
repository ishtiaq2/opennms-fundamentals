<template>
  <div class="bars">
    <div class="bar-title">
      <strong>The JSP bar</strong> (index.jsp, the node pages, the topology map …): <code>WEB-INF/templates/navbar.ftl</code>, filled by NavBarController
    </div>
    <nav class="jsp">
      <span class="logo">OpenNMS <em>Horizon</em></span>
      <span class="time">{{ time }}</span>
      <span class="bell">🔔</span>
      <span class="search">Search…</span>
      <span class="spacer"></span>
      <span v-for="m in tops" :key="'j' + m.id" class="item" :class="{ changed: m.changed }" :title="m.source + (m.changed ? '  (the JSP bar: after a restart of OpenNMS)' : '')">
        {{ jspName(m) }}<span v-if="m.items.length" class="caret">▾</span>
      </span>
      <span class="item" :class="{ changed: pluginsChanged }" title="navbar.ftl: <a name=&quot;nav-plugin-top&quot;> (line 94 in 33.1.8)">{{ pluginsJsp }}<span class="caret">▾</span></span>
      <span class="item fixed" title="navbar.ftl (fixed text)">Help<span class="caret">▾</span></span>
      <span class="item fixed" title="navbar.ftl: the user name">👤 admin<span class="caret">▾</span></span>
      <span class="item fixed" title="navbar.ftl: notification counts"><b class="pill">0</b><b class="pill">0</b></span>
      <span class="icon fixed" title="Quick-Add Node">⊕</span>
      <span class="icon fixed" title="Configure OpenNMS">⚙</span>
    </nav>
    <div class="dropdown" v-if="entries.length">
      <span class="dd-label">{{ pluginsJsp }} ▾ opens:</span>
      <span v-for="e in entries" :key="e" class="dd-item">{{ e }}</span>
    </div>

    <div class="bar-title">
      <strong>The Vue bar</strong> (/opennms/ui/#/…, every plugin page): <code>Menubar.vue</code>, compiled into <code>ui/assets/{{ bundle || 'index-….js' }}</code>
    </div>
    <nav class="vue">
      <span class="logo">◆</span>
      <span class="time">{{ time }}</span>
      <span class="bell">🔔</span>
      <span class="search">Search for nodes…</span>
      <span class="spacer"></span>
      <span class="item plain" title="Menubar.vue line 17: fixed text; its link is the url of the menu named Search in dispatcher-servlet.xml">Search</span>
      <span v-for="m in tops.filter((x) => x.name !== 'Search')" :key="'v' + m.id" class="item" :class="{ changed: m.changed }" :title="m.source + (m.changed ? '  (the Vue bar: at once, it asks /opennms/api/v2/menu at every page load)' : '')">
        {{ m.name }}<span class="caret">▾</span>
      </span>
      <span class="item" :class="{ changed: pluginsVueChanged }" title="Menubar.vue line 54 in 33.1.8, compiled into the bundle">{{ pluginsVue }}<span class="caret">▾</span></span>
      <span class="item fixed" title="MenuProvider.java (compiled Java)">Help<span class="caret">▾</span></span>
      <span class="item fixed" title="MenuProvider.java: the user name">👤 admin<span class="caret">▾</span></span>
      <span class="item fixed"><b class="pill">0</b><b class="pill">0</b></span>
      <span class="icon fixed" title="Quick-Add Node (MenuProvider.java)">⊕</span>
      <span class="icon fixed" title="Configure OpenNMS (MenuProvider.java)">⚙</span>
    </nav>
    <p class="legend">
      <span class="changed sample">Highlighted</span> words are the ones your labels change. Point at a word to see the file it comes from.
      Words in grey come from Java code or are fixed: the studio leaves them alone.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Labels, MenuState } from '../api'

const props = defineProps<{ state: MenuState | null; labels: Labels }>()

const time = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const tops = computed(() => {
  const names = props.state?.names ?? []
  return names
    .filter((n) => n.top)
    .map((n) => {
      const wanted = props.labels.menuNames[n.id]
      return {
        id: n.id,
        url: n.url,
        current: n.name,
        name: wanted ?? n.name,
        changed: wanted !== undefined && wanted !== n.name,
        items: names.filter((x) => !x.top && x.parent === n.name),
        source: `dispatcher-servlet.xml, line ${n.line} (id ${n.id}): both bars read it`,
      }
    })
})
// The JSP bar shows a new name only after OpenNMS started again; the preview shows what it will show then.
const jspName = (m: { name: string }) => m.name
const pluginsJsp = computed(() => props.labels.plugins ?? props.state?.plugins.jsp.text ?? 'Plugins')
const pluginsChanged = computed(() => !!props.labels.plugins && props.labels.plugins !== props.state?.plugins.jsp.text)
const loaded = computed(() => props.state?.plugins.vue.bundles.find((b) => b.loadedByPage) ?? props.state?.plugins.vue.bundles[0])
const bundle = computed(() => loaded.value?.file ?? props.state?.plugins.vue.entry ?? '')
const pluginsVue = computed(() => props.labels.plugins ?? loaded.value?.labels[0] ?? 'Plugins')
const pluginsVueChanged = computed(() => !!props.labels.plugins && props.labels.plugins !== loaded.value?.labels[0])
const entries = computed(() => (props.state?.pluginEntries ?? []).map((p) => p.menuEntry))
</script>

<style scoped>
.bars { display: flex; flex-direction: column; gap: 6px; }
.bar-title { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
nav { display: flex; align-items: center; gap: 4px; padding: 8px 12px; border-radius: 6px; color: #eee; font: 14px Arial, sans-serif; overflow-x: auto; white-space: nowrap; }
nav.jsp { background: #0a0c1b; }
nav.vue { background: #131736; }
.logo { font-weight: 700; color: white; margin-right: 8px; }
.logo em { font-weight: 400; color: #8fd14f; }
.time { font-size: 12px; color: #bbb; margin-right: 4px; }
.bell { font-size: 12px; }
.search { margin-left: 8px; padding: 3px 10px; border-radius: 12px; background: #2a2e4a; color: #999; font-size: 12px; }
.spacer { flex: 1; }
.item { padding: 4px 8px; border-radius: 4px; cursor: default; }
.item:hover { background: rgba(255, 255, 255, 0.1); }
.item.fixed, .icon.fixed { color: #9aa0b8; }
.icon { padding: 4px 6px; font-size: 16px; }
.caret { font-size: 10px; margin-left: 3px; opacity: 0.8; }
.changed { outline: 2px solid #ffcc33; background: rgba(255, 204, 51, 0.18); color: #fff3c4; }
.pill { display: inline-block; background: #4a5070; color: white; border-radius: 8px; padding: 0 6px; font-size: 11px; margin: 0 1px; }
.dropdown { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12.5px; padding-left: 12px; }
.dd-label { color: var(--muted); }
.dd-item { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 2px 8px; }
.legend { font-size: 12.5px; color: var(--muted); margin: 4px 0 0; }
.sample { padding: 0 4px; border-radius: 3px; color: var(--text); }
</style>
