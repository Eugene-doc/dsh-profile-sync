import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export async function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (fallback !== undefined) return fallback
    throw error
  }
}

export async function writeJsonAtomic(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode })
  await fs.rename(temp, file)
}

export async function writeTextAtomic(file, text, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, text, { encoding: 'utf8', mode })
  await fs.rename(temp, file)
}

export async function pathExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export function safeJoin(root, relative) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relative)
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`path escapes root: ${relative}`)
  }
  return resolved
}

export function errorMessage(error) {
  return String(error?.message || error)
}

export function toIso(value = Date.now()) {
  return new Date(value).toISOString()
}
