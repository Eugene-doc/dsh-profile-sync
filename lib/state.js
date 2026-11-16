import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readJson, toIso, writeJsonAtomic } from './util.js'

export async function readMachineGuid({ run }) {
  try {
    const result = await run('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid',
    ])
    const match = String(result.stdout || '').match(/MachineGuid\s+REG_SZ\s+([^\s]+)/)
    if (match) return match[1]
  } catch (error) {
    if (process.platform === 'win32') {
      throw new Error(`cannot read Windows MachineGuid: ${error?.message || error}`)
    }
  }
  return os.hostname()
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function uuidFromHex(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export async function loadState({ statePath, profileName, machineGuid, hostname }) {
  const machineKey = hash(`${machineGuid}\0${profileName}`)
  const existing = await readJson(statePath, null)
  if (existing?.machineKey === machineKey && existing?.profileName === profileName) {
    const expectedId = uuidFromHex(machineKey)
    if (existing.deviceId !== expectedId) {
      throw new Error('profile-sync state deviceId does not match this machine')
    }
    return {
      ...existing,
      base: { plugins: {}, skills: {}, ...(existing.base || {}) },
    }
  }
  return {
    version: 1,
    profileName,
    machineKey,
    deviceId: uuidFromHex(machineKey),
    deviceName: hostname || os.hostname(),
    createdAt: toIso(),
    lastSync: null,
    lastApplied: null,
    base: { plugins: {}, skills: {} },
  }
}

export async function saveState({ statePath, state }) {
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await writeJsonAtomic(statePath, state)
}

export function readStateSync(statePath) {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}
