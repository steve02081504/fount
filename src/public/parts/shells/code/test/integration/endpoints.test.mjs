/* global Deno */
/**
 * code shell HTTP 端点集成测试：机器/浏览/工作区/会话/命令/文件/执行/AI 源。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

import { codeFetch } from './helpers/code_http.mjs'

/**
 * 启动仅加载 code shell 的测试节点。
 * @returns {Promise<object>} 测试节点。
 */
async function launchCodeNode() {
	return await launchNode({
		username: 'code-http-user',
		apiKey: `fount-code-http-${Date.now().toString(36)}`,
		loadParts: ['shells/code'],
		p2p: false,
		minP2pNode: true,
	})
}

/**
 * 创建临时工作区并保存到节点。
 * @param {object} node 测试节点
 * @returns {Promise<string>} 工作区路径。
 */
async function makeWorkspace(node) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_http_ws_'))
	await fs.mkdir(path.join(root, '.agents', 'commands'), { recursive: true })
	await fs.writeFile(path.join(root, '.agents', 'commands', 'upper.md'), '---\ndescription: 大写\nparams:\n  text:\n    required: true\n---\n${argv.text.toUpperCase()}', 'utf8')
	await fs.writeFile(path.join(root, 'AGENTS.md'), '# 工作区规则', 'utf8')
	const res = await codeFetch(node, 'POST', '/workspaces', { name: 'ws1', machine: '0', path: root })
	assertEquals(res.status, 200)
	return root
}

Deno.test({
	name: 'machines lists localhost as id 0',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		const res = await codeFetch(node, 'GET', '/machines')
		const body = await res.json()
		const local = body.machines.find(m => m.id === '0')
		assert(local, '本机在列表中')
		assertEquals(local.isConnected, true)
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'workspaces CRUD roundtrip',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		const root = await makeWorkspace(node)
		const list = await (await codeFetch(node, 'GET', '/workspaces')).json()
		const workspace = list.list.find(w => w.path === root)
		assert(workspace, '已保存')
		const updated = await (await codeFetch(node, 'PUT', `/workspaces/${workspace.id}`, { name: 'renamed' })).json()
		assertEquals(updated.list.find(w => w.id === workspace.id).name, 'renamed')
		const afterDelete = await (await codeFetch(node, 'DELETE', `/workspaces/${workspace.id}`)).json()
		assertEquals(afterDelete.list.find(w => w.id === workspace.id), undefined)
		await fs.rm(root, { recursive: true, force: true })
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'browse lists roots then directories',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		const roots = await (await codeFetch(node, 'GET', '/machines/0/browse')).json()
		assert(roots.entries.length > 0)
		const root = await makeWorkspace(node)
		try {
			const entries = await (await codeFetch(node, 'GET', `/machines/0/browse?path=${encodeURIComponent(root)}`)).json()
			assert(entries.entries.some(e => e.isDirectory && e.name === '.agents'))
		}
		finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'profiles and commands render with argv and js',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	const root = await makeWorkspace(node)
	try {
		const query = `machine=0&workdir=${encodeURIComponent(root)}`
		const profiles = await (await codeFetch(node, 'GET', `/profiles?${query}`)).json()
		assert(profiles.profiles.some(p => p.name === 'plan' && p.source === 'builtin'))
		assert(profiles.commands.some(c => c.name === 'upper'))
		const rendered = await (await codeFetch(node, 'POST', '/commands/render', { machine: '0', workdir: root, name: 'upper', argv: { text: 'abc' } })).json()
		assertEquals(rendered.content, 'ABC')
		const missing = await codeFetch(node, 'POST', '/commands/render', { machine: '0', workdir: root, name: 'upper', argv: {} })
		assertEquals(missing.status, 400, '缺必填参数应报错')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
		await stopNode(node)
	}
})

Deno.test({
	name: 'file search and read with upward context',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	const root = await makeWorkspace(node)
	try {
		await fs.writeFile(path.join(root, 'hello.txt'), '内容', 'utf8')
		const query = `machine=0&workdir=${encodeURIComponent(root)}&q=hello`
		const search = await (await codeFetch(node, 'GET', `/files/search?${query}`)).json()
		assert(search.files.some(f => f.endsWith('hello.txt')))
		const read = await (await codeFetch(node, 'GET', `/file?machine=0&workdir=${encodeURIComponent(root)}&path=${encodeURIComponent('hello.txt')}`)).json()
		assertEquals(read.content, '内容')
		assert(read.context.includes('AGENTS.md'))
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
		await stopNode(node)
	}
})

Deno.test({
	name: 'exec runs command in workdir and sessions roundtrip',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	const root = await makeWorkspace(node)
	try {
		const result = await (await codeFetch(node, 'POST', '/exec', { machine: '0', workdir: root, command: 'echo ok' })).json()
		assert(String(result.stdall ?? result.stdout ?? '').includes('ok'), `输出包含 ok：${JSON.stringify(result)}`)
		const session = {
			id: 'sess01AB',
			title: 't',
			charname: 'c',
			profile: 'build',
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
			memory: {},
			entries: [],
		}
		assertEquals((await codeFetch(node, 'POST', '/sessions', { machine: '0', workdir: root, session })).status, 200)
		const loaded = await (await codeFetch(node, 'GET', `/sessions/sess01AB?machine=0&workdir=${encodeURIComponent(root)}`)).json()
		assertEquals(loaded.id, 'sess01AB')
		assertEquals((await (await codeFetch(node, 'GET', `/sessions?machine=0&workdir=${encodeURIComponent(root)}`)).json()).sessions.length, 1)
		assertEquals((await codeFetch(node, 'DELETE', `/sessions/sess01AB?machine=0&workdir=${encodeURIComponent(root)}`)).status, 200)
		const gone = await codeFetch(node, 'GET', `/sessions/sess01AB?machine=0&workdir=${encodeURIComponent(root)}`)
		assertEquals(gone.status, 404)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
		await stopNode(node)
	}
})

Deno.test({
	name: 'aisources list and visibility save',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		const sources = await (await codeFetch(node, 'GET', '/aisources')).json()
		assert(Array.isArray(sources.sources))
		const saved = await (await codeFetch(node, 'PUT', '/aisources/visibility', { hidden: ['x'] })).json()
		assertEquals(saved.hidden, ['x'])
		const again = await (await codeFetch(node, 'GET', '/aisources')).json()
		assertEquals(again.hidden, ['x'])
	}
	finally {
		await stopNode(node)
	}
})
