#!/usr/bin/env node
/**
 * Rasterize the logo master into Electron packaging icons + in-app assets.
 *
 * Source of truth:
 *   build/icons/crescent-logo.png  → build/icon.png + resources/icon.png + .icns/.ico
 *                                   → renderer favicon / ProductLogo mark
 *
 * Usage:
 *   npm run icons
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const logoMaster = path.join(root, 'build/icons/crescent-logo.png')
const outBuildPng = path.join(root, 'build/icon.png')
const outResourcesPng = path.join(root, 'resources/icon.png')
const outIcns = path.join(root, 'build/icon.icns')
const outIco = path.join(root, 'build/icon.ico')
const outMarkPng = path.join(root, 'src/renderer/src/assets/crescent-mark.png')
const outLogoPng = path.join(root, 'src/renderer/src/assets/crescent-logo.png')

const charcoal = { r: 13, g: 17, b: 23, alpha: 1 }

/**
 * Keep mark artwork inside the macOS icon safe zone so the outer ring is not
 * clipped by the squircle mask (~80–85% of the canvas).
 */
const LOGO_SAFE_SCALE = 0.82

/**
 * macOS / iOS icon corner radius ≈ 22.37% of edge length.
 * Electron's `app.dock.setIcon()` does NOT apply the system squircle mask, so
 * packaging + dock icons must bake transparent rounded corners into the PNG.
 */
function squircleMaskSvg(size) {
  const radius = Math.round(size * 0.2237)
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
      `</svg>`
  )
}

async function renderAppIcon(sharp, masterPath, size) {
  const logoSize = Math.max(1, Math.round(size * LOGO_SAFE_SCALE))
  const resized = await sharp(masterPath)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const plate = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: charcoal
    }
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toBuffer()

  const mask = await sharp(squircleMaskSvg(size)).png().toBuffer()

  return sharp(plate)
    .composite([{ input: mask, blend: 'dest-in' }])
    .withMetadata({ density: 72 })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function renderTransparentMark(sharp, masterPath, size) {
  return sharp(masterPath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
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

  if (!fs.existsSync(logoMaster)) {
    throw new Error(`Missing icon master: ${logoMaster}`)
  }

  const appBuffer = await renderAppIcon(sharp, logoMaster, 1024)
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

  const markBuffer = await renderTransparentMark(sharp, logoMaster, 256)
  const logoBuffer = await renderTransparentMark(sharp, logoMaster, 512)
  fs.mkdirSync(path.dirname(outMarkPng), { recursive: true })
  fs.writeFileSync(outMarkPng, markBuffer)
  fs.writeFileSync(outLogoPng, logoBuffer)

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
  console.log(`  ${path.relative(root, outLogoPng)}`)
  console.log(`  ${path.relative(root, previewDir)}/icon-{16..1024}.png`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
