#!/usr/bin/env node
/**
 * Rasterize vector masters into Electron packaging icons.
 *
 * Source of truth:
 *   build/icons/crescent-app.svg  → build/icon.png + resources/icon.png + .icns/.ico
 *   build/icons/crescent-mark.svg → renderer favicon / UI mark
 *
 * Usage:
 *   npm run icons
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const appSvg = path.join(root, 'build/icons/crescent-app.svg')
const markSvg = path.join(root, 'build/icons/crescent-mark.svg')
const outBuildPng = path.join(root, 'build/icon.png')
const outResourcesPng = path.join(root, 'resources/icon.png')
const outIcns = path.join(root, 'build/icon.icns')
const outIco = path.join(root, 'build/icon.ico')
const outMarkPng = path.join(root, 'src/renderer/src/assets/crescent-mark.png')
const outFaviconSvg = path.join(root, 'src/renderer/src/assets/crescent-logo.svg')

async function renderPng(sharp, svgPath, size, background) {
  return sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: 'contain', background })
    .withMetadata({ density: 72 })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Build a multi-size ICO that embeds PNG payloads (Vista+). */
function createIcoFromPngs(entries) {
  const count = entries.length
  const headerSize = 6
  const dirEntrySize = 16
  const dataOffset = headerSize + dirEntrySize * count

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const dirs = []
  const payloads = []
  let offset = dataOffset

  for (const entry of entries) {
    const dir = Buffer.alloc(dirEntrySize)
    const width = entry.size >= 256 ? 0 : entry.size
    const height = entry.size >= 256 ? 0 : entry.size
    dir.writeUInt8(width, 0)
    dir.writeUInt8(height, 1)
    dir.writeUInt8(0, 2)
    dir.writeUInt8(0, 3)
    dir.writeUInt16LE(1, 4)
    dir.writeUInt16LE(32, 6)
    dir.writeUInt32LE(entry.png.length, 8)
    dir.writeUInt32LE(offset, 12)
    dirs.push(dir)
    payloads.push(entry.png)
    offset += entry.png.length
  }

  return Buffer.concat([header, ...dirs, ...payloads])
}

function buildIcnsWithIconutil(sharpAppPng, sharp) {
  if (process.platform !== 'darwin') {
    console.warn(
      'Skipping .icns generation (iconutil is macOS-only). Keep existing build/icon.icns or generate on macOS.'
    )
    return false
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'crescent-icons-'))
  const iconsetDir = path.join(tmpBase, 'Crescent.iconset')
  fs.mkdirSync(iconsetDir)

  const specs = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'diana.and@example.org', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'ivan.p@example.net', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'wendy.h@example.net', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'wendy.h@example.net', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'laura.c@example.net', size: 1024 }
  ]

  return Promise.all(
    specs.map(async (spec) => {
      const buffer = await sharp(sharpAppPng)
        .resize(spec.size, spec.size)
        .withMetadata({ density: 72 })
        .png({ compressionLevel: 9 })
        .toBuffer()
      fs.writeFileSync(path.join(iconsetDir, spec.name), buffer)
    })
  ).then(() => {
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outIcns], { stdio: 'inherit' })
    fs.rmSync(tmpBase, { recursive: true, force: true })
    return true
  })
}

async function main() {
  let sharp
  try {
    sharp = require('sharp')
  } catch {
    throw new Error('Missing sharp. Install with: npm i -D sharp')
  }

  for (const file of [appSvg, markSvg]) {
    if (!fs.existsSync(file)) throw new Error(`Missing icon master: ${file}`)
  }

  const charcoal = { r: 13, g: 17, b: 23, alpha: 1 }
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

  const appBuffer = await renderPng(sharp, appSvg, 1024, charcoal)
  fs.mkdirSync(path.dirname(outBuildPng), { recursive: true })
  fs.mkdirSync(path.dirname(outResourcesPng), { recursive: true })
  fs.writeFileSync(outBuildPng, appBuffer)
  fs.writeFileSync(outResourcesPng, appBuffer)

  await buildIcnsWithIconutil(appBuffer, sharp)

  const icoSizes = [16, 32, 48, 64, 128, 256]
  const icoEntries = []
  for (const size of icoSizes) {
    icoEntries.push({
      size,
      png: await sharp(appBuffer).resize(size, size).withMetadata({ density: 72 }).png().toBuffer()
    })
  }
  fs.writeFileSync(outIco, createIcoFromPngs(icoEntries))

  const markBuffer = await renderPng(sharp, markSvg, 256, transparent)
  fs.mkdirSync(path.dirname(outMarkPng), { recursive: true })
  fs.writeFileSync(outMarkPng, markBuffer)
  fs.copyFileSync(markSvg, outFaviconSvg)

  const previewDir = path.join(root, 'build/icons/preview')
  fs.mkdirSync(previewDir, { recursive: true })
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    await sharp(appBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(previewDir, `icon-${size}.png`))
  }

  console.log('Generated:')
  console.log(`  ${path.relative(root, outBuildPng)}`)
  console.log(`  ${path.relative(root, outResourcesPng)}`)
  if (fs.existsSync(outIcns)) console.log(`  ${path.relative(root, outIcns)}`)
  console.log(`  ${path.relative(root, outIco)}`)
  console.log(`  ${path.relative(root, outMarkPng)}`)
  console.log(`  ${path.relative(root, outFaviconSvg)}`)
  console.log(`  ${path.relative(root, previewDir)}/icon-{16..1024}.png`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
