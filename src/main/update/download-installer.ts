import { existsSync, createWriteStream } from 'fs'
import { join } from 'path'
import { app, net, shell } from 'electron'
import type { UpdateInfo } from 'electron-updater'
import { pickPreferredInstallerFile, uniqueDownloadPath } from '../../shared/installer-file'

export async function downloadUpdateInstaller(
  info: UpdateInfo,
  onProgress: (transferred: number, total: number) => void
): Promise<{ path: string }> {
  const picked = pickPreferredInstallerFile({
    version: info.version,
    path: info.path,
    files: info.files?.map((file) => ({ url: file.url }))
  })
  if (!picked) {
    throw new Error('No installer file was listed for this update.')
  }

  const dest = uniqueDownloadPath(app.getPath('downloads'), picked.filename, existsSync, join)
  await downloadUrlToFile(picked.url, dest, onProgress)
  shell.showItemInFolder(dest)
  return { path: dest }
}

function downloadUrlToFile(
  url: string,
  dest: string,
  onProgress: (transferred: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      if (status >= 400) {
        reject(new Error(`Download failed (${status})`))
        return
      }

      const total = Number(response.headers['content-length'] || 0)
      let transferred = 0
      const out = createWriteStream(dest)
      const fail = (error: Error): void => {
        out.destroy()
        reject(error)
      }

      response.on('data', (chunk) => {
        transferred += chunk.length
        out.write(chunk)
        onProgress(transferred, total)
      })
      response.on('end', () => {
        out.end(() => resolve())
      })
      response.on('error', fail)
      out.on('error', fail)
    })
    request.on('error', reject)
    request.end()
  })
}
