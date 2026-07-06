#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const helpers = [
  path.join(root, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'),
  path.join(root, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper')
]

for (const helper of helpers) {
  if (!fs.existsSync(helper)) continue

  const mode = fs.statSync(helper).mode
  if ((mode & 0o111) === 0) {
    fs.chmodSync(helper, mode | 0o755)
    console.log(`fixed executable permission: ${path.relative(root, helper)}`)
  }
}
