/**
 * HTTP /taste 路由（launchNode 覆盖 client.username 回归）。
 */
/* global Deno */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const bootstrapPath = join(dirname(fileURLToPath(import.meta.url)), '../node_bootstrap.mjs')

Deno.test({
	name: 'GET/PUT /taste persist privacy and manual weights',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const apiKey = `fount-social-taste-http-${Date.now().toString(36)}`
	const node = await launchNode({
		username: 'social-taste-http-user',
		apiKey,
		loadParts: ['shells/social'],
		bootstrap: bootstrapPath,
		p2p: false,
		minP2pNode: true,
	})
	const { baseUrl } = node
	const tasteUrl = `${baseUrl}/api/parts/shells:social/taste?fount-apikey=${encodeURIComponent(apiKey)}`
	try {
		const getRes = await fetch(tasteUrl)
		const getRaw = await getRes.text()
		assertEquals(getRes.status, 200, getRaw)
		const initial = JSON.parse(getRaw)
		assertEquals(initial.privacy?.publishPreferences, true)
		assertEquals(initial.privacy?.publishReactions, true)
		assert(Array.isArray(initial.tags))
		assertEquals(typeof initial.clusteredAt, 'number')

		const putRes = await fetch(tasteUrl, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				privacy: { publishPreferences: true, publishReactions: false },
				tags: { tag_cats: 2, tag_dogs: -1 },
			}),
		})
		const putRaw = await putRes.text()
		assertEquals(putRes.status, 200, putRaw)
		const updated = JSON.parse(putRaw)
		assertEquals(updated.privacy.publishReactions, false)
		assertEquals(updated.manual.tag_cats, 2)
		assertEquals(updated.manual.tag_dogs, -1)
		assertEquals(updated.tagCount, 2)

		const reloadRes = await fetch(tasteUrl)
		const reloadRaw = await reloadRes.text()
		assertEquals(reloadRes.status, 200, reloadRaw)
		const reloaded = JSON.parse(reloadRaw)
		assertEquals(reloaded.privacy.publishReactions, false)
		assertEquals(reloaded.tags.length, 2)

		const clearRes = await fetch(tasteUrl, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tags: { tag_dogs: 0 } }),
		})
		const clearRaw = await clearRes.text()
		assertEquals(clearRes.status, 200, clearRaw)
		const cleared = JSON.parse(clearRaw)
		assertEquals(cleared.manual.tag_dogs, undefined)
		assertEquals(cleared.tagCount, 1)

		const rebuildRes = await fetch(
			`${baseUrl}/api/parts/shells:social/taste/rebuild?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ method: 'POST' },
		)
		const rebuildRaw = await rebuildRes.text()
		assertEquals(rebuildRes.status, 200, rebuildRaw)
		const rebuilt = JSON.parse(rebuildRaw)
		assertEquals(typeof rebuilt.clusteredAt, 'number')
		assertEquals(typeof rebuilt.tagCount, 'number')
	}
	finally {
		await stopNode(node)
	}
})
