/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	getRecentStalePeerPrunes,
	getStalePeerPruneCount,
	recordStalePeerPrune,
} from '../../stale_peer_log.mjs'

Deno.test('recordStalePeerPrune accumulates per scope and retains recent entries', () => {
	const scope = `test-scope-${Date.now()}`
	recordStalePeerPrune(scope, [
		{ peerId: 'p1', remoteNodeHash: 'a'.repeat(64) },
		{ peerId: 'p2', remoteNodeHash: 'b'.repeat(64) },
	])
	assertEquals(getStalePeerPruneCount(scope), 2)
	const recent = getRecentStalePeerPrunes()
	assertEquals(recent.some(row => row.scope === scope && row.peerId === 'p1'), true)
})

Deno.test('recordStalePeerPrune ignores empty batches', () => {
	const scope = `empty-scope-${Date.now()}`
	recordStalePeerPrune(scope, [])
	assertEquals(getStalePeerPruneCount(scope), 0)
})
