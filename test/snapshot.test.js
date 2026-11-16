import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { buildSnapshot, readRemoteDevices, writeSnapshot } from '../lib/snapshot.js'

test('builds and writes a snapshot with local archives and skills', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-snapshot-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const archive = path.join(root, 'local.tgz')
  await fs.writeFile(archive, 'archive\n', 'utf8')
  const state = { deviceId: 'id-1', deviceName: 'home5070' }
  const snapshot = buildSnapshot({
    inventory: {
      profileName: 'desktop',
      dependencies: { 'dsh-better-sidebar': '0.31.1', 'local-plugin': 'link:C:/local' },
      bundles: ['@deepseek-ai/dsh-base', 'dsh-better-sidebar', 'local-plugin'],
    },
    skills: [{ name: 'skill.md', sha256: 'a'.repeat(64), bytes: 6 }],
    state,
    dshVersion: '0.2.2-rc.3',
    platform: 'win32',
    archives: { 'local-plugin': { archive, sha256: 'b'.repeat(64), version: '1.0.0' } },
  })
  assert.equal(snapshot.plugins.find(p => p.name === 'local-plugin').source, 'local')
  assert.equal(snapshot.plugins.find(p => p.name === 'local-plugin').sha256, 'b'.repeat(64))
  await writeSnapshot({
    repoPath: root,
    profileName: 'desktop',
    snapshot,
    packageText: '{"name":"profile"}\n',
    lockText: 'lockfileVersion: 9\n',
    archives: { 'local-plugin': { archive, sha256: 'b'.repeat(64) } },
    skillFiles: { 'skill.md': 'skill\n' },
  })
  const devices = await readRemoteDevices({ repoPath: root, profileName: 'desktop' })
  assert.equal(devices.length, 1)
  assert.equal(devices[0].snapshot.skills[0].name, 'skill.md')
  assert.equal(devices[0].skills[0].content, 'skill\n')
})

test('rejects a snapshot path that escapes the data repo', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-snapshot-bad-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await assert.rejects(
    writeSnapshot({
      repoPath: root,
      profileName: 'desktop',
      snapshot: { version: 1, deviceId: '../evil', plugins: [], skills: [], bundles: [] },
      packageText: '{}',
      lockText: '',
      archives: {},
      skillFiles: {},
    }),
    /escapes|invalid/i,
  )
})
