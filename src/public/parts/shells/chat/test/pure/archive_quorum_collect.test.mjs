/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { archiveMonthQuorumSatisfied } from '../../src/chat/federation/federationCollect.mjs'

const DIGEST = `${'a'.repeat(64)}`

Deno.test('archiveMonthQuorumSatisfied ignores unverified wire digest', () => {
	const satisfied = archiveMonthQuorumSatisfied([
		{ complete: true, digest: DIGEST },
		{ complete: true, digest: DIGEST },
	])
	assertEquals(satisfied, false)
})

Deno.test('archiveMonthQuorumSatisfied accepts verified digest quorum', () => {
	const satisfied = archiveMonthQuorumSatisfied([
		{ complete: true, verified: true, digest: DIGEST },
		{ complete: true, verified: true, digest: DIGEST },
	])
	assertEquals(satisfied, true)
})
