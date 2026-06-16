/**
 * 信誉中继去重单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { relayBumpIsDuplicate } from '../../../../../scripts/p2p/reputation_relay_dedupe.mjs'

Deno.test('relayBumpIsDuplicate blocks same peer and key within window', () => {
	const now = Date.now()
	const seen = [{ peerNodeHash: 'peer-1', key: 'dag:abc', t: now }]
	assertEquals(relayBumpIsDuplicate(seen, 'peer-1', 'dag:abc', now + 1000), true)
	assertEquals(relayBumpIsDuplicate(seen, 'peer-1', 'dag:other', now + 1000), false)
})
