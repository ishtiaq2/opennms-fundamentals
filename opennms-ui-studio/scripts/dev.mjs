// npm run dev: the studio while you work on the studio itself.
//   - the server (server/src) restarts by itself when you save a .ts file (tsx watch)
//   - the page (web/src) is served by Vite at port 5173 and updates in the browser as you save (hot reload);
//     Vite sends /api/... on to the server.
// Open http://<this machine>:5173/?token=<the token the server prints> (the token works on both ports).
import { spawn } from 'node:child_process'

const children = [
  spawn('npm', ['run', 'dev', '-w', 'server'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', 'web'], { stdio: 'inherit' }),
]
const stop = () => {
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', (code) => code && stop())
