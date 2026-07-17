/**
 * HTTP POST /posts 路由（integration 进程内 bypass 覆盖不到 spread 路径）。
 */
/* global Deno */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchNode, pickAvailablePort, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'


const bootstrapPath = join(dirname(fileURLToPath(import.meta.url)), '../node_bootstrap.mjs')

Deno.test({
	name: 'POST /posts accepts body without mediaRefs',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const port = await pickAvailablePort(28931)
	const apiKey = `fount-social-posts-http-${Date.now().toString(36)}`
	const node = await launchNode({
		port,
		username: 'social-posts-http-user',
		apiKey,
		loadParts: ['shells/social', 'shells/chat'],
		bootstrap: bootstrapPath,
		p2p: false,
		minP2pNode: true,
	})
	const { baseUrl } = node
	try {
		const viewerRes = await fetch(`${baseUrl}/api/parts/shells:chat/viewer?fount-apikey=${encodeURIComponent(apiKey)}`)
		assertEquals(viewerRes.status, 200)
		const { viewerEntityHash } = await viewerRes.json()
		assert(viewerEntityHash)

		const postRes = await fetch(`${baseUrl}/api/parts/shells:social/posts?fount-apikey=${encodeURIComponent(apiKey)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				entityHash: viewerEntityHash,
				text: 'integration posts http',
				visibility: 'public',
				locale: 'zh-CN',
			}),
		})
		const postRaw = await postRes.text()
		assertEquals(postRes.status, 200, postRaw)
		const body = JSON.parse(postRaw)
		assert(body.event?.id)
		assertEquals(body.event.content?.text, 'integration posts http')

		const pollRes = await fetch(`${baseUrl}/api/parts/shells:social/posts?fount-apikey=${encodeURIComponent(apiKey)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				entityHash: viewerEntityHash,
				text: 'poll via http',
				visibility: 'public',
				locale: 'zh-CN',
				poll: { options: ['yes', 'no'], multi: false },
			}),
		})
		const pollRaw = await pollRes.text()
		assertEquals(pollRes.status, 200, pollRaw)
		const pollBody = JSON.parse(pollRaw)
		const pollPostId = pollBody.event?.id
		assert(pollPostId)
		assertEquals(pollBody.event.content?.poll?.options?.length, 2)

		const voteRes = await fetch(
			`${baseUrl}/api/parts/shells:social/posts/${viewerEntityHash}/${pollPostId}/poll-vote?fount-apikey=${encodeURIComponent(apiKey)}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ choices: [1] }),
			},
		)
		const voteRaw = await voteRes.text()
		assertEquals(voteRes.status, 200, voteRaw)
		assertEquals(JSON.parse(voteRaw).event?.type, 'poll_vote')

		const editRes = await fetch(
			`${baseUrl}/api/parts/shells:social/posts/${viewerEntityHash}/${body.event.id}/edit?fount-apikey=${encodeURIComponent(apiKey)}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: 'edited via http' }),
			},
		)
		const editRaw = await editRes.text()
		assertEquals(editRes.status, 200, editRaw)
		assertEquals(JSON.parse(editRaw).event?.type, 'post_edit')
	}
	finally {
		await stopNode(node)
	}
})
