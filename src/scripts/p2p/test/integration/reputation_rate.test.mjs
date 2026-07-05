/* global Deno */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { initTestP2pNode } from '../../test/helpers/node.mjs'
import { loadReputation, recordMessageRateViolation } from '../../reputation_store.mjs'

const PEER = 'd'.repeat(64)

Deno.test('recordMessageRateViolation awaits persistence before returning', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fount-rep-rate-'))
	initTestP2pNode({ nodeDir: dir })
	await mkdir(dir, { recursive: true })
	try {
		await recordMessageRateViolation(PEER, 1)
		const score = loadReputation().byNodeHash[PEER]?.score ?? 0
		assertEquals(score < -0.01, true)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})
