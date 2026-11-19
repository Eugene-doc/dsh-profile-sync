import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { commitAndPush, ensureRepo, fetchRepo } from '../lib/git.js'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

test('clones, commits and pushes a snapshot', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-git-'))
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

  const repo = path.join(root, 'repo')
  await ensureRepo({ repoPath: repo, remote: bare, branch: 'main' })
  await fs.writeFile(path.join(repo, 'snapshot.json'), '{"version":1}\n', 'utf8')
  const commit = await commitAndPush({ repoPath: repo, message: 'snapshot' })
  assert.equal(commit.subject, 'snapshot')
  assert.match(git(bare, 'log', 'main', '--oneline', '-1'), /snapshot/)
})

test('fast-forwards over stale generated changes without losing local files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-git-dirty-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bare = path.join(root, 'data.git')
  git(root, 'init', '--bare', bare)
  const seed = path.join(root, 'seed')
  git(root, 'clone', bare, seed)
  git(seed, 'config', 'user.name', 'Test')
  git(seed, 'config', 'user.email', 'test@example.com')
  await fs.writeFile(path.join(seed, 'snapshot.json'), '{"version":1,"remote":true}\n', 'utf8')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-m', 'seed')
  git(seed, 'push', 'origin', 'HEAD:main')

  const repo = path.join(root, 'repo')
  await ensureRepo({ repoPath: repo, remote: bare, branch: 'main' })
  await fs.writeFile(path.join(repo, 'snapshot.json'), '{"version":1,"local":true}\n', 'utf8')
  await fs.writeFile(path.join(repo, 'local-only.txt'), 'keep me\n', 'utf8')

  await fetchRepo({ repoPath: repo, branch: 'main' })

  assert.match(await fs.readFile(path.join(repo, 'snapshot.json'), 'utf8'), /"remote":true/)
  assert.equal(await fs.readFile(path.join(repo, 'local-only.txt'), 'utf8'), 'keep me\n')
  assert.equal(git(repo, 'status', '--porcelain').trim(), '?? local-only.txt')
})
