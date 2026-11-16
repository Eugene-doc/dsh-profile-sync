import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { applySkills, readSkills } from '../lib/skills.js'

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-skills-'))
  const skillsDir = path.join(root, 'skills')
  await fs.mkdir(path.join(skillsDir, 'nested'), { recursive: true })
  await fs.writeFile(path.join(skillsDir, 'local.md'), 'local\n', 'utf8')
  await fs.writeFile(path.join(skillsDir, 'nested', 'ignored.md'), 'ignore\n', 'utf8')
  return { root, skillsDir }
}

test('reads only top-level markdown skills', async t => {
  const { root, skillsDir } = await fixture()
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const skills = await readSkills({ skillsDir })
  assert.deepEqual(skills.map(skill => skill.name), ['local.md'])
  assert.equal(skills[0].sha256.length, 64)
})

test('normalizes CRLF when hashing and reading a skill', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-skills-crlf-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const skillsDir = path.join(root, 'skills')
  await fs.mkdir(skillsDir)
  await fs.writeFile(path.join(skillsDir, 'win.md'), 'a\r\nb\r\n', 'utf8')
  const [skill] = await readSkills({ skillsDir, includeContent: true })
  assert.equal(skill.contentHash, sha('a\nb\n'))
  assert.equal(skill.content, 'a\nb\n')
})

test('adds a remote skill and backs up an overwritten local skill', async t => {
  const { root, skillsDir } = await fixture()
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const remote = [
    { name: 'remote.md', sha256: sha('remote\n'), bytes: 7, content: 'remote\n' },
    { name: 'local.md', sha256: sha('different\n'), bytes: 10, content: 'different\n' },
  ]
  const result = await applySkills({
    skillsDir,
    remoteSkills: remote,
    base: { 'local.md': sha('local\n') },
    backupDir: path.join(root, 'backup'),
  })
  assert.equal(result.added, 1)
  assert.equal(result.updated, 1)
  assert.equal(await fs.readFile(path.join(skillsDir, 'local.md'), 'utf8'), 'different\n')
  assert.equal(await fs.readFile(path.join(root, 'backup', 'skills', 'local.md'), 'utf8'), 'local\n')
})

test('keeps both sides when both changed from base', async t => {
  const { root, skillsDir } = await fixture()
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const result = await applySkills({
    skillsDir,
    remoteSkills: [{ name: 'local.md', sha256: sha('remote\n'), bytes: 7, content: 'remote\n' }],
    base: { 'local.md': sha('base\n') },
    backupDir: path.join(root, 'backup'),
  })
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.updated, 0)
  assert.equal(await fs.readFile(path.join(skillsDir, 'local.md'), 'utf8'), 'local\n')
})

function sha(text) {
  return createHash('sha256').update(text).digest('hex')
}
