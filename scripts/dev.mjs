// Avvia server API (porta 8787) e interfaccia Vite (porta 5173) in sviluppo.
import { spawn } from 'node:child_process';
const run = (args) => spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [run(['run', 'dev', '-w', 'server']), run(['run', 'dev', '-w', 'web'])];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
