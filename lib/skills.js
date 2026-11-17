import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ensureDir, safeJoin } from './util.js'

export function normalizeSkillText(value) {
  return String(value).replace(/\r\n?/g, '\n')
}

export function sha256Text(value) {
  return createHash('sha256').update(normalizeSkillText(value), 'utf8').digest('hex')
}

export function sha256Raw(value) {
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
    const text = normalizeSkillText(buffer.toString('utf8'))
    const record = {
      name: entry.name,
      sha256: sha256Raw(buffer),
      contentHash: sha256Text(text),
      bytes: buffer.length,
    }
    if (includeContent) record.content = text
    skills.push(record)
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export async function applySkills({ skillsDir, remoteSkills, base = {}, backupDir }) {
  const baseSkills = base.skills && typeof base.skills === 'object' ? base.skills : base
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
    const remoteContentHash = remote.contentHash || sha256Text(remote.content)
    if (!current) {
      const content = normalizeSkillText(remote.content)
      await writeAtomic(file, content)
      result.added += 1
      local.set(remote.name, { name: remote.name, sha256: sha256Raw(content), contentHash: remoteContentHash, bytes: Buffer.byteLength(content) })
      continue
    }
    if (current.sha256 === remote.sha256 || current.contentHash === remoteContentHash) continue

    const baseHash = baseSkills[remote.name]
    const localMatchesBase = baseHash && (baseHash === current.sha256 || baseHash === current.contentHash)
    const remoteMatchesBase = baseHash && (baseHash === remote.sha256 || baseHash === remoteContentHash)
    const localChanged = !baseHash || !localMatchesBase
    const remoteChanged = !baseHash || !remoteMatchesBase
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
      const content = normalizeSkillText(remote.content)
      await writeAtomic(file, content)
      result.updated += 1
      local.set(remote.name, { name: remote.name, sha256: sha256Raw(content), contentHash: remoteContentHash, bytes: Buffer.byteLength(content) })
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
