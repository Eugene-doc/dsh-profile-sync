import { readJson, writeJsonAtomic } from './util.js'
import { runProcess as defaultRun } from './process.js'

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
