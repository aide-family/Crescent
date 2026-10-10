/* CI policy checks; unit tests remain local-only per AGENTS.md. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
let checks = 0
const check = (condition, message) => {
  assert.ok(condition, message)
  checks++
}
const preload = walk(path.join(root, 'src/preload'))
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
check(
  !preload.includes("from '@electron-toolkit/preload'"),
  'Preload must not expose unrestricted toolkit IPC'
)
check(!/exposeInMainWorld\([^\n]*ipcRenderer/.test(preload), 'Raw IPC must not be exposed')
for (const file of walk(path.join(root, 'src/main')).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts')
)) {
  if (file.endsWith('/ipc-security.ts')) continue
  check(
    !/\bipcMain\.(handle|on)\(/.test(fs.readFileSync(file, 'utf8')),
    `Unvalidated IPC registration: ${file}`
  )
}
check(
  read('src/main/index.ts').includes('initializePrivateFiles()'),
  'Private file initialization is required'
)
check(read('src/main/index.ts').includes('sandbox: true'), 'Renderer sandbox must stay enabled')
check(
  read('src/main/agent/pi-mcp-tools.ts').includes('!authorize'),
  'MCP tools must fail closed without host authorization'
)
check(
  read('src/main/agent/command-approval.ts').includes(
    'pendingCommandApprovals.get(requestId)?.webContents.id !== ownerId'
  ),
  'Command approval must validate its owner'
)
check(
  read('src/main/logging.ts').includes('redactSensitiveText(message)'),
  'Log sink must redact secrets'
)
check(
  !read('electron-builder.yml').includes('NSCameraUsageDescription'),
  'Camera permission must not be requested'
)
for (const file of walk(path.join(root, 'src/renderer/src')).filter(
  (file) => /\.[jt]sx?$/.test(file) && !file.endsWith('.test.ts')
)) {
  check(
    !/from ['"](?:node:|electron['"]|fs['"]|child_process['"])/.test(fs.readFileSync(file, 'utf8')),
    `Privileged renderer import: ${file}`
  )
}
console.log(`Security boundary policy: ${checks} checks passed.`)
console.log(
  'Unit tests are local-only. Run npm run test:local before committing; CI does not claim unit-test coverage.'
)
