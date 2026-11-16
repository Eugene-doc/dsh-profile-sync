import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffSnapshot } from '../lib/diff.js'

const base = { plugins: {}, skills: {} }
const inventory = {
  dependencies: {
    'same-plugin': '1.0.0',
    'new-local': 'link:C:/local',
    'changed-plugin': '1.0.0',
    'local-only': '2.0.0',
  },
  bundles: [],
}

test('classifies plugin changes', () => {
  const remote = {
    snapshot: {
      dshVersion: '0.2.2-rc.3',
      plugins: [
        { name: 'same-plugin', version: '1.0.0', source: 'registry' },
        { name: 'new-local', version: '1.0.0', source: 'local', sha256: 'a'.repeat(64) },
        { name: 'changed-plugin', version: '2.0.0', source: 'registry' },
      ],
      skills: [],
    },
  }
  const result = diffSnapshot({ inventory, skills: [], base, remote })
  assert.equal(result.plugins.find(p => p.name === 'same-plugin').action, 'same')
  assert.equal(result.plugins.find(p => p.name === 'new-local').action, 'update')
  assert.equal(result.plugins.find(p => p.name === 'changed-plugin').action, 'update')
  assert.equal(result.plugins.find(p => p.name === 'local-only').action, 'local-only')
})

test('compares a local plugin by content hash, not by linked path', () => {
  const result = diffSnapshot({
    inventory: { dependencies: { 'dsh-token-budget': 'link:C:/Users/User/...' }, bundles: [] },
    skills: [],
    base: { plugins: {}, skills: {} },
    localArchives: { 'dsh-token-budget': { contentHash: 'a'.repeat(64) } },
    remote: {
      snapshot: {
        dshVersion: '0.2.2-rc.3',
        plugins: [{ name: 'dsh-token-budget', source: 'local', contentHash: 'a'.repeat(64), sha256: 'b'.repeat(64) }],
        skills: [],
      },
    },
  })
  assert.equal(result.plugins[0].action, 'same')
})

test('reports a skill conflict when both sides changed from base', () => {
  const result = diffSnapshot({
    inventory: { dependencies: {}, bundles: [] },
    skills: [{ name: 'skill.md', sha256: 'c'.repeat(64) }],
    base: { plugins: {}, skills: { 'skill.md': 'b'.repeat(64) } },
    remote: { snapshot: { dshVersion: '0.2.2-rc.3', plugins: [], skills: [{ name: 'skill.md', sha256: 'd'.repeat(64) }] }, skills: [] },
  })
  assert.equal(result.skills[0].action, 'conflict')
})

test('blocks a different DSH major', () => {
  const result = diffSnapshot({
    inventory: { dependencies: {}, bundles: [] },
    skills: [],
    base,
    remote: { snapshot: { dshVersion: '1.0.0', plugins: [], skills: [] }, skills: [] },
    localDshVersion: '0.2.2-rc.3',
  })
  assert.equal(result.compatible, false)
  assert.ok(result.warnings.length)
})
