/**
 * SocialClient：绑定实体发帖 / 互动 / 收藏搜索。
 */
/* global Deno */
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

Deno.test('getSocialClient defaults to operator and posts return Post', async () => {
	const { username, operator } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username)
	assertEquals(client.entityHash, operator)

	const post = await client.post({ text: `social-client-post-${Date.now()}` })
	assertEquals(post.entityHash, operator)
	assert(post.postId)
	assertEquals(typeof post.like, 'function')

	const liked = await post.like()
	assertEquals(liked.type, 'like')

	await client.saved.add({ entityHash: post.entityHash, postId: post.postId })
	const hit = await client.saved.search('social-client-post')
	assert(hit.posts.some(row => row.postId === post.postId))
})

Deno.test('getSocialClient rejects foreign entityHash', async () => {
	const { username } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	await assertRejects(
		() => getSocialClient(username, 'a'.repeat(128)),
		Error,
		'invalid entityHash',
	)
})
