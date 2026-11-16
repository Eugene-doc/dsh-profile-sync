import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { packageLocalPlugin, verifyArchive } from '../lib/archive.js'

async function makePlugin() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-local-'))
  const plugin = path.join(root, 'dsh-token-budget')
  await fs.mkdir(plugin, { recursive: true })
  await fs.writeFile(
    path.join(plugin, 'package.json'),
    JSON.stringify({ name: 'dsh-token-budget', version: '1.2.3' }),
    'utf8',
  )
  await fs.writeFile(path.join(plugin, 'index.js'), 'export const ok = true\n', 'utf8')
  return { root, plugin }
}

test('packages a local plugin and verifies its checksum', async t => {
  const { root, plugin } = await makePlugin()
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const outDir = path.join(root, 'out')
  const result = await packageLocalPlugin({ name: 'dsh-token-budget', spec: `link:${plugin}`, outDir })
  assert.match(result.archive, /dsh-token-budget-1\.2\.3\.tgz$/)
  assert.equal(result.sha256.length, 64)
  assert.equal(await verifyArchive(result), true)
})

test('rejects a local plugin without package.json', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-local-bad-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const plugin = path.join(root, 'empty')
  await fs.mkdir(plugin)
  await assert.rejects(
    packageLocalPlugin({ name: 'empty', spec: `link:${plugin}`, outDir: path.join(root, 'out') }),
    /package\.json/,
  )
})
