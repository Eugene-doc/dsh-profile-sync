import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'

import { readJson, writeJsonAtomic } from './util.js'

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

export function createProfileManager({
  profileName,
  packagePath,
  home = process.env.DSH_HOME,
  dshCli = process.env.DSH_CLI || 'dsh',
  run = defaultRun,
}) {
  const env = home ? { ...process.env, DSH_HOME: home } : undefined
  async function readRaw() {
    return readJson(packagePath)
  }

  return {
    async readBundles() {
      const raw = await readRaw()
      return [...(raw.dsh?.profile?.bundles || [])]
    },
    async addPackage(spec) {
      await run(dshCli, ['plugin', '--profile', profileName, 'add', spec], { env })
    },
    async writeBundles(bundles) {
      const raw = await readRaw()
      raw.dsh = raw.dsh || {}
      raw.dsh.profile = raw.dsh.profile || {}
      raw.dsh.profile.bundles = [...bundles]
      await writeJsonAtomic(packagePath, raw)
    },
    async installFromLock() {
      await run(dshCli, ['plugin', '--profile', profileName, 'install', '--frozen-lockfile'], { env })
    },
  }
}
