import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { packageLocalPlugin } from './archive.js'
import { applySnapshot } from './apply.js'
import { diffSnapshot } from './diff.js'
import { commitAndPush, ensureRepo, fetchRepo } from './git.js'
import { createProfileManager } from './profile-manager.js'
import { installablePlugins, pluginInventory, readProfile } from './profile.js'
import { readSkills } from './skills.js'
import { buildSnapshot, readRemoteDevices, writeSnapshot } from './snapshot.js'
import { loadState, readMachineGuid, saveState } from './state.js'
import { ensureDir, pathExists, readJson, toIso } from './util.js'

function defaultRun(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function pluginKey(plugin) {
  if (plugin.source === 'local') return plugin.sha256 || plugin.spec
  return plugin.version || plugin.spec
}

export class ProfileSyncEngine {
  constructor({
    home = path.join(os.homedir(), '.dsh'),
    profileName = process.env.DSH_PROFILE || 'desktop',
    profileDir = process.env.DSH_PROFILE_DIR,
    remote = 'https://github.com/Eugene-doc/dsh-profile-data.git',
    branch = 'main',
    dshVersion = process.env.DSH_VERSION,
    machineGuid,
    run = defaultRun,
  } = {}) {
    this.home = home
    this.profileName = profileName
    this.profileDir = profileDir || path.join(home, 'profiles', profileName)
    this.remote = remote
    this.branch = branch
    this.dshVersion = dshVersion || '0.0.0'
    this.machineGuid = machineGuid
    this.run = run
    this.repoPath = path.join(home, 'profile-sync', 'repo')
    this.statePath = path.join(home, 'profile-sync', 'state.json')
    this.archivesDir = path.join(home, 'profile-sync', 'archives')
    this.skillsDir = path.join(home, 'skills')
    this.running = false
    this.lastError = null
  }

  async state() {
    const machineGuid = this.machineGuid || (await readMachineGuid({ run: this.run }))
    return loadState({
      statePath: this.statePath,
      profileName: this.profileName,
      machineGuid,
      hostname: os.hostname(),
    })
  }

  async saveState(state) {
    await saveState({ statePath: this.statePath, state })
  }

  async local() {
    const [profile, skills] = await Promise.all([
      readProfile({ profileDir: this.profileDir }),
      readSkills({ skillsDir: this.skillsDir, includeContent: true }),
    ])
    return { profile, skills }
  }

  async status() {
    const state = await this.state()
    const local = await this.local().catch(() => null)
    return {
      ok: true,
      profileName: this.profileName,
      profileDir: this.profileDir,
      remote: this.remote,
      branch: this.branch,
      repoPath: this.repoPath,
      device: state,
      local: local
        ? {
            plugins: installablePlugins(local.profile).length,
            skills: local.skills.length,
            bundles: local.profile.bundles.length,
          }
        : null,
      repoExists: await pathExists(path.join(this.repoPath, '.git')),
      lastError: this.lastError,
    }
  }

  async ensureRepo() {
    await ensureRepo({ repoPath: this.repoPath, remote: this.remote, branch: this.branch })
    await fetchRepo({ repoPath: this.repoPath, branch: this.branch })
  }

  async snapshot() {
    if (this.running) throw new Error('profile sync is already running')
    this.running = true
    this.lastError = null
    try {
      await this.ensureRepo()
      const state = await this.state()
      const { profile, skills } = await this.local()
      const temp = await fs.mkdtemp(path.join(this.home, 'profile-sync', 'tmp-'))
      const archives = {}
      let snapshot
      try {
        for (const plugin of installablePlugins(profile)) {
          if (plugin.source !== 'local') continue
          archives[plugin.name] = await packageLocalPlugin({
            name: plugin.name,
            spec: plugin.spec,
            outDir: path.join(temp, 'archives'),
          })
        }
        snapshot = buildSnapshot({
          inventory: profile,
          skills,
          state,
          dshVersion: this.dshVersion,
          platform: process.platform,
          archives,
        })
        await writeSnapshot({
          repoPath: this.repoPath,
          profileName: this.profileName,
          snapshot,
          packageText: JSON.stringify(profile.raw, null, 2) + '\n',
          lockText: profile.lockText,
          archives,
          skillFiles: Object.fromEntries(skills.map(skill => [skill.name, skill.content])),
        })
      } finally {
        await fs.rm(temp, { recursive: true, force: true })
      }
      const commit = await commitAndPush({
        repoPath: this.repoPath,
        branch: this.branch,
        message: `profile sync: ${state.deviceName} · ${profile.profileName}`,
      })
      state.lastSync = toIso()
      state.base = {
        plugins: Object.fromEntries(snapshot.plugins.map(plugin => [plugin.name, pluginKey(plugin)])),
        skills: Object.fromEntries(skills.map(skill => [skill.name, skill.sha256])),
      }
      await this.saveState(state)
      return { ok: true, snapshot, commit, state }
    } catch (error) {
      this.lastError = String(error?.message || error)
      throw error
    } finally {
      this.running = false
    }
  }

  async devices() {
    await this.ensureRepo()
    const [state, devices] = await Promise.all([
      this.state(),
      readRemoteDevices({ repoPath: this.repoPath, profileName: this.profileName }),
    ])
    return devices.map(device => ({
      deviceId: device.snapshot.deviceId,
      deviceName: device.snapshot.deviceName,
      createdAt: device.snapshot.createdAt,
      dshVersion: device.snapshot.dshVersion,
      plugins: device.snapshot.plugins.length,
      skills: device.snapshot.skills.length,
      current: device.snapshot.deviceId === state.deviceId,
    }))
  }

  async diff(deviceId) {
    await this.ensureRepo()
    const [state, local, devices] = await Promise.all([
      this.state(),
      this.local(),
      readRemoteDevices({ repoPath: this.repoPath, profileName: this.profileName }),
    ])
    const remote = devices.find(device => device.snapshot.deviceId === deviceId)
    if (!remote) throw new Error('device snapshot not found')
    return diffSnapshot({
      inventory: local.profile,
      skills: local.skills,
      base: state.base,
      remote,
      localDshVersion: this.dshVersion,
    })
  }

  async apply(deviceId) {
    await this.ensureRepo()
    const [state, local, devices] = await Promise.all([
      this.state(),
      this.local(),
      readRemoteDevices({ repoPath: this.repoPath, profileName: this.profileName }),
    ])
    const remote = devices.find(device => device.snapshot.deviceId === deviceId)
    if (!remote) throw new Error('device snapshot not found')
    if (remote.snapshot.deviceId === state.deviceId) throw new Error('cannot apply this device to itself')
    const manager = createProfileManager({
      profileName: this.profileName,
      packagePath: local.profile.packagePath,
    })
    const backupDir = path.join(this.home, 'profile-sync', 'backups', new Date().toISOString().replace(/[:.]/g, '-'))
    await ensureDir(backupDir)
    const result = await applySnapshot({
      snapshot: remote.snapshot,
      snapshotDir: remote.dir,
      inventory: local.profile,
      packageManager: manager,
      skillsDir: this.skillsDir,
      backupDir,
      archivesDir: this.archivesDir,
      localDshVersion: this.dshVersion,
      base: state.base,
    })
    state.lastApplied = toIso()
    state.base = {
      plugins: Object.fromEntries((remote.snapshot.plugins || []).map(plugin => [plugin.name, pluginKey(plugin)])),
      skills: Object.fromEntries((remote.snapshot.skills || []).map(skill => [skill.name, skill.sha256])),
    }
    await this.saveState(state)
    return { ok: true, ...result, backupDir }
  }
}

export { readJson, pluginInventory }
