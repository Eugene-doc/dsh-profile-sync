import { promises as fs } from 'node:fs'
import path from 'node:path'

import { verifyArchive } from './archive.js'
import { installablePlugins } from './profile.js'
import { applySkills } from './skills.js'
import { ensureDir, safeJoin } from './util.js'

function major(version) {
  return String(version || '').match(/^(\d+)\./)?.[1] || null
}

async function copyIfExists(source, destination) {
  try {
    await fs.cp(source, destination, { recursive: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function readSkillContents({ snapshot, snapshotDir }) {
  const skills = []
  for (const skill of snapshot.skills || []) {
    const content = await fs.readFile(safeJoin(snapshotDir, path.join('skills', skill.name)), 'utf8')
    skills.push({ ...skill, content })
  }
  return skills
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
}) {
  if (snapshot.profileName !== inventory.profileName) {
    throw new Error(`profile mismatch: snapshot ${snapshot.profileName}, local ${inventory.profileName}`)
  }
  if (major(snapshot.dshVersion) !== major(localDshVersion)) {
    throw new Error(`incompatible DSH version: ${snapshot.dshVersion} vs ${localDshVersion}`)
  }

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
  await copyIfExists(inventory.packagePath, packageBackup)
  await copyIfExists(inventory.lockPath, lockBackup)
  await copyIfExists(skillsDir, skillsBackup)

  const oldLock = inventory.lockText
  const oldBundles = await packageManager.readBundles()
  const installed = []
  const skills = await readSkillContents({ snapshot, snapshotDir })

  try {
    for (const plugin of snapshot.plugins || []) {
      const spec = plugin.source === 'local'
        ? `file:${archives[plugin.name].replace(/\\/g, '/')}`
        : (plugin.version ? `${plugin.name}@${plugin.version}` : plugin.spec)
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
    return { installed, bundles: merged, skills: skillResult }
  } catch (error) {
    await copyIfExists(packageBackup, inventory.packagePath)
    await copyIfExists(lockBackup, inventory.lockPath)
    await copyIfExists(skillsBackup, skillsDir)
    try {
      await packageManager.writeBundles(oldBundles)
      await packageManager.installFromLock(oldLock)
    } catch {}
    throw error
  }
}
