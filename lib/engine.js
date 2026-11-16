import { execFile } from 'node:child_process'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
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

function defaultDshCli() {
  if (process.env.DSH_CLI) return process.env.DSH_CLI
  const candidate = path.join(
    path.dirname(process.execPath),
    'resources',
    'runtime',
    'cli',
    'bin',
    'dsh.cmd',
  )
  return existsSync(candidate) ? candidate : 'dsh'
}

function detectDshVersion() {
  if (process.env.DSH_VERSION) return process.env.DSH_VERSION
  try {
    const installDir = process.env.DSH_INSTALL_DIR
    if (!installDir) return null
    return JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8')).version || null
  } catch {
    return null
  }
}

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
    home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    profileName = process.env.DSH_PROFILE || 'desktop',
    remote = 'https://github.com/Eugene-doc/dsh-profile-data.git',
    branch = 'main',
    dshVersion = detectDshVersion(),
    dshCli = defaultDshCli(),
    machineGuid,
    run = defaultRun,
  } = {}) {
    this.home = home
    this.profileName = profileName
    this.profileDir = path.join(home, 'profiles', profileName)
    this.remote = remote
    this.branch = branch
    this.dshVersion = dshVersion || null
    this.dshCli = dshCli
    this.machineGuid = machineGuid
    this.run = run
    this.repoPath = path.join(home, 'profile-sync', 'repo')
    this.statePath = path.join(home, 'profile-sync', 'state.json')
    this.archivesDir = path.join(home, 'profile-sync', 'archives')
    this.skillsDir = path.join(home, 'skills')
    this.running = false
    this.lastError = null
    this.mutation = Promise.resolve()
  }

  async mutate(fn) {
    const previous = this.mutation
    let release
    this.mutation = new Promise(resolve => { release = resolve })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }

  async version() {
    if (this.dshVersion) return this.dshVersion
    try {
      const result = await this.run(this.dshCli, ['--version'])
      const match = String(result.stdout || '').match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)
      this.dshVersion = match?.[1] || '0.0.0'
    } catch {
      this.dshVersion = '0.0.0'
    }
    return this.dshVersion
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
    const [state, version] = await Promise.all([this.state(), this.version()])
    const local = await this.local().catch(() => null)
    return {
      ok: true,
      profileName: this.profileName,
      dshVersion: version,
      remote: this.remote,
      branch: this.branch,
      device: {
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        lastSync: state.lastSync,
        lastApplied: state.lastApplied,
      },
      local: local
        ? {
            plugins: installablePlugins(local.profile).length,
            skills: local.skills.length,
            bundles: local.profile.bundles.length,
          }
        : null,
      repoExists: await pathExists(path.join(this.repoPath, '.git')),
      lastError: this.lastError ? 'see DSH log' : null,
    }
  }

  async assertTarget(version) {
    const expected = path.resolve(this.home, 'profiles', this.profileName)
    if (path.resolve(this.profileDir) !== expected) {
      throw new Error(`refusing to apply: profileDir ${this.profileDir} is not ${expected}`)
    }
    try {
      const [actual, canonical] = await Promise.all([fs.realpath(this.profileDir), fs.realpath(expected)])
      if (actual !== canonical) throw new Error('profile path resolves to a different directory')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      throw new Error(`refusing to apply: profile directory is missing: ${expected}`)
    }
    if (!/^\d+\.\d+\.\d+/.test(version) || version === '0.0.0') {
      throw new Error('refusing to apply: DSH version is unknown; set DSH_VERSION or DSH_INSTALL_DIR')
    }
  }

  async ensureRepo() {
    await ensureRepo({ repoPath: this.repoPath, remote: this.remote, branch: this.branch })
    await fetchRepo({ repoPath: this.repoPath, branch: this.branch })
  }

  async snapshot() {
    return this.mutate(() => this.snapshotUnlocked())
  }

  async snapshotUnlocked() {
    if (this.running) throw new Error('profile sync is already running')
    this.running = true
    this.lastError = null
    try {
      await this.ensureRepo()
      const state = await this.state()
      const version = await this.version()
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
            baseDir: profile.profileDir,
          })
        }
        snapshot = buildSnapshot({
          inventory: profile,
          skills,
          state,
          dshVersion: version,
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
      localDshVersion: await this.version(),
    })
  }

  async apply(deviceId) {
    return this.mutate(async () => {
    const version = await this.version()
    await this.assertTarget(version)
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
      home: this.home,
      dshCli: this.dshCli,
    })
    await ensureDir(path.join(this.home, 'profile-sync', 'backups'))
    const backupDir = await fs.mkdtemp(path.join(this.home, 'profile-sync', 'backups', 'apply-'))
    const result = await applySnapshot({
      snapshot: remote.snapshot,
      snapshotDir: remote.dir,
      inventory: local.profile,
      packageManager: manager,
      skillsDir: this.skillsDir,
      backupDir,
      archivesDir: this.archivesDir,
      localDshVersion: version,
      base: state.base,
    })
    state.lastApplied = toIso()
    state.base = {
      plugins: Object.fromEntries((remote.snapshot.plugins || []).map(plugin => [plugin.name, pluginKey(plugin)])),
      skills: Object.fromEntries((remote.snapshot.skills || []).map(skill => [skill.name, skill.sha256])),
    }
    await this.saveState(state)
    return { ok: true, ...result, backupDir }
    })
  }
}

export { readJson, pluginInventory }
