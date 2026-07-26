/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

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
