const { spawnSync } = require('node:child_process')
const { resolve, relative, isAbsolute } = require('node:path')
const fs = require('node:fs')
const { homedir } = require('node:os')
const root = resolve(__dirname, '..')
const requested = process.argv[2] || 'universal'
const output = resolve(root, process.env.CRESCENT_LOCAL_BUILD_DIR || 'dist/local-macos')
const outputRelative = relative(resolve(root, 'dist'), output)
if (outputRelative.startsWith('..') || isAbsolute(outputRelative))
  throw new Error('Local artifacts must remain under dist/')
// Legacy architecture arguments also produce one Universal package.
if (!['x64', 'arm64', 'universal', 'all'].includes(requested))
  throw new Error('Expected universal (legacy x64, arm64 and all map to universal)')
const architectures = ['universal']
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  npm_config_cache: resolve(root, 'out/implementation/npm-cache')
}
// Prevent inherited signing secrets/configuration from changing the explicitly unsigned mode.
for (const key of [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER'
])
  delete env[key]
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (env.CRESCENT_OFFLINE_BUILD === '1') {
  const version = require(resolve(root, 'node_modules/electron/package.json')).version
  const cache = env.ELECTRON_CACHE || resolve(homedir(), 'Library/Caches/electron')
  const files = fs.readdirSync(cache, { recursive: true }).map(String)
  const needed = new Set(
    architectures.flatMap((arch) => (arch === 'universal' ? ['x64', 'arm64'] : [arch]))
  )
  for (const arch of needed)
    if (!files.some((file) => file.endsWith(`electron-v${version}-darwin-${arch}.zip`)))
      throw new Error(`Offline Electron cache missing for ${version} darwin-${arch}`)
  if (
    !fs.existsSync(
      resolve(
        env.ELECTRON_BUILDER_CACHE || resolve(homedir(), 'Library/Caches/electron-builder'),
        'dmg-builder@1.2.5'
      )
    )
  )
    throw new Error('Offline DMG tooling cache is missing')
}
run([resolve(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'])
for (const arch of architectures) {
  run([
    resolve(root, 'node_modules/electron-builder/cli.js'),
    '--mac',
    `--${arch}`,
    '--publish',
    'never',
    '-c.mac.identity=null',
    '-c.mac.notarize=false',
    '-c.mac.hardenedRuntime=false',
    `-c.directories.output=${resolve(output, arch)}`
  ])
}
