import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function clean(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
}

async function fileHash(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

function excluded(relative) {
  const normalized = relative.replace(/\\/g, '/')
  if (/(^|\/)(\.git|node_modules)(\/|$)/i.test(normalized)) return true
  const base = path.posix.basename(normalized)
  return (
    /^\.env(\.|$)/i.test(base) ||
    /\.(key|pem|p12)$/i.test(base) ||
    /^credentials\.json$/i.test(base)
  )
}

async function collectFiles(root, relative = '') {
  const files = []
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
  for (const entry of entries) {
    const child = path.posix.join(relative.replace(/\\/g, '/'), entry.name)
    if (excluded(child)) continue
    const full = path.join(root, child)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, child)))
    } else if (entry.isFile()) {
      files.push({ relative: child, full })
    }
  }
  return files
}

export async function hashLocalPlugin({ spec, baseDir = process.cwd() }) {
  let source = String(spec).replace(/^(link|file):/, '')
  if (!path.isAbsolute(source)) source = path.resolve(baseDir, source)
  const stat = await fs.stat(source)
  if (stat.isFile()) return fileHash(source)
  const files = (await collectFiles(source)).sort((a, b) => a.relative.localeCompare(b.relative))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relative)
    hash.update('\0')
    hash.update(await fs.readFile(file.full))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export async function hashArchiveContent({ archive }) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-archive-'))
  try {
    await run('tar', ['-xzf', archive, '-C', temp])
    const entries = await fs.readdir(temp, { withFileTypes: true })
    const root = entries.find(entry => entry.isDirectory())
    if (!root) throw new Error(`archive has no package directory: ${archive}`)
    return await hashLocalPlugin({ spec: path.join(temp, root.name) })
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

export async function packageLocalPlugin({ name, spec, outDir, baseDir = process.cwd() }) {
  let source = String(spec).replace(/^(link|file):/, '')
  if (!path.isAbsolute(source)) source = path.resolve(baseDir, source)
  const stat = await fs.stat(source)
  await fs.mkdir(outDir, { recursive: true })
  const contentHash = await hashLocalPlugin({ spec, baseDir })

  if (stat.isFile()) {
    const archive = path.join(outDir, `${clean(name)}.tgz`)
    await fs.copyFile(source, archive)
    return { archive, sha256: await fileHash(archive), contentHash, version: null }
  }
  if (!stat.isDirectory()) throw new Error(`local plugin is not a directory: ${source}`)

  let pkg
  try {
    pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'))
  } catch {
    throw new Error(`local plugin has no readable package.json: ${source}`)
  }
  const version = String(pkg.version || '0.0.0')
  const archive = path.join(outDir, `${clean(pkg.name || name)}-${clean(version)}.tgz`)
  const excludes = [
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=.env',
    '--exclude=.env.*',
    '--exclude=*.key',
    '--exclude=*.pem',
    '--exclude=*.p12',
    '--exclude=credentials.json',
  ]
  await run('tar', [...excludes, '-czf', archive, '-C', path.dirname(source), path.basename(source)])
  return { archive, sha256: await fileHash(archive), contentHash, version }
}

export async function verifyArchive({ archive, sha256 }) {
  try {
    return (await fileHash(archive)) === sha256
  } catch {
    return false
  }
}
