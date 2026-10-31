import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import HistoryView from './views/HistoryView.vue'
import HomeView from './views/HomeView.vue'
import MenuView from './views/MenuView.vue'
import TopologyView from './views/TopologyView.vue'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/topology', component: TopologyView },
    { path: '/menu', component: MenuView },
    { path: '/history', component: HistoryView },
  ],
})

createApp(App).use(router).mount('#app')
