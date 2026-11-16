import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { ProfileSyncEngine } from '../lib/engine.js'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

test('creates a snapshot in the private data repo', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-engine-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bare = path.join(root, 'data.git')
  git(root, 'init', '--bare', bare)
  const seed = path.join(root, 'seed')
  git(root, 'clone', bare, seed)
  git(seed, 'config', 'user.name', 'Test')
  git(seed, 'config', 'user.email', 'test@example.com')
  await fs.writeFile(path.join(seed, 'README.md'), '# data\n', 'utf8')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-m', 'seed')
  git(seed, 'push', 'origin', 'HEAD:main')

  const home = path.join(root, 'home')
  const profileDir = path.join(home, 'profiles', 'desktop')
  const localPlugin = path.join(root, 'dsh-token-budget')
  const skillsDir = path.join(home, 'skills')
  await fs.mkdir(profileDir, { recursive: true })
  await fs.mkdir(localPlugin, { recursive: true })
  await fs.mkdir(skillsDir, { recursive: true })
  await fs.writeFile(path.join(localPlugin, 'package.json'), JSON.stringify({ name: 'dsh-token-budget', version: '1.0.0' }), 'utf8')
  await fs.writeFile(path.join(localPlugin, 'index.js'), 'export {}\n', 'utf8')
  await fs.writeFile(path.join(skillsDir, 'skill.md'), '# skill\n', 'utf8')
  await fs.writeFile(
    path.join(profileDir, 'package.json'),
    JSON.stringify({
      dependencies: { 'dsh-better-sidebar': '0.31.1', 'dsh-token-budget': `link:${localPlugin}` },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-better-sidebar', 'dsh-token-budget'] } },
    }),
    'utf8',
  )
  await fs.writeFile(path.join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')

  const engine = new ProfileSyncEngine({
    home,
    profileName: 'desktop',
    profileDir,
    remote: bare,
    branch: 'main',
    dshVersion: '0.2.2-rc.3',
    machineGuid: 'machine-1',
  })
  const result = await engine.snapshot()
  assert.equal(result.snapshot.plugins.length, 2)
  const devices = await engine.devices()
  assert.equal(devices.length, 1)
  assert.equal(devices[0].plugins, 2)
  assert.equal(devices[0].skills, 1)
})
