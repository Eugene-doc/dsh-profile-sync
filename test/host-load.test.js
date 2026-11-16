import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as host from '../index.js'

test('host exports plugin name and apply', () => {
  assert.equal(host.name, 'dsh-profile-sync')
  assert.equal(typeof host.apply, 'function')
})
