import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export async function ensureRepo({ repoPath, remote, branch = 'main' }) {
  if (await exists(path.join(repoPath, '.git'))) {
    await runGit(repoPath, ['fetch', '--prune', 'origin'])
    return repoPath
  }
  await fs.mkdir(path.dirname(repoPath), { recursive: true })
  await runGit(path.dirname(repoPath), [
    'clone',
    '--branch',
    branch,
    remote,
    repoPath,
  ])
  return repoPath
}

async function hasTrackedChanges(repoPath) {
  const status = await runGit(repoPath, ['status', '--porcelain'])
  return status.stdout
    .split(/\r?\n/)
    .some(line => line.trim() && !line.startsWith('??'))
}

export async function fetchRepo({ repoPath, branch = 'main' }) {
  await runGit(repoPath, ['fetch', '--prune', 'origin'])
  await runGit(repoPath, ['checkout', branch])

  // Snapshot files are generated from the live profile. A previous interrupted
  // sync can leave them modified in the worktree, which makes --ff-only abort.
  // Keep a recoverable stash, pull the remote state, then discard the stale
  // tracked snapshot. Untracked local files are left alone.
  let stashed = false
  if (await hasTrackedChanges(repoPath)) {
    await runGit(repoPath, ['stash', 'push', '-m', 'profile-sync: pre-pull generated snapshot'])
    stashed = true
  }

  try {
    await runGit(repoPath, ['pull', '--ff-only', 'origin', branch])
  } catch (error) {
    if (stashed) {
      await runGit(repoPath, ['stash', 'pop']).catch(() => {})
    }
    throw error
  }

  if (stashed) {
    await runGit(repoPath, ['stash', 'drop', 'stash@{0}']).catch(() => {})
  }
}

export async function commitAndPush({ repoPath, message, branch = 'main' }) {
  await runGit(repoPath, ['add', '-A'])
  let commit = { stdout: '' }
  try {
    commit = await runGit(repoPath, [
      '-c',
      'user.name=Eugene-doc',
      '-c',
      'user.email=Eugene-doc@users.noreply.github.com',
      'commit',
      '-m',
      message,
    ])
  } catch (error) {
    if (!/nothing to commit|no changes added/i.test(`${error.stdout}${error.stderr}`)) throw error
  }
  await runGit(repoPath, ['push', 'origin', branch])
  const head = await runGit(repoPath, ['rev-parse', 'HEAD'])
  const subject = await runGit(repoPath, ['log', '-1', '--format=%s'])
  return { sha: head.stdout.trim(), subject: subject.stdout.trim(), output: commit.stdout }
}
