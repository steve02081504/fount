/**
 * push admission：本机被关注的 follow 推送应被接纳。
 */
/* global Deno */
import { assert } from 'jsr:@std/assert'

import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()
const admission = await import('../../src/federation/push_admission.mjs')

const REMOTE_FOLLOWER = placeholderEntityHash('f')

Deno.test('push admission: follow targeting local operator is admitted', async () => {
	const { username, operator } = await getSession()
	assert(
		await admission.isRemoteTimelinePushAdmitted(username, REMOTE_FOLLOWER, {
			type: 'follow',
			content: { targetEntityHash: operator },
		}),
		'followed party must accept follower timeline push',
	)
})

Deno.test('push admission: unrelated remote timeline still rejected', async () => {
	const { username } = await getSession()
	assert(
		!await admission.isRemoteTimelinePushAdmitted(username, REMOTE_FOLLOWER, {
			type: 'post',
			content: { text: 'nope', visibility: 'public' },
		}),
		'non-follow push from unfollowed remote stays rejected',
	)
})
