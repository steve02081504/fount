/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import archiveTunables from '../archive.tunables.json' with { type: 'json' }
import mailboxTunables from '../mailbox/mailbox.tunables.json' with { type: 'json' }
import trustGraphTunables from '../trust_graph.tunables.json' with { type: 'json' }
import {
	resolveArchiveQuorumPeerMin,
	resolveArchiveQuorumPeerStrictMin,
	resolveArchiveQuorumThresholds,
	resolveFederationFanoutTopK,
	resolveMailboxRelayFanout,
	resolveMailboxWantFanout,
	scaleCount,
} from '../tunables_resolve.mjs'

Deno.test('scaleCount respects floor ratio cap and n', () => {
	assertEquals(scaleCount(0, { floor: 2, ratio: 0.5 }), 2)
	assertEquals(scaleCount(8, { floor: 2, ratio: 0.25 }), 2)
	assertEquals(scaleCount(8, { floor: 2, ratio: 0.5 }), 4)
	assertEquals(scaleCount(40, { floor: 2, ratio: 0.5, cap: 16 }), 16)
	assertEquals(scaleCount(3, { floor: 2, ratio: 0.5 }), 2)
})

Deno.test('archive quorum scales with n at reference 8', () => {
	assertEquals(resolveArchiveQuorumPeerMin(8, archiveTunables), 2)
	assertEquals(resolveArchiveQuorumPeerStrictMin(8, archiveTunables), 4)
	assertEquals(resolveArchiveQuorumPeerMin(2, archiveTunables), 2)
	assertEquals(resolveArchiveQuorumPeerStrictMin(2, archiveTunables), 2)
})

Deno.test('mailbox fanout scales and caps', () => {
	assertEquals(resolveMailboxRelayFanout(8, mailboxTunables), 3)
	assertEquals(resolveMailboxWantFanout(8, mailboxTunables), 4)
	assertEquals(resolveMailboxRelayFanout(100, mailboxTunables), 30)
	assertEquals(resolveMailboxWantFanout(100, mailboxTunables), 32)
})

Deno.test('federation fanout topK scales and caps', () => {
	assertEquals(resolveFederationFanoutTopK(8, trustGraphTunables), 3)
	assertEquals(resolveFederationFanoutTopK(40, trustGraphTunables), 14)
	assertEquals(resolveFederationFanoutTopK(100, trustGraphTunables), 16)
})

Deno.test('resolveArchiveQuorumThresholds uses max of member and candidate counts', () => {
	const t = resolveArchiveQuorumThresholds(archiveTunables, 3, 8)
	assertEquals(t.peerMin, 2)
	assertEquals(t.strictMin, 4)
})
