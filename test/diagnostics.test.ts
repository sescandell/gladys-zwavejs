import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { ZwaveIntegration } from '../src/runtime/ZwaveIntegration.ts'
import type { GetNodesResponse, ZwaveNode } from '../src/types/zwave.ts'
import { createFakeGladys, createFakeLogger } from './helpers/fakes.ts'

/**
 * An integration has no diagnostics page of its own yet, so the journal is the
 * only thing a user can copy out when reporting a problem. What it prints has
 * to be enough to tell a half-interviewed network from a healthy one.
 */

type NodesHandler = { onNodes(message: GetNodesResponse): Promise<void> }

const readAnswer = (): GetNodesResponse =>
  JSON.parse(
    readFileSync(new URL('./fixtures/exampleNodes.json', import.meta.url), 'utf8'),
  ) as GetNodesResponse

test('the network is summarized in the journal, one line per node', async () => {
  const answer = readAnswer()
  const logger = createFakeLogger()
  const integration = new ZwaveIntegration(createFakeGladys().gladys, logger)

  await (integration as unknown as NodesHandler).onNodes(answer)

  const summary = logger.infos.join('\n')
  assert.match(summary, /Z-Wave network: 10 nodes/)
  for (const node of answer.result ?? []) {
    assert.match(summary, new RegExp(`node ${node.id}:`), `node ${node.id} must be listed`)
  }
  // The two facts that explain a device published with no feature.
  assert.match(summary, /ready=true/)
  assert.match(summary, /\d+ values/)

  await integration.stop()
})

test('a half-interviewed node is visible as such', async () => {
  const logger = createFakeLogger()
  const integration = new ZwaveIntegration(createFakeGladys().gladys, logger)
  const node: ZwaveNode = { id: 12, name: 'Prise', ready: false, status: 'Asleep' }

  await (integration as unknown as NodesHandler).onNodes({ success: true, result: [node] })

  assert.match(logger.infos.join('\n'), /node 12: Prise — ready=false status=Asleep 0 values/)

  await integration.stop()
})

test('the dump_nodes button writes the whole network to the journal', async () => {
  const answer = readAnswer()
  const logger = createFakeLogger()
  const integration = new ZwaveIntegration(createFakeGladys().gladys, logger)
  await (integration as unknown as NodesHandler).onNodes(answer)

  const message = integration.dumpNodes()
  assert.match(message.fr ?? '', /10 nœuds écrits dans le journal/)

  const dump = logger.infos.find((line) => line.startsWith('Known nodes: '))
  assert.ok(dump, 'the button must log the nodes')
  // It has to survive a copy-paste back into a fixture, or it is worthless.
  const parsed = JSON.parse(dump.slice('Known nodes: '.length)) as GetNodesResponse
  assert.equal(parsed.result?.length, answer.result?.length)
  assert.deepEqual(
    parsed.result?.map((node) => node.id),
    answer.result?.map((node) => node.id),
  )

  await integration.stop()
})

test('the dump_nodes button says so when nothing is known yet', async () => {
  const integration = new ZwaveIntegration(createFakeGladys().gladys, createFakeLogger())

  assert.match(integration.dumpNodes().fr ?? '', /Aucun nœud/)

  await integration.stop()
})

test('a resynchronization does not reprint the whole network', async () => {
  // `getNodes` is now also asked for on the fly, so logging every answer would
  // bury the journal under a dump the user never asked for.
  const answer = readAnswer()
  const logger = createFakeLogger()
  const integration = new ZwaveIntegration(createFakeGladys().gladys, logger)

  const handler = integration as unknown as NodesHandler
  await handler.onNodes(answer)
  await handler.onNodes(answer)

  // Counting only the summary: the discovery publication logs on every answer,
  // and that one is meant to.
  const summaries = logger.infos.filter((line) => line.startsWith('Z-Wave network:'))
  assert.equal(summaries.length, 1, 'the network is summarized once per start')

  await integration.stop()
})
