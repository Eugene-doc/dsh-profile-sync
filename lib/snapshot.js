import { promises as fs } from 'node:fs'
import path from 'node:path'

import { installablePlugins, pluginInventory } from './profile.js'
import { readSkills } from './skills.js'
import { ensureDir, readJson, safeJoin, toIso, writeJsonAtomic, writeTextAtomic } from './util.js'

function safeSegment(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(value || ''))) throw new Error(`invalid path segment: ${value}`)
  return value
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
    skills: (skills || []).map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
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
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.plugins) || !Array.isArray(snapshot.skills)) {
      continue
    }
    const skills = []
    for (const skill of snapshot.skills) {
      try {
        const content = await fs.readFile(safeJoin(dir, path.join('skills', skill.name)), 'utf8')
        skills.push({ ...skill, content })
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
