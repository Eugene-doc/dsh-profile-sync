import { installablePlugins } from './profile.js'

function major(version) {
  const match = String(version || '').match(/^(\d+)\./)
  return match ? match[1] : null
}

function localPluginKey(plugin, localArchives = {}) {
  if (plugin.source === 'local') {
    return localArchives[plugin.name]?.sha256 || plugin.spec
  }
  return plugin.version || plugin.spec
}

function remotePluginKey(plugin) {
  if (plugin.source === 'local') return plugin.sha256 || plugin.spec
  return plugin.version || plugin.spec
}

export function diffSnapshot({
  inventory,
  skills = [],
  base = { plugins: {}, skills: {} },
  remote,
  localDshVersion,
  localArchives = {},
}) {
  const localPlugins = new Map(installablePlugins(inventory).map(plugin => [plugin.name, plugin]))
  const remotePlugins = new Map((remote?.snapshot?.plugins || []).map(plugin => [plugin.name, plugin]))
  const localSkills = new Map(skills.map(skill => [skill.name, skill]))
  const remoteSkills = new Map((remote?.snapshot?.skills || []).map(skill => [skill.name, skill]))
  const plugins = []
  const skillDiffs = []

  for (const name of new Set([...localPlugins.keys(), ...remotePlugins.keys()])) {
    const local = localPlugins.get(name)
    const remotePlugin = remotePlugins.get(name)
    if (local && !remotePlugin) {
      plugins.push({ name, action: 'local-only', local, remote: null })
      continue
    }
    if (!local && remotePlugin) {
      plugins.push({ name, action: 'new', local: null, remote: remotePlugin })
      continue
    }
    const localKey = localPluginKey(local, localArchives)
    const remoteKey = remotePluginKey(remotePlugin)
    if (localKey === remoteKey) {
      plugins.push({ name, action: 'same', local, remote: remotePlugin })
      continue
    }
    const baseKey = base.plugins?.[name]
    const localChanged = !baseKey || localKey !== baseKey
    const remoteChanged = !baseKey || remoteKey !== baseKey
    plugins.push({
      name,
      action: baseKey && localChanged && remoteChanged ? 'conflict' : 'update',
      local,
      remote: remotePlugin,
    })
  }

  for (const name of new Set([...localSkills.keys(), ...remoteSkills.keys()])) {
    const local = localSkills.get(name)
    const remoteSkill = remoteSkills.get(name)
    if (local && !remoteSkill) {
      skillDiffs.push({ name, action: 'local-only', local, remote: null })
      continue
    }
    if (!local && remoteSkill) {
      skillDiffs.push({ name, action: 'new', local: null, remote: remoteSkill })
      continue
    }
    if (local.sha256 === remoteSkill.sha256) {
      skillDiffs.push({ name, action: 'same', local, remote: remoteSkill })
      continue
    }
    const baseHash = base.skills?.[name]
    const localChanged = !baseHash || local.sha256 !== baseHash
    const remoteChanged = !baseHash || remoteSkill.sha256 !== baseHash
    skillDiffs.push({
      name,
      action: baseHash && localChanged && remoteChanged ? 'conflict' : 'update',
      local,
      remote: remoteSkill,
    })
  }

  const warnings = []
  const remoteVersion = remote?.snapshot?.dshVersion
  const localVersion = localDshVersion
  let compatible = true
  if (localVersion && remoteVersion && major(localVersion) !== major(remoteVersion)) {
    compatible = false
    warnings.push(`DSH version mismatch: local ${localVersion}, remote ${remoteVersion}`)
  }
  return { plugins, skills: skillDiffs, warnings, compatible, localVersion, remoteVersion }
}
