import { promises as fs } from 'node:fs'
import path from 'node:path'

import { hashArchiveContent } from './archive.js'
import { installablePlugins, pluginInventory } from './profile.js'
import { normalizeSkillText, readSkills, sha256Raw, sha256Text } from './skills.js'
import { ensureDir, readJson, safeJoin, toIso, writeJsonAtomic, writeTextAtomic } from './util.js'

function safeSegment(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(value || ''))) throw new Error(`invalid path segment: ${value}`)
  return value
}

export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1) throw new Error('unsupported snapshot version')
  safeSegment(snapshot.deviceId)
  safeSegment(snapshot.profileName)
  if (!Array.isArray(snapshot.plugins) || !Array.isArray(snapshot.skills)) {
    throw new Error('snapshot must contain plugins and skills arrays')
  }
  if (!Array.isArray(snapshot.bundles) || snapshot.bundles.some(bundle => typeof bundle !== 'string')) {
    throw new Error('snapshot bundles must be strings')
  }
  if (new Set(snapshot.bundles).size !== snapshot.bundles.length) {
    throw new Error('snapshot has duplicate bundles')
  }
  const pluginNames = new Set()
  for (const plugin of snapshot.plugins) {
    if (!plugin || typeof plugin.name !== 'string' || !/^[A-Za-z0-9@/._-]+$/.test(plugin.name)) {
      throw new Error('snapshot plugin has an invalid name')
    }
    if (pluginNames.has(plugin.name)) throw new Error(`duplicate plugin: ${plugin.name}`)
    pluginNames.add(plugin.name)
    if (plugin.source !== 'registry' && plugin.source !== 'local') {
      throw new Error(`invalid plugin source: ${plugin.name}`)
    }
    if (plugin.source === 'registry' && !plugin.version && !plugin.spec) {
      throw new Error(`registry plugin has no version or spec: ${plugin.name}`)
    }
    if (plugin.source === 'local' && Boolean(plugin.archive) !== Boolean(plugin.sha256)) {
      throw new Error(`local plugin must have both archive and hash: ${plugin.name}`)
    }
    if (plugin.archive && (plugin.archive.includes('..') || path.isAbsolute(plugin.archive))) {
      throw new Error(`invalid archive path: ${plugin.name}`)
    }
    if (plugin.sha256 && !/^[a-f0-9]{64}$/.test(plugin.sha256)) {
      throw new Error(`invalid archive hash: ${plugin.name}`)
    }
    if (plugin.contentHash && !/^[a-f0-9]{64}$/.test(plugin.contentHash)) {
      throw new Error(`invalid content hash: ${plugin.name}`)
    }
  }
  const skillNames = new Set()
  for (const skill of snapshot.skills) {
    if (!skill || path.basename(skill.name) !== skill.name || !/^[a-f0-9]{64}$/.test(skill.sha256 || '')) {
      throw new Error(`invalid skill entry: ${skill?.name || '?'}`)
    }
    if (skillNames.has(skill.name)) throw new Error(`duplicate skill: ${skill.name}`)
    skillNames.add(skill.name)
  }
  return snapshot
}

export function buildSnapshot({ inventory, skills, state, dshVersion, platform, archives = {} }) {
  const plugins = installablePlugins(inventory).map(plugin => {
    const archive = plugin.source === 'local' ? archives[plugin.name] : undefined
    return {
      name: plugin.name,
      spec: plugin.spec,
      version: archive?.version || plugin.version || null,
      source: plugin.source,
      archive: archive ? `local-plugins/${path.basename(archive.archive)}` : null,
      sha256: archive?.sha256 || null,
      contentHash: archive?.contentHash || null,
    }
  })
  return {
    version: 1,
    deviceId: state.deviceId,
    machineKey: state.machineKey,
    deviceName: state.deviceName,
    profileName: inventory.profileName,
    dshVersion,
    platform,
    createdAt: toIso(),
    plugins,
    bundles: [...inventory.bundles],
    skills: (skills || []).map(({ name, sha256, contentHash, bytes }) => ({ name, sha256, contentHash, bytes })),
  }
}

export async function writeSnapshot({
  repoPath,
  profileName,
  snapshot,
  packageText,
  lockText,
  archives = {},
  skillFiles = {},
}) {
  validateSnapshot(snapshot)
  const deviceDir = path.join(
    repoPath,
    'profiles',
    safeSegment(profileName),
    'devices',
    safeSegment(snapshot.deviceId),
  )
  await ensureDir(deviceDir)
  await writeTextAtomic(path.join(deviceDir, 'package.json'), packageText)
  await writeTextAtomic(path.join(deviceDir, 'pnpm-lock.yaml'), lockText)
  await ensureDir(path.join(deviceDir, 'local-plugins'))
  await ensureDir(path.join(deviceDir, 'skills'))

  for (const plugin of snapshot.plugins || []) {
    if (!plugin.archive) continue
    const source = archives[plugin.name]?.archive
    if (!source) throw new Error(`missing archive for ${plugin.name}`)
    const destination = safeJoin(deviceDir, plugin.archive)
    await ensureDir(path.dirname(destination))
    await fs.copyFile(source, destination)
  }
  for (const skill of snapshot.skills || []) {
    const content = skillFiles[skill.name]
    if (typeof content !== 'string') throw new Error(`missing skill content for ${skill.name}`)
    const destination = safeJoin(deviceDir, path.join('skills', skill.name))
    await writeTextAtomic(destination, content)
  }
  await writeJsonAtomic(path.join(deviceDir, 'snapshot.json'), snapshot)
  return { deviceDir }
}

export async function readRemoteDevices({ repoPath, profileName }) {
  const root = path.join(repoPath, 'profiles', safeSegment(profileName), 'devices')
  let entries = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const result = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    let snapshot
    try {
      snapshot = await readJson(path.join(dir, 'snapshot.json'))
    } catch {
      continue
    }
    try {
      validateSnapshot(snapshot)
    } catch {
      continue
    }
    for (const plugin of snapshot.plugins) {
      if (plugin.source !== 'local' || plugin.contentHash || !plugin.archive) continue
      try {
        plugin.contentHash = await hashArchiveContent({ archive: safeJoin(dir, plugin.archive) })
      } catch {}
    }
    const skills = []
    for (const skill of snapshot.skills) {
      try {
        const buffer = await fs.readFile(safeJoin(dir, path.join('skills', skill.name)))
        const text = normalizeSkillText(buffer.toString('utf8'))
        const contentHash = sha256Text(text)
        const rawHash = sha256Raw(buffer)
        if (rawHash !== skill.sha256 && contentHash !== skill.sha256 && contentHash !== skill.contentHash) continue
        const record = { ...skill, sha256: rawHash, contentHash, content: text }
        skill.sha256 = rawHash
        skill.contentHash = contentHash
        skills.push(record)
      } catch {}
    }
    result.push({ dir, snapshot, skills })
  }
  return result.sort((a, b) => String(b.snapshot.createdAt).localeCompare(String(a.snapshot.createdAt)))
}

export async function collectSkillFiles({ skillsDir }) {
  const skills = await readSkills({ skillsDir, includeContent: true })
  return {
    skills: skills.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
    files: Object.fromEntries(skills.map(skill => [skill.name, skill.content])),
  }
}

export { pluginInventory }
