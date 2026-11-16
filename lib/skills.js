import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ensureDir, safeJoin } from './util.js'

export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

export async function readSkills({ skillsDir, includeContent = false }) {
  let entries = []
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const file = path.join(skillsDir, entry.name)
    const buffer = await fs.readFile(file)
    const record = {
      name: entry.name,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.length,
    }
    if (includeContent) record.content = buffer.toString('utf8')
    skills.push(record)
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export async function applySkills({ skillsDir, remoteSkills, base = {}, backupDir }) {
  await ensureDir(skillsDir)
  const local = new Map((await readSkills({ skillsDir })).map(skill => [skill.name, skill]))
  const result = { added: 0, updated: 0, conflicts: [], skipped: [] }

  for (const remote of remoteSkills || []) {
    if (!remote?.name || !remote?.sha256 || typeof remote.content !== 'string') {
      result.conflicts.push({ name: remote?.name || '?', reason: 'remote skill is incomplete' })
      continue
    }
    let file
    try {
      file = safeJoin(skillsDir, remote.name)
    } catch {
      result.conflicts.push({ name: remote.name, reason: 'invalid skill name' })
      continue
    }
    const current = local.get(remote.name)
    if (!current) {
      await writeAtomic(file, remote.content)
      result.added += 1
      local.set(remote.name, { name: remote.name, sha256: remote.sha256, bytes: remote.content.length })
      continue
    }
    if (current.sha256 === remote.sha256) continue

    const baseHash = base[remote.name]
    const localChanged = !baseHash || current.sha256 !== baseHash
    const remoteChanged = !baseHash || remote.sha256 !== baseHash
    if (!baseHash || (localChanged && remoteChanged)) {
      result.conflicts.push({
        name: remote.name,
        reason: baseHash ? 'both sides changed since the last sync' : 'no common base',
      })
      continue
    }
    if (remoteChanged) {
      const backupFile = path.join(backupDir, 'skills', remote.name)
      await ensureDir(path.dirname(backupFile))
      await fs.copyFile(file, backupFile)
      await writeAtomic(file, remote.content)
      result.updated += 1
      local.set(remote.name, { name: remote.name, sha256: remote.sha256, bytes: remote.content.length })
    } else {
      result.skipped.push({ name: remote.name, reason: 'local changed only' })
    }
  }
  return result
}

async function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, text, 'utf8')
  await fs.rename(temp, file)
}
