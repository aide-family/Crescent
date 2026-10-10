const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { homedir } = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { Arch } = require('builder-util')

const run = promisify(execFile)

async function prepareEsbuildPackage(projectDir, version, arch) {
  const lock = JSON.parse(await fs.readFile(path.join(projectDir, 'package-lock.json'), 'utf8'))
  const entry = Object.entries(lock.packages).find(
    ([name, metadata]) => name.endsWith(`/@esbuild/darwin-${arch}`) && metadata.version === version
  )
  if (!entry) throw new Error(`No locked esbuild ${version} darwin-${arch} prebuild`)
  const metadata = entry[1]
  if (!metadata.resolved.startsWith('https://registry.npmjs.org/@esbuild/')) {
    throw new Error('Expected an official npm esbuild tarball')
  }
  const cache = path.join(
    projectDir,
    'node_modules',
    '.cache',
    'crescent-native',
    `esbuild-${version}-${arch}`
  )
  await fs.mkdir(cache, { recursive: true })
  const archive = path.join(cache, 'package.tgz')
  const [algorithm, expected] = metadata.integrity.split('-')
  try {
    await fs.access(archive)
  } catch {
    const digest = Buffer.from(expected, 'base64').toString('hex')
    const npmCache =
      process.env.npm_config_cache || process.env.NPM_CONFIG_CACHE || path.join(homedir(), '.npm')
    const cachedArchive = path.join(
      npmCache,
      '_cacache',
      'content-v2',
      algorithm,
      digest.slice(0, 2),
      digest.slice(2, 4),
      digest.slice(4)
    )
    let restored = false
    try {
      await fs.copyFile(cachedArchive, archive)
      restored = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (!restored)
      await run('curl', [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--retry',
        '2',
        '--connect-timeout',
        '15',
        '--max-time',
        '120',
        '--output',
        archive,
        metadata.resolved
      ])
  }
  const actual = crypto
    .createHash(algorithm)
    .update(await fs.readFile(archive))
    .digest('base64')
  if (actual !== expected)
    throw new Error(`Integrity mismatch for esbuild ${version} darwin-${arch}`)
  await run('tar', ['-xzf', archive, '-C', cache])
  const source = path.join(cache, 'package')
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'))
  if (pkg.version !== version || pkg.name !== `@esbuild/darwin-${arch}`) {
    throw new Error('Unexpected esbuild prebuild package')
  }
  return source
}

module.exports = async function prepareMacosNative(context) {
  if (context.electronPlatformName !== 'darwin') return
  const arch = Arch[context.arch]
  if (!['x64', 'arm64', 'universal'].includes(arch)) return
  const modules = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules'
  )
  const esbuild = path.join(modules, 'esbuild')
  const version = JSON.parse(await fs.readFile(path.join(esbuild, 'package.json'), 'utf8')).version
  const binary = path.join(esbuild, 'bin', 'esbuild')
  if (arch === 'arm64' && context.appOutDir.endsWith('-arm64-temp')) {
    const armAsar = path.resolve(modules, '..', '..', 'app.asar')
    const x64Asar = armAsar.replace('-arm64-temp', '-x64-temp')
    const digest = async (file) =>
      crypto
        .createHash('sha256')
        .update(await fs.readFile(file))
        .digest('hex')
    if ((await digest(armAsar)) !== (await digest(x64Asar))) {
      throw new Error('Universal requires identical JS archives to preserve Pi unpacked paths')
    }
  }
  if (arch === 'universal') {
    const result = await run('lipo', ['-archs', binary])
    if (!['x86_64', 'arm64'].every((value) => result.stdout.split(/\s+/).includes(value))) {
      throw new Error('Universal esbuild is missing an architecture')
    }
    return
  }
  // Pi loads from app.asar.unpacked. Its esbuild runtime must resolve both
  // optional platform packages on disk, even when npm ci ran on an Intel Mac.
  for (const platformArch of ['x64', 'arm64']) {
    const source = await prepareEsbuildPackage(context.packager.projectDir, version, platformArch)
    await fs.cp(source, path.join(modules, '@esbuild', `darwin-${platformArch}`), {
      recursive: true
    })
  }
  // Give universal's lipo pass one genuinely different executable per build.
  await fs.copyFile(path.join(modules, '@esbuild', `darwin-${arch}`, 'bin', 'esbuild'), binary)
  await fs.chmod(binary, 0o755)
  console.log(`[mac-native] esbuild ${version}: ${arch} executable and both Darwin prebuilds ready`)
}
