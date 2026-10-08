/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

import { codeFetch } from './helpers/code_http.mjs'

Deno.test({
	name: 'workspace attachment reads binary bytes and rejects escape and oversize paths',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_attachment_'))
	let node
	try {
		await fs.writeFile(path.join(root, 'picture.png'), Buffer.from([0, 1, 2, 255]))
		const oversized = path.join(root, 'oversized.bin')
		await fs.writeFile(oversized, '')
		await fs.truncate(oversized, 10 * 1024 * 1024 + 1)
		node = await launchNode({
			username: 'code-attachment-user', apiKey: `fount-code-attachment-${Date.now().toString(36)}`,
			loadParts: ['shells/code'], p2p: false, minP2pNode: true,
		})
		const url = file => `/workspace/attachment?${new URLSearchParams({ machine: '0', workdir: root, path: file })}`
		const binary = await codeFetch(node, 'GET', url('picture.png'))
		assertEquals(binary.status, 200)
		assertEquals(await binary.json(), { name: 'picture.png', mime_type: 'image/png', buffer: 'AAEC/w==' })
		assertEquals((await codeFetch(node, 'GET', url('../outside'))).status, 400)
		assertEquals((await codeFetch(node, 'GET', url('oversized.bin'))).status, 413)
	}
	finally {
		if (node) await stopNode(node)
		await fs.rm(root, { recursive: true, force: true })
	}
})
