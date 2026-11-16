import { promises as fs } from 'node:fs'
import path from 'node:path'

import { verifyArchive } from './archive.js'
import { installablePlugins, isManagedPlugin } from './profile.js'
import { applySkills, normalizeSkillText, readSkills, sha256Raw, sha256Text } from './skills.js'
import { ensureDir, safeJoin } from './util.js'

function major(version) {
  return String(version || '').match(/^(\d+)\./)?.[1] || null
}

function pluginKey(plugin, localArchives = {}) {
  if (!plugin) return null
  if (plugin.source === 'local') {
    return plugin.contentHash || localArchives[plugin.name]?.contentHash || plugin.sha256 || plugin.spec
  }
  return plugin.version || plugin.spec
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function copyIfExists(source, destination) {
  if (!(await exists(source))) return false
  await fs.cp(source, destination, { recursive: true })
  return true
}

async function readSkillContents({ snapshot, snapshotDir }) {
  const skills = []
  for (const skill of snapshot.skills || []) {
    const buffer = await fs.readFile(safeJoin(snapshotDir, path.join('skills', skill.name)))
    const text = normalizeSkillText(buffer.toString('utf8'))
    const contentHash = sha256Text(text)
    const rawHash = sha256Raw(buffer)
    if (rawHash !== skill.sha256 && contentHash !== skill.sha256 && contentHash !== skill.contentHash) {
      throw new Error(`skill checksum mismatch: ${skill.name}`)
    }
    skills.push({ ...skill, sha256: rawHash, contentHash, content: text })
  }
  return skills
}

function assertNoConflicts({ snapshot, inventory, base, localSkills, localArchives }) {
  const localPlugins = new Map(installablePlugins(inventory).map(plugin => [plugin.name, plugin]))
  for (const remote of (snapshot.plugins || []).filter(plugin => isManagedPlugin(plugin.name))) {
    const local = localPlugins.get(remote.name)
    if (!local) continue
    const baseKey = base.plugins?.[remote.name]
    const localKey = pluginKey(local, localArchives)
    const remoteKey = pluginKey(remote, localArchives)
    if (!baseKey && localKey !== remoteKey) {
      throw new Error(`plugin conflict without a common base: ${remote.name}`)
    }
    if (baseKey && localKey !== baseKey && remoteKey !== baseKey) {
      throw new Error(`plugin conflict: ${remote.name}`)
    }
  }
  for (const remote of snapshot.skills || []) {
    const local = localSkills.find(skill => skill.name === remote.name)
    if (!local) continue
    const localHash = local.contentHash || local.sha256
    const remoteHash = remote.contentHash || remote.sha256
    if (localHash === remoteHash || local.sha256 === remote.sha256) continue
    const baseHash = base.skills?.[remote.name]
    if (!baseHash || ((localHash !== baseHash && local.sha256 !== baseHash) && (remoteHash !== baseHash && remote.sha256 !== baseHash))) {
      throw new Error(`skill conflict: ${remote.name}`)
    }
  }
}

async function restoreExact({ source, destination, existed }) {
  if (existed) {
    await fs.rm(destination, { recursive: true, force: true })
    await fs.cp(source, destination, { recursive: true })
  } else {
    await fs.rm(destination, { recursive: true, force: true })
  }
}

export async function applySnapshot({
  snapshot,
  snapshotDir,
  inventory,
  packageManager,
  skillsDir,
  backupDir,
  archivesDir,
  localDshVersion,
  base = {},
  localArchives = {},
  afterApply = null,
}) {
  if (snapshot.profileName !== inventory.profileName) {
    throw new Error(`profile mismatch: snapshot ${snapshot.profileName}, local ${inventory.profileName}`)
  }
  if (major(snapshot.dshVersion) !== major(localDshVersion)) {
    throw new Error(`incompatible DSH version: ${snapshot.dshVersion} vs ${localDshVersion}`)
  }

  const localSkills = await readSkills({ skillsDir })
  assertNoConflicts({ snapshot, inventory, base, localSkills, localArchives })

  const archives = {}
  for (const plugin of snapshot.plugins || []) {
    if (plugin.source !== 'local') continue
    if (!plugin.archive || !plugin.sha256) throw new Error(`missing archive metadata for ${plugin.name}`)
    const source = safeJoin(snapshotDir, plugin.archive)
    if (!(await verifyArchive({ archive: source, sha256: plugin.sha256 }))) {
      throw new Error(`archive checksum mismatch for ${plugin.name}`)
    }
    await ensureDir(archivesDir)
    const destination = path.join(archivesDir, `${plugin.sha256}.tgz`)
    await fs.copyFile(source, destination)
    archives[plugin.name] = destination
  }

  await ensureDir(backupDir)
  const packageBackup = path.join(backupDir, 'package.json')
  const lockBackup = path.join(backupDir, 'pnpm-lock.yaml')
  const skillsBackup = path.join(backupDir, 'skills')
  const markers = {
    package: await exists(inventory.packagePath),
    lock: await exists(inventory.lockPath),
    skills: await exists(skillsDir),
  }
  if (markers.package) await fs.cp(inventory.packagePath, packageBackup)
  if (markers.lock) await fs.cp(inventory.lockPath, lockBackup)
  if (markers.skills) await fs.cp(skillsDir, skillsBackup, { recursive: true })
  await fs.writeFile(path.join(backupDir, 'exists.json'), JSON.stringify(markers), 'utf8')

  const oldLock = inventory.lockText
  const oldBundles = await packageManager.readBundles()
  const installed = []
  const skills = await readSkillContents({ snapshot, snapshotDir })

  try {
    for (const plugin of (snapshot.plugins || []).filter(plugin => isManagedPlugin(plugin.name))) {
      const spec = plugin.source === 'local'
        ? `${plugin.name}@file:${archives[plugin.name].replace(/\\/g, '/')}`
        : `${plugin.name}@${plugin.version || plugin.spec}`
      await packageManager.addPackage(spec)
      installed.push({ name: plugin.name, spec })
    }

    const merged = [...oldBundles]
    for (const bundle of snapshot.bundles || []) {
      if (!merged.includes(bundle)) merged.push(bundle)
    }
    await packageManager.writeBundles(merged)

    const skillResult = await applySkills({
      skillsDir,
      remoteSkills: skills,
      base,
      backupDir,
    })
    if (skillResult.conflicts.length) {
      throw new Error(`unresolved skill conflicts: ${skillResult.conflicts.map(skill => skill.name).join(', ')}`)
    }
    const result = { installed, bundles: merged, skills: skillResult }
    if (afterApply) await afterApply(result)
    return result
  } catch (error) {
    const rollbackErrors = []
    const actions = [
      () => restoreExact({ source: packageBackup, destination: inventory.packagePath, existed: markers.package }),
      () => restoreExact({ source: lockBackup, destination: inventory.lockPath, existed: markers.lock }),
      () => restoreExact({ source: skillsBackup, destination: skillsDir, existed: markers.skills }),
      () => packageManager.installFromLock(oldLock),
    ]
    for (const action of actions) {
      try {
        await action()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], `${error.message}; rollback failed`)
    }
    throw error
  }
}
