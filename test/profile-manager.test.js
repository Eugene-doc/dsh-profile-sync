import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createProfileManager } from '../lib/profile-manager.js'

test('drives the dsh plugin CLI without touching node_modules directly', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-manager-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const packagePath = path.join(root, 'package.json')
  await fs.writeFile(packagePath, JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['base'] } } }), 'utf8')
  const calls = []
  const manager = createProfileManager({
    profileName: 'desktop',
    packagePath,
    dshCli: 'dsh',
    run: async (file, args) => {
      calls.push([file, ...args])
      return { stdout: '' }
    },
  })
  await manager.addPackage('dsh-better-sidebar@0.31.1')
  assert.deepEqual(calls[0], ['dsh', 'plugin', '--profile', 'desktop', 'add', 'dsh-better-sidebar@0.31.1'])
  assert.deepEqual(await manager.readBundles(), ['base'])
  await manager.writeBundles(['base', 'dsh-better-sidebar'])
  assert.deepEqual(await manager.readBundles(), ['base', 'dsh-better-sidebar'])
  await manager.installFromLock('lockfileVersion: 9\n')
  assert.match(calls.at(-1).join(' '), /install/i)
})
