/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { capHintsBySource, normalizeNetwork } from '../network.mjs'

const NODE = `${'a'.repeat(64)}`

Deno.test('capHintsBySource limits per-source hints', () => {
	const hints = []
	for (let i = 0; i < 20; i++)
		hints.push({
			nodeHash: NODE,
			source: 'pex:flood',
			kind: 'pex',
			weight: 0.1,
			expiresAt: Date.now() + 1e6,
		})
	const capped = capHintsBySource(hints, 5)
	assertEquals(capped.length, 5)
	assertEquals(capped.every(h => h.source === 'pex:flood'), true)
})

Deno.test('normalizeNetwork still dedupes peers', () => {
	const net = normalizeNetwork({
		trustedPeers: [NODE],
		explorePeers: [],
		hints: [],
	})
	assertEquals(net.trustedPeers, [NODE])
})
