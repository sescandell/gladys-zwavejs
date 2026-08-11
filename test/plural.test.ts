import assert from 'node:assert/strict'
import test from 'node:test'

import { countEn, countFr } from '../src/plural.ts'

test('English pluralizes everything except one', () => {
  assert.equal(countEn(0, 'node', 'nodes'), '0 nodes')
  assert.equal(countEn(1, 'node', 'nodes'), '1 node')
  assert.equal(countEn(2, 'node', 'nodes'), '2 nodes')
})

test('French keeps the singular for zero as well', () => {
  // The reason the two languages need separate functions: `count > 1` is wrong
  // in English, `count === 1` is wrong in French.
  assert.equal(countFr(0, 'nœud connu', 'nœuds connus'), '0 nœud connu')
  assert.equal(countFr(1, 'nœud connu', 'nœuds connus'), '1 nœud connu')
  assert.equal(countFr(2, 'nœud connu', 'nœuds connus'), '2 nœuds connus')
})
