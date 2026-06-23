/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import trustGraphTunables from '../trust_graph.tunables.json' with { type: 'json' }
import { mergeGraph } from '../trust_graph_engine.mjs'

Deno.test('hint-only node gets attenuated lift', () => {
	const node = 'a'.repeat(64)
	const graph = mergeGraph({
		hints: Array.from({ length: 20 }, (_, i) => ({
			nodeHash: node,
			source: `s${i}`,
			weight: 1,
		})),
		/** @returns {number} 固定分数 0。 */
		scoreOf: () => 0,
	})
	const score = graph.get(node)?.score ?? 0
	assertEquals(score > 0, true)
	assertEquals(score < trustGraphTunables.hintMaxBonus, true)
})

Deno.test('hints cannot inflate beyond bounded bonus over hard evidence', () => {
	const node = 'b'.repeat(64)
	const graph = mergeGraph({
		trustedPeers: [node],
		hints: Array.from({ length: 30 }, (_, i) => ({
			nodeHash: node,
			source: `poison-${i}`,
			weight: 2,
		})),
		/** @returns {number} 固定分数 0.2。 */
		scoreOf: () => 0.2,
	})
	const score = graph.get(node)?.score ?? 0
	assertEquals(score >= 0.2, true)
	assertEquals(score <= 0.2 + trustGraphTunables.hintMaxBonus + 1e-9, true)
})
