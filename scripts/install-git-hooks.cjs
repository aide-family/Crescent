#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const sourceDir = path.join(root, '.githooks')
const destDir = path.join(root, '.git', 'hooks')

if (!fs.existsSync(path.join(root, '.git')) || !fs.existsSync(sourceDir)) {
  process.exit(0)
}

fs.mkdirSync(destDir, { recursive: true })

for (const name of fs.readdirSync(sourceDir)) {
  const from = path.join(sourceDir, name)
  const to = path.join(destDir, name)
  if (!fs.statSync(from).isFile()) continue
  fs.copyFileSync(from, to)
  fs.chmodSync(to, 0o755)
}
