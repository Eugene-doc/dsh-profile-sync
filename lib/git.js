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

export async function fetchRepo({ repoPath, branch = 'main' }) {
  await runGit(repoPath, ['fetch', '--prune', 'origin'])
  await runGit(repoPath, ['checkout', branch])
  await runGit(repoPath, ['pull', '--ff-only', 'origin', branch])
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
