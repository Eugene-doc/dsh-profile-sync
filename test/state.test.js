import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { loadState, readMachineGuid, saveState } from '../lib/state.js'

test('derives a stable device id from machine guid and profile', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-sync-state-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const statePath = path.join(dir, 'state.json')
  const run = async () => ({ stdout: '    MachineGuid    REG_SZ    machine-1\n' })
  assert.equal(await readMachineGuid({ run }), 'machine-1')
  const first = await loadState({ statePath, profileName: 'desktop', machineGuid: 'machine-1', hostname: 'home5070' })
  const other = await loadState({ statePath, profileName: 'desktop', machineGuid: 'machine-2', hostname: 'home5070' })
  assert.notEqual(first.deviceId, other.deviceId)
  assert.equal(first.machineKey.length, 64)
  await saveState({ statePath, state: first })
  const restored = await loadState({ statePath, profileName: 'desktop', machineGuid: 'machine-1', hostname: 'home5070' })
  assert.equal(restored.deviceId, first.deviceId)
  const corrupt = { ...restored, deviceId: 'not-the-derived-id' }
  await saveState({ statePath, state: corrupt })
  await assert.rejects(
    loadState({ statePath, profileName: 'desktop', machineGuid: 'machine-1', hostname: 'home5070' }),
    /deviceId/,
  )
})
