import { promises as fs } from 'node:fs'
import path from 'node:path'

const RUNTIME_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-profile-sync'])

export function isManagedPlugin(name) {
  return !RUNTIME_BUNDLES.has(name)
}

function isLocalSpec(spec) {
  return typeof spec === 'string' && (spec.startsWith('link:') || spec.startsWith('file:'))
}

function exactVersion(spec) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec) ? spec : null
}

export async function readProfile({ profileDir }) {
  const packagePath = path.join(profileDir, 'package.json')
  const raw = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  const lockPath = path.join(profileDir, 'pnpm-lock.yaml')
  let lockText = ''
  try {
    lockText = await fs.readFile(lockPath, 'utf8')
  } catch {}
  return {
    profileDir,
    profileName: path.basename(profileDir),
    packagePath,
    lockPath,
    dependencies: { ...(raw.dependencies || {}) },
    bundles: [...(raw.dsh?.profile?.bundles || [])],
    lockText,
    raw,
  }
}

export function pluginInventory(profile) {
  return Object.entries(profile.dependencies).map(([name, spec]) => ({
    name,
    spec,
    version: exactVersion(spec),
    source: isLocalSpec(spec) ? 'local' : 'registry',
  }))
}

export function installablePlugins(profile) {
  return pluginInventory(profile).filter(plugin => !RUNTIME_BUNDLES.has(plugin.name))
}

export async function writeBundleList({ packagePath, bundles }) {
  const raw = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  raw.dsh = raw.dsh || {}
  raw.dsh.profile = raw.dsh.profile || {}
  raw.dsh.profile.bundles = [...bundles]
  const temp = `${packagePath}.${process.pid}.tmp`
  await fs.writeFile(temp, JSON.stringify(raw, null, 2) + '\n', 'utf8')
  await fs.rename(temp, packagePath)
}
