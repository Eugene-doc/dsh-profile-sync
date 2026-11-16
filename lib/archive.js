import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
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

export async function packageLocalPlugin({ name, spec, outDir }) {
  const source = String(spec).replace(/^(link|file):/, '')
  const stat = await fs.stat(source)
  await fs.mkdir(outDir, { recursive: true })

  if (stat.isFile()) {
    const archive = path.join(outDir, `${clean(name)}.tgz`)
    await fs.copyFile(source, archive)
    return { archive, sha256: await fileHash(archive), version: null }
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
  await run('tar', ['-czf', archive, '-C', path.dirname(source), path.basename(source)])
  return { archive, sha256: await fileHash(archive), version }
}

export async function verifyArchive({ archive, sha256 }) {
  try {
    return (await fileHash(archive)) === sha256
  } catch {
    return false
  }
}
