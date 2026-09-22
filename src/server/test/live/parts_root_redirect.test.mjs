/**
 * 根部件（part key 为空）：
 * - /parts 与 /parts/ 规范化到 /parts//；
 * - /parts// 提供根部件的 public/index.html，其内容跳转到站点根目录 /。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

Deno.test({
	name: 'root part: /parts canonicalizes to /parts// serving its public/index.html',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'parts-root-redirect-user',
		apiKey: `fount-parts-root-${Date.now().toString(36)}`,
	})
	const { baseUrl } = node
	const auth = `?fount-apikey=${encodeURIComponent(node.apiKey)}`
	try {
		for (const path of ['/parts', '/parts/']) {
			const res = await fetch(`${baseUrl}${path}${auth}`, { redirect: 'manual' })
			assertEquals(res.status, 301, path)
			assertEquals(res.headers.get('location'), '/parts//', path)
		}

		const res = await fetch(`${baseUrl}/parts//${auth}`, { redirect: 'manual' })
		assertEquals(res.status, 200, '/parts//')
		const html = await res.text()
		assertStringIncludes(html, 'url=/', 'root part index should redirect to site root')
	}
	finally {
		await stopNode(node)
	}
})
