/**
 * 浏览器 shell 从 /scripts/p2p/* 动态 import 的静态资源门控（避免 frontend 全量重复 404）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { launchNode, pickAvailablePort, stopNode } from '../../../scripts/test/node/launch.mjs'

/** @type {string[]} */
const BROWSER_P2P_SCRIPTS = [
	'/scripts/p2p/hexIds.mjs',
	'/scripts/p2p/entity_id_parse.mjs',
]

Deno.test({
	name: 'browser p2p static scripts are served',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const port = await pickAvailablePort(28931)
	const node = await launchNode({
		port,
		username: 'static-scripts-user',
		apiKey: `fount-static-scripts-${Date.now().toString(36)}`,
	})
	const { baseUrl } = node
	try {
		for (const path of BROWSER_P2P_SCRIPTS) {
			const res = await fetch(`${baseUrl}${path}`)
			assertEquals(res.status, 200, path)
			const body = await res.text()
			assertEquals(body.includes('export'), true, `${path} should be an ES module`)
		}
	}
	finally {
		await stopNode(node)
	}
})
