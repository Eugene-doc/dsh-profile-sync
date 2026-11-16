import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { applySnapshot } from '../lib/apply.js'
import { readProfile } from '../lib/profile.js'

async function fixture({ failOn = null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-apply-'))
  const profileDir = path.join(root, 'profile', 'desktop')
  await fs.mkdir(profileDir, { recursive: true })
  const packagePath = path.join(profileDir, 'package.json')
  const lockPath = path.join(profileDir, 'pnpm-lock.yaml')
  await fs.writeFile(
    packagePath,
    JSON.stringify({ dependencies: { old: '1.0.0' }, dsh: { profile: { bundles: ['base', 'old'] } } }),
    'utf8',
  )
  await fs.writeFile(lockPath, 'OLD LOCK\n', 'utf8')
  const skillsDir = path.join(root, 'skills')
  await fs.mkdir(skillsDir, { recursive: true })
  await fs.writeFile(path.join(skillsDir, 'old.md'), 'old\n', 'utf8')
  const deviceDir = path.join(root, 'data', 'profiles', 'desktop', 'devices', 'dev-1')
  await fs.mkdir(path.join(deviceDir, 'local-plugins'), { recursive: true })
  await fs.mkdir(path.join(deviceDir, 'skills'), { recursive: true })
  await fs.writeFile(path.join(deviceDir, 'skills', 'new.md'), 'new\n', 'utf8')
  const archive = path.join(deviceDir, 'local-plugins', 'local.tgz')
  await fs.writeFile(archive, 'archive\n', 'utf8')
  const sha = createHash('sha256').update('archive\n').digest('hex')
  const snapshot = {
    version: 1,
    deviceId: 'dev-1',
    deviceName: 'home5070',
    profileName: 'desktop',
    dshVersion: '0.2.2-rc.3',
    plugins: [
      { name: 'new', version: '2.0.0', source: 'registry' },
      { name: 'local', source: 'local', archive: 'local-plugins/local.tgz', sha256: sha },
    ],
    bundles: ['base', 'new', 'local'],
    skills: [{ name: 'new.md', sha256: createHash('sha256').update('new\n').digest('hex'), bytes: 4 }],
  }
  const calls = []
  const manager = {
    async readBundles() {
      return JSON.parse(await fs.readFile(packagePath, 'utf8')).dsh.profile.bundles
    },
    async addPackage(spec) {
      calls.push(['add', spec])
      if (failOn && spec.includes(failOn)) throw new Error('install failed')
    },
    async writeBundles(bundles) {
      calls.push(['bundles', bundles])
      const raw = JSON.parse(await fs.readFile(packagePath, 'utf8'))
      raw.dsh.profile.bundles = bundles
      await fs.writeFile(packagePath, JSON.stringify(raw), 'utf8')
    },
    async installFromLock(lock) {
      calls.push(['lock', lock])
    },
  }
  return { root, profileDir, packagePath, lockPath, skillsDir, deviceDir, snapshot, manager, calls }
}

test('applies packages, bundles and skills', async t => {
  const f = await fixture()
  t.after(() => fs.rm(f.root, { recursive: true, force: true }))
  const result = await applySnapshot({
    snapshot: f.snapshot,
    snapshotDir: f.deviceDir,
    inventory: await readProfile({ profileDir: f.profileDir }),
    packageManager: f.manager,
    skillsDir: f.skillsDir,
    backupDir: path.join(f.root, 'backup'),
    archivesDir: path.join(f.root, 'archives'),
    localDshVersion: '0.2.2-rc.3',
  })
  assert.equal(result.installed.length, 2)
  assert.equal(result.skills.added, 1)
  assert.deepEqual(await f.manager.readBundles(), ['base', 'old', 'new', 'local'])
  assert.match(f.calls.find(c => c[0] === 'add' && c[1].includes('@file:'))[1], /archives[/\\].+\.tgz$/)
})

test('blocks missing archive before installing anything', async t => {
  const f = await fixture()
  t.after(() => fs.rm(f.root, { recursive: true, force: true }))
  f.snapshot.plugins = [{ name: 'local', source: 'local', archive: 'local-plugins/missing.tgz', sha256: '0'.repeat(64) }]
  await assert.rejects(
    applySnapshot({
      snapshot: f.snapshot,
      snapshotDir: f.deviceDir,
      inventory: await readProfile({ profileDir: f.profileDir }),
      packageManager: f.manager,
      skillsDir: f.skillsDir,
      backupDir: path.join(f.root, 'backup'),
      archivesDir: path.join(f.root, 'archives'),
      localDshVersion: '0.2.2-rc.3',
    }),
    /archive/i,
  )
  assert.equal(f.calls.some(c => c[0] === 'add'), false)
})

test('rejects an unresolved plugin conflict before installing', async t => {
  const f = await fixture()
  t.after(() => fs.rm(f.root, { recursive: true, force: true }))
  await assert.rejects(
    applySnapshot({
      snapshot: { ...f.snapshot, plugins: [{ name: 'new', version: '3.0.0', source: 'registry' }] },
      snapshotDir: f.deviceDir,
      inventory: { ...(await readProfile({ profileDir: f.profileDir })), dependencies: { new: '2.0.0' } },
      packageManager: f.manager,
      skillsDir: f.skillsDir,
      backupDir: path.join(f.root, 'backup'),
      archivesDir: path.join(f.root, 'archives'),
      localDshVersion: '0.2.2-rc.3',
      base: { plugins: { new: '1.0.0' }, skills: {} },
    }),
    /conflict/i,
  )
  assert.equal(f.calls.some(c => c[0] === 'add'), false)
})

test('rejects a skill whose content does not match its declared hash', async t => {
  const f = await fixture()
  t.after(() => fs.rm(f.root, { recursive: true, force: true }))
  f.snapshot.skills = [{ ...f.snapshot.skills[0], sha256: '0'.repeat(64) }]
  await assert.rejects(
    applySnapshot({
      snapshot: f.snapshot,
      snapshotDir: f.deviceDir,
      inventory: await readProfile({ profileDir: f.profileDir }),
      packageManager: f.manager,
      skillsDir: f.skillsDir,
      backupDir: path.join(f.root, 'backup'),
      archivesDir: path.join(f.root, 'archives'),
      localDshVersion: '0.2.2-rc.3',
    }),
    /checksum/i,
  )
  assert.equal(f.calls.some(c => c[0] === 'add'), false)
})

test('rolls back when the post-apply state write fails', async t => {
  const f = await fixture()
  t.after(() => fs.rm(f.root, { recursive: true, force: true }))
  const before = await fs.readFile(f.packagePath, 'utf8')
  await assert.rejects(
    applySnapshot({
      snapshot: f.snapshot,
      snapshotDir: f.deviceDir,
      inventory: await readProfile({ profileDir: f.profileDir }),
      packageManager: f.manager,
      skillsDir: f.skillsDir,
      backupDir: path.join(f.root, 'backup'),
      archivesDir: path.join(f.root, 'archives'),
      localDshVersion: '0.2.2-rc.3',
      afterApply: async () => { throw new Error('state write failed') },
    }),
    /state write failed/,
  )
  assert.equal(await fs.readFile(f.packagePath, 'utf8'), before)
  assert.ok(f.calls.some(c => c[0] === 'lock'))
})

test('restores files when a package install fails', async t => {
  const f = await fixture({ failOn: '.tgz' })
  t.after(() => fs.rm(f.root, { recursive: true, force: true }))
  const before = await fs.readFile(f.packagePath, 'utf8')
  await assert.rejects(
    applySnapshot({
      snapshot: { ...f.snapshot, plugins: [{ name: 'local', version: '1.0.0', source: 'local', archive: 'local-plugins/local.tgz', sha256: f.snapshot.plugins[1].sha256 }] },
      snapshotDir: f.deviceDir,
      inventory: await readProfile({ profileDir: f.profileDir }),
      packageManager: f.manager,
      skillsDir: f.skillsDir,
      backupDir: path.join(f.root, 'backup'),
      archivesDir: path.join(f.root, 'archives'),
      localDshVersion: '0.2.2-rc.3',
    }),
    /install failed/,
  )
  assert.equal(await fs.readFile(f.packagePath, 'utf8'), before)
  assert.ok(f.calls.some(c => c[0] === 'lock'))
})
