/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { timelineGroupId } from '../social_namespace.mjs'
import { validateRemoteTimelineEvent } from '../timeline/remote_ingest.mjs'

const owner = 'a'.repeat(64) + 'b'.repeat(64)

/**
 * 返回恒等规范化函数。
 * @param {object} e 事件
 * @returns {object} 规范化后的事件（测试用恒等）
 */
const identityCanonicalize = e => e

Deno.test('validateRemoteTimelineEvent rejects wrong groupId', async () => {
	const result = await validateRemoteTimelineEvent({
		type: 'post',
		groupId: 'social-timeline:' + 'c'.repeat(128),
		sender: 'd'.repeat(64),
		id: 'e'.repeat(64),
	}, owner, { canonicalize: identityCanonicalize })
	assertEquals(result.accepted, false)
})

Deno.test('validateRemoteTimelineEvent rejects unknown event type', async () => {
	const result = await validateRemoteTimelineEvent({
		type: 'message',
		groupId: timelineGroupId(owner),
		sender: 'd'.repeat(64),
		id: 'e'.repeat(64),
	}, owner, { canonicalize: identityCanonicalize })
	assertEquals(result.accepted, false)
})
