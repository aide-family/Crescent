#!/usr/bin/env node
/**
 * Dev-only (darwin): brand Electron.app so Notification Center left-slot uses Crescent.
 * 1) Overwrite Resources/electron.icns with build/icon.icns
 * 2) Rewrite Info.plist display name + CFBundleIdentifier (breaks IconServices cache for com.github.Electron)
 * 3) Touch + lsregister the bundle so Launch Services picks up the new identity
 *
 * Idempotent; failures warn and never block install. No-op on non-darwin (CI linux safe).
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function main() {
  if (process.platform !== 'darwin') return

  const root = path.resolve(__dirname, '..')
  const electronApp = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
  const resourcesDir = path.join(electronApp, 'Contents', 'Resources')
  const source = path.join(root, 'build', 'icon.icns')
  const targetIcns = path.join(resourcesDir, 'electron.icns')
  const plist = path.join(electronApp, 'Contents', 'Info.plist')

  try {
    if (!fs.existsSync(source)) {
      console.warn(`[patch-electron-dock-icon] skip: missing ${source}`)
      return
    }
    if (!fs.existsSync(resourcesDir)) {
      console.warn(`[patch-electron-dock-icon] skip: missing Electron Resources dir`)
      return
    }

    fs.copyFileSync(source, targetIcns)

    if (fs.existsSync(plist)) {
      setPlistString(plist, 'CFBundleName', 'Crescent')
      setPlistString(plist, 'CFBundleDisplayName', 'Crescent')
      // Distinct from stock Electron so Notification Center / IconServices stop serving the atom logo.
      setPlistString(plist, 'CFBundleIdentifier', 'com.crescent.app')
      setPlistString(plist, 'CFBundleIconFile', 'electron.icns')
    }

    try {
      const now = new Date()
      fs.utimesSync(electronApp, now, now)
    } catch {
      // ignore
    }

    const lsregister = path.join(
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    )
    if (fs.existsSync(lsregister)) {
      try {
        execFileSync(lsregister, ['-f', electronApp], { stdio: 'ignore' })
      } catch {
        // ignore — registration is best-effort
      }
    }

    console.info(`[patch-electron-dock-icon] branded ${electronApp} (icns + Info.plist)`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[patch-electron-dock-icon] failed (non-fatal): ${message}`)
  }
}

function setPlistString(plistPath, key, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], {
      stdio: 'ignore'
    })
  } catch {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plistPath], {
        stdio: 'ignore'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[patch-electron-dock-icon] plist ${key} failed: ${message}`)
    }
  }
}

main()
