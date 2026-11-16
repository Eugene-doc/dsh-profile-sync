import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { installablePlugins, pluginInventory, readProfile, writeBundleList } from '../lib/profile.js'

async function makeProfileFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-profile-'))
  const profileDir = path.join(root, 'desktop')
  await fs.mkdir(profileDir, { recursive: true })
  await fs.writeFile(
    path.join(profileDir, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-desktop',
      dependencies: {
        'dsh-better-sidebar': '0.31.1',
        'dsh-chat-sync': 'https://example.test/chat-sync-1.5.2.tgz',
        'dsh-token-budget': 'link:C:/work/plugins/dsh-token-budget',
      },
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app',
            'dsh-better-sidebar',
            'dsh-chat-sync',
            'dsh-token-budget',
          ],
        },
      },
    }),
    'utf8',
  )
  await fs.writeFile(path.join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')
  return profileDir
}

test('reads dependencies, bundles and lockfile', async t => {
  const profileDir = await makeProfileFixture()
  t.after(() => fs.rm(path.dirname(profileDir), { recursive: true, force: true }))
  const profile = await readProfile({ profileDir })
  assert.equal(profile.profileName, 'desktop')
  assert.equal(profile.dependencies['dsh-better-sidebar'], '0.31.1')
  assert.deepEqual(profile.bundles.slice(-3), ['dsh-better-sidebar', 'dsh-chat-sync', 'dsh-token-budget'])
  assert.match(profile.lockText, /lockfileVersion/)
})

test('classifies registry and local plugins', async t => {
  const profileDir = await makeProfileFixture()
  t.after(() => fs.rm(path.dirname(profileDir), { recursive: true, force: true }))
  const profile = await readProfile({ profileDir })
  assert.deepEqual(
    pluginInventory(profile).map(plugin => [plugin.name, plugin.source]),
    [
      ['dsh-better-sidebar', 'registry'],
      ['dsh-chat-sync', 'registry'],
      ['dsh-token-budget', 'local'],
    ],
  )
  assert.deepEqual(
    installablePlugins(profile).map(plugin => plugin.name),
    ['dsh-better-sidebar', 'dsh-chat-sync', 'dsh-token-budget'],
  )
})

test('writes a bundle list without losing other profile fields', async t => {
  const profileDir = await makeProfileFixture()
  t.after(() => fs.rm(path.dirname(profileDir), { recursive: true, force: true }))
  const packagePath = path.join(profileDir, 'package.json')
  await writeBundleList({ packagePath, bundles: ['@deepseek-ai/dsh-base', 'dsh-better-sidebar'] })
  const saved = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  assert.deepEqual(saved.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-better-sidebar'])
  assert.equal(saved.dependencies['dsh-chat-sync'], 'https://example.test/chat-sync-1.5.2.tgz')
})
