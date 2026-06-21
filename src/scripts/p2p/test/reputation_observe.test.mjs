/* global Deno */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { initNode } from '../node/instance.mjs'
import { isQuarantinedPure } from '../reputation_engine.mjs'
import { loadReputation, observePeerBehavior } from '../reputation_store.mjs'

const PEER = 'c'.repeat(64)

Deno.test('observePeerBehavior awaits reputation mutation before returning', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fount-rep-'))
	initNode({ nodeDir: dir })
	await mkdir(dir, { recursive: true })
	try {
		for (let i = 0; i < 6; i++)
			await observePeerBehavior(PEER, 0.05)

		const anomaly = await observePeerBehavior(PEER, 5)
		assertEquals(anomaly, true)
		assertEquals(isQuarantinedPure(loadReputation(), PEER), true)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})
