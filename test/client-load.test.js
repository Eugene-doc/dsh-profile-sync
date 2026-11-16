import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

test('client bundle registers the profile-sync plugin', () => {
  let registration
  const context = {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context)
  assert.equal(registration?.id, 'dsh-profile-sync')
  assert.equal(typeof registration.factory, 'function')
})
