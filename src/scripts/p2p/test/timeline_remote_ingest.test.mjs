/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validateRemoteTimelineEvent } from '../timeline/remote_ingest.mjs'
import { timelineGroupId } from '../social_namespace.mjs'

const owner = 'a'.repeat(64) + 'b'.repeat(64)

Deno.test('validateRemoteTimelineEvent rejects wrong groupId', async () => {
	const result = await validateRemoteTimelineEvent({
		type: 'post',
		groupId: 'social-timeline:' + 'c'.repeat(128),
		sender: 'd'.repeat(64),
		id: 'e'.repeat(64),
	}, owner, { canonicalize: e => e })
	assertEquals(result.accepted, false)
})

Deno.test('validateRemoteTimelineEvent rejects unknown event type', async () => {
	const result = await validateRemoteTimelineEvent({
		type: 'message',
		groupId: timelineGroupId(owner),
		sender: 'd'.repeat(64),
		id: 'e'.repeat(64),
	}, owner, { canonicalize: e => e })
	assertEquals(result.accepted, false)
})
