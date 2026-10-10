const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const root = resolve(__dirname, '..')
const requested = process.argv[2] || 'all'
const architectures = requested === 'all' ? ['x64', 'arm64', 'universal'] : [requested]
if (architectures.some((arch) => !['x64', 'arm64', 'universal'].includes(arch)))
  throw new Error('Expected x64, arm64, universal or all')
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
    `-c.directories.output=dist/local-20261005/${arch}`
  ])
}
