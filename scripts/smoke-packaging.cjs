#!/usr/bin/env node
/**
 * Packaging smoke checks for Crescent release artifacts.
 * Validates that expected platform packages and updater metadata exist.
 *
 * Usage:
 *   node scripts/smoke-packaging.cjs [artifactDir]
 * Default artifactDir: dist
 */
const fs = require('node:fs')
const path = require('node:path')

/** @typedef {{ id: string; patterns: RegExp[] }} SmokeRule */

/** @type {SmokeRule[]} */
const PLATFORM_RULES = [
  {
    id: 'macos-dmg-or-zip',
    patterns: [
      /\.dmg$/i,
      /mac.*\.zip$/i,
      /darwin.*\.zip$/i,
      /-arm64.*\.zip$/i,
      /-x64.*\.zip$/i
    ]
  },
  {
    id: 'windows-installer',
    patterns: [/\.exe$/i]
  },
  {
    id: 'linux-package',
    patterns: [/\.AppImage$/i, /\.deb$/i]
  }
]

const UPDATER_PATTERNS = [/^latest(-mac|-linux)?\.yml$/i, /\.yml$/i]
const ARTIFACT_EXTENSIONS = /\.(dmg|zip|exe|AppImage|deb|yml|blockmap)$/i

/**
 * @param {string[]} files
 * @param {SmokeRule} rule
 */
function matchRule(files, rule) {
  return files.filter((name) => rule.patterns.some((pattern) => pattern.test(name)))
}

/**
 * @param {string[]} files
 * @param {Record<string, number>} [sizesByName]
 * @returns {{ ok: boolean; errors: string[]; platforms: { mac: boolean; win: boolean; linux: boolean } }}
 */
function evaluatePackagingArtifacts(files, sizesByName = {}) {
  const platforms = {
    mac: matchRule(files, PLATFORM_RULES[0]).length > 0,
    win: matchRule(files, PLATFORM_RULES[1]).length > 0,
    linux: matchRule(files, PLATFORM_RULES[2]).length > 0
  }
  const errors = []

  if (!platforms.mac && !platforms.win && !platforms.linux) {
    errors.push(
      'Expected at least one of: macOS (.dmg/.zip), Windows (.exe), Linux (.AppImage/.deb)'
    )
  }

  const updaterFiles = files.filter((name) =>
    UPDATER_PATTERNS.some((pattern) => pattern.test(name))
  )
  if (updaterFiles.length === 0) {
    errors.push(
      'Expected electron-builder updater metadata (*.yml such as latest.yml / latest-mac.yml)'
    )
  }

  for (const name of files) {
    if (!ARTIFACT_EXTENSIONS.test(name)) continue
    const size = sizesByName[name]
    if (typeof size === 'number' && size < 64) {
      errors.push(`Artifact too small (${size} bytes): ${name}`)
    }
  }

  return { ok: errors.length === 0, errors, platforms }
}

/**
 * @param {string} dir
 */
function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs.readdirSync(dir).filter((name) => {
    const full = path.join(dir, name)
    return fs.statSync(full).isFile()
  })
}

/**
 * @param {string} artifactDir
 */
function runSmokePackaging(artifactDir) {
  const files = listFiles(artifactDir)
  if (files.length === 0) {
    return {
      ok: false,
      errors: [`No files found in ${artifactDir}`],
      platforms: { mac: false, win: false, linux: false },
      files
    }
  }

  /** @type {Record<string, number>} */
  const sizesByName = {}
  for (const name of files) {
    sizesByName[name] = fs.statSync(path.join(artifactDir, name)).size
  }

  const result = evaluatePackagingArtifacts(files, sizesByName)
  return { ...result, files }
}

function main() {
  const artifactDir = path.resolve(process.argv[2] || 'dist')
  const result = runSmokePackaging(artifactDir)

  if (result.files.length > 0) {
    console.log(`[smoke:packaging] Checking ${result.files.length} file(s) in ${artifactDir}`)
    for (const name of result.files) {
      console.log(`  - ${name}`)
    }
  }

  if (!result.ok) {
    console.error('[smoke:packaging] FAILED')
    for (const error of result.errors) {
      console.error(`  • ${error}`)
    }
    process.exit(1)
  }

  console.log(
    `[smoke:packaging] OK (platforms: mac=${result.platforms.mac} win=${result.platforms.win} linux=${result.platforms.linux})`
  )
}

module.exports = {
  evaluatePackagingArtifacts,
  runSmokePackaging,
  PLATFORM_RULES
}

if (require.main === module) {
  main()
}
