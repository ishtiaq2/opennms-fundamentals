<template>
  <div class="app">
    <aside class="side">
      <div class="brand">OpenNMS UI <span>Studio</span></div>
      <nav>
        <router-link to="/">Start</router-link>
        <router-link to="/topology">Topology</router-link>
        <router-link to="/menu">Menu bar</router-link>
        <router-link to="/history">History</router-link>
      </nav>
      <div class="envs" v-if="store.status">
        <div><span class="dot" :class="store.status.dev.running ? 'up' : 'down'"></span>dev</div>
        <div><span class="dot" :class="store.status.prod.running ? 'up' : 'down'"></span>production</div>
        <div class="ws">workspace: <code>{{ store.status.workspace.branch }}</code> <span v-if="store.status.workspace.changes">({{ store.status.workspace.changes }} changed)</span></div>
      </div>
      <div class="busy" v-if="store.status?.busy">{{ store.status.busy }}…</div>
    </aside>
    <main>
      <div v-if="store.statusError.includes('token')" class="token">
        <h2>Open the studio with its address</h2>
        <p>{{ store.statusError }}</p>
      </div>
      <router-view v-else />
    </main>
    <CommandLog class="log" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import CommandLog from './components/CommandLog.vue'
import { connectEvents, refreshStatus, store } from './store'

let timer: number | undefined
onMounted(() => {
  void refreshStatus()
  connectEvents()
  timer = window.setInterval(refreshStatus, 20000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.app { display: grid; grid-template-columns: 210px 1fr; grid-template-rows: 1fr auto; height: 100vh; }
.side { grid-row: 1 / 3; background: #10142b; color: #dfe3f0; padding: 14px 12px; display: flex; flex-direction: column; gap: 18px; }
.brand { font-weight: 700; font-size: 17px; letter-spacing: 0.01em; }
.brand span { color: #f28c28; }
nav { display: flex; flex-direction: column; gap: 2px; }
nav a { color: #c9cee0; text-decoration: none; padding: 7px 10px; border-radius: 6px; font-size: 14px; }
nav a.router-link-exact-active { background: #263061; color: white; }
nav a:hover { background: #1c2347; }
.envs { font-size: 12.5px; display: flex; flex-direction: column; gap: 4px; margin-top: auto; }
.envs code { color: white; }
.ws { color: #aab; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: #777; }
.dot.up { background: #4caf50; }
.dot.down { background: #e5534b; }
.busy { font-size: 12px; color: #f2c14e; }
main { overflow: auto; padding: 18px 22px 30px; }
.log { grid-column: 2; }
.token { max-width: 640px; }
@media (max-width: 760px) {
  .app { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; }
  .side { grid-row: auto; flex-direction: row; flex-wrap: wrap; align-items: center; }
  nav { flex-direction: row; }
  .envs { display: none; }
  .log { grid-column: 1; }
}
</style>
