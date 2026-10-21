const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const directory = resolve(__dirname, '../experiments/agent-runtime')
const entry = resolve(directory, 'dist/bench.mjs')
buildSync({
  entryPoints: [resolve(directory, 'bench.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external'
})
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: directory,
  env: process.env,
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
