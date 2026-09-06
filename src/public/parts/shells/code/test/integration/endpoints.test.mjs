/* global Deno */
/**
 * code shell HTTP 端点集成测试：机器/浏览/工作区/会话/命令/文件/执行/AI 源。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

import { parseVolumeLabels } from '../../../../plugins/file-operations/src/target.mjs'

import { codeFetch } from './helpers/code_http.mjs'

/**
 * 启动仅加载 code shell 的测试节点。
 * @param {object} [options] 透传给 launchNode 的额外选项（如 extraEnv）。
 * @returns {Promise<object>} 测试节点。
 */
async function launchCodeNode(options = {}) {
	return await launchNode({
		username: 'code-http-user',
		apiKey: `fount-code-http-${Date.now().toString(36)}`,
		loadParts: ['shells/code'],
		p2p: false,
		minP2pNode: true,
		...options,
	})
}

/**
 * 构造 VS Code workspace.json 的真实 file:// 文件夹 URL：
 * Windows 盘符以 %3A 编码（VS Code 真实格式），Unix 保持绝对路径。
 * @param {string} p 绝对路径
 * @returns {string} file:// URL
 */
function toVsCodeFileUrl(p) {
	const normalized = p.replace(/\\/g, '/')
	const drive = /^([A-Za-z]):/.exec(normalized)
	return `file:///${drive ? drive[1] + '%3A' + normalized.slice(2) : normalized}`
}

/**
 * 创建模拟的编辑器数据目录（Cursor 风格 workspaceStorage）并返回项目根。
 * @param {string} root - APPDATA/XDG_CONFIG_HOME 假根目录。
 * @returns {Promise<string>} 模拟的编辑器常用项目路径（真实存在）。
 */
async function makeFakeEditorSource(root) {
	const project = path.join(root, 'cursor-proj')
	await fs.mkdir(project, { recursive: true })
	await fs.mkdir(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash1'), { recursive: true })
	await fs.writeFile(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash1', 'workspace.json'), JSON.stringify({ folder: toVsCodeFileUrl(project) }), 'utf8')
	return project
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

Deno.test('parseVolumeLabels parses Win32_LogicalDisk JSON output', () => {
	assertEquals(parseVolumeLabels('[{"DeviceID":"C:","VolumeName":"Windows"},{"DeviceID":"D:","VolumeName":null}]'), { 'C:\\': 'Windows', 'D:\\': '' })
	// 单条时 pwsh 输出对象而非数组
	assertEquals(parseVolumeLabels('{"DeviceID":"E:","VolumeName":"Data"}'), { 'E:\\': 'Data' })
	// 非盘符条目被跳过；非法/空输出返回空映射
	assertEquals(parseVolumeLabels('[{"DeviceID":"x1","VolumeName":"bad"}]'), {})
	assertEquals(parseVolumeLabels(''), {})
	assertEquals(parseVolumeLabels('garbage'), {})
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
		for (const entry of roots.entries) {
			assertEquals(entry.isDirectory, true)
			assert(entry.name.startsWith(entry.path), `根条目名以路径开头（有卷标时附卷标）：${entry.name}`)
		}
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
	name: 'browse attaches volume labels on local win32',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	if (process.platform !== 'win32') return
	const { available, pwsh_exec } = await import('npm:@steve02081504/exec')
	if (!await available.pwsh) return
	const result = await pwsh_exec('@(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName) | ConvertTo-Json -Compress', { no_ansi_terminal_sequences: true })
	const labeled = Object.entries(parseVolumeLabels(result?.stdout ?? result?.stdall ?? '')).filter(([, label]) => label)
	if (!labeled.length) return
	const node = await launchCodeNode()
	try {
		const roots = await (await codeFetch(node, 'GET', '/machines/0/browse')).json()
		for (const [drive, label] of labeled)
			assert(roots.entries.some(e => e.path === drive && e.name === `${drive} ${label}`), `根条目 ${drive} 应附卷标「${label}」：${JSON.stringify(roots.entries)}`)
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'browse returns quick access on root view',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_http_qa_'))
		try {
			await fs.mkdir(path.join(root, 'ws-a', '.git'), { recursive: true })
			await fs.mkdir(path.join(root, 'ws-a', 'proj', '.git'), { recursive: true })
			await fs.mkdir(path.join(root, 'sibling-b'), { recursive: true })
			assertEquals((await codeFetch(node, 'POST', '/workspaces', { name: 'qa', machine: '0', path: path.join(root, 'ws-a') })).status, 200)
			const body = await (await codeFetch(node, 'GET', `/machines/0/browse?workspace=${encodeURIComponent(path.join(root, 'ws-a'))}`)).json()
			const names = body.quickAccess.map(item => item.name)
			assert(names.includes('sibling-b'), `兄弟目录应在快速访问中：${JSON.stringify(names)}`)
			assert(names.includes('proj'), `工作区下含 .git 的子目录应在快速访问中：${JSON.stringify(names)}`)
			assert(!names.includes('ws-a'), '工作区自身不应出现在快速访问中')
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
	name: 'quick access empty without workspace',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_http_qa_empty_'))
	try {
		const node = await launchCodeNode({ extraEnv: { [os.platform() === 'win32' ? 'APPDATA' : 'XDG_CONFIG_HOME']: root } })
		try {
			const body = await (await codeFetch(node, 'GET', '/machines/0/browse?workspace=')).json()
			assertEquals(body.quickAccess, [])
		}
		finally {
			await stopNode(node)
		}
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test({
	name: 'quick access lists editor-sourced projects even without an active workspace',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_http_qa_es_'))
	try {
		await makeFakeEditorSource(root)
		// 无活动工作区：编辑器常用项目（VS Code/Cursor 最近打开）仍应作为推荐出现
		const node = await launchCodeNode({ extraEnv: { [os.platform() === 'win32' ? 'APPDATA' : 'XDG_CONFIG_HOME']: root } })
		try {
			const body = await (await codeFetch(node, 'GET', '/machines/0/browse?workspace=')).json()
			const names = body.quickAccess.map(item => item.name)
			assert(names.includes('cursor-proj'), `无活动工作区时编辑器常用项目应作为快速访问：${JSON.stringify(names)}`)
			for (const item of body.quickAccess)
				assertEquals(item.isDirectory, true)
		}
		finally {
			await stopNode(node)
		}
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test({
	name: 'quick access excludes already-saved workspaces (realpath dedup)',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_http_qa2_'))
		try {
			await fs.mkdir(path.join(root, 'ws-a', '.git'), { recursive: true })
			await fs.mkdir(path.join(root, 'sibling-b'), { recursive: true })
			// 两个 workspace：当前 ws-a + 已保存的 sibling-b
			assertEquals((await codeFetch(node, 'POST', '/workspaces', { name: 'qa', machine: '0', path: path.join(root, 'ws-a') })).status, 200)
			assertEquals((await codeFetch(node, 'POST', '/workspaces', { name: 'sib', machine: '0', path: path.join(root, 'sibling-b') })).status, 200)
			const body = await (await codeFetch(node, 'GET', `/machines/0/browse?workspace=${encodeURIComponent(path.join(root, 'ws-a'))}`)).json()
			const names = body.quickAccess.map(item => item.name)
			// sibling-b 已是已保存工作区，不应再作为快速访问备选出现
			assert(!names.includes('sibling-b'), `已保存工作区应被排除：${JSON.stringify(names)}`)
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

Deno.test({
	name: 'tabs list and draft content roundtrip via backend shell data',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		// 空列表回读
		const empty = await (await codeFetch(node, 'GET', '/tabs')).json()
		assertEquals(empty.tabs, [])
		assertEquals(empty.activeTab, '')
		// 写入草稿与会话标签（含未发送草稿内容）
		const payload = {
			tabs: [
				{ type: 'draft', id: 'draft01', workspaceId: 'ws1', draft: '未发送的内容' },
				{ type: 'session', id: 'sess01AB', workspaceId: 'ws1' },
			],
			activeTab: 't:ws1:draft01',
		}
		const saved = await (await codeFetch(node, 'PUT', '/tabs', payload)).json()
		assertEquals(saved.tabs.length, 2)
		assertEquals(saved.tabs[0].draft, '未发送的内容')
		assertEquals(saved.activeTab, 't:ws1:draft01')
		// 非法 id / type 被过滤
		const sanitized = await (await codeFetch(node, 'PUT', '/tabs', {
			tabs: [
				{ type: 'bogus', id: 'x', workspaceId: 'ws1' },
				{ type: 'draft', id: 'bad/../path', workspaceId: 'ws1' },
				{ type: 'session', id: 'ok01', workspaceId: 'ws1' },
			],
			activeTab: 't:ws1:ok01',
		})).json()
		assertEquals(sanitized.tabs.length, 1)
		assertEquals(sanitized.tabs[0].id, 'ok01')
		// 回读一致
		const got = await (await codeFetch(node, 'GET', '/tabs')).json()
		assertEquals(got.tabs.length, 1)
		assertEquals(got.tabs[0].id, 'ok01')
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'exec without workdir runs in the user home directory',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	try {
		// Windows pwsh 下 `pwd` 的表格输出会被 $OutputEncoding 前缀吞掉，改用字符串输出
		const cmd = os.platform() === 'win32' ? 'Write-Output $PWD.Path' : 'pwd'
		const result = await (await codeFetch(node, 'POST', '/exec', { machine: '0', command: cmd })).json()
		const out = String(result.stdout ?? '').trim().toLowerCase()
		const home = os.homedir().toLowerCase()
		assert(out.includes(home), `无工作区时应在家目录执行，输出：${out}`)
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'history roundtrip, workspace-config and sessions/all',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchCodeNode()
	const root = await makeWorkspace(node)
	try {
		// 自有历史追加 + 读取（含原生 shell 历史字段）
		const appended = await (await codeFetch(node, 'POST', '/history', { machine: '0', workdir: root, kind: 'shell', command: 'git status' })).json()
		assert(appended.own.includes('git status'))
		const got = await (await codeFetch(node, 'GET', `/history?machine=0&workdir=${encodeURIComponent(root)}&kind=shell&shell=pwsh`)).json()
		assert(got.own.includes('git status'))
		assert(Array.isArray(got.native))
		// message 类型历史
		await codeFetch(node, 'POST', '/history', { machine: '0', workdir: root, kind: 'message', command: '你好' })
		const msg = await (await codeFetch(node, 'GET', `/history?machine=0&workdir=${encodeURIComponent(root)}&kind=message`)).json()
		assert(msg.own.includes('你好'))
		// 非法 kind 报 400
		assertEquals((await codeFetch(node, 'GET', `/history?machine=0&workdir=${encodeURIComponent(root)}&kind=bogus`)).status, 400)
		// 无配置 → {}
		const cfg = await (await codeFetch(node, 'GET', `/workspace-config?machine=0&workdir=${encodeURIComponent(root)}`)).json()
		assertEquals(cfg, {})
		// 写入 .agents/fount/code.json 后读回
		await fs.mkdir(path.join(root, '.agents', 'fount'), { recursive: true })
		await fs.writeFile(path.join(root, '.agents', 'fount', 'code.json'), JSON.stringify({ char: { partname: 'x', install_url: 'y' } }), 'utf8')
		const cfg2 = await (await codeFetch(node, 'GET', `/workspace-config?machine=0&workdir=${encodeURIComponent(root)}`)).json()
		assertEquals(cfg2.char.partname, 'x')
		assertEquals(cfg2.char.install_url, 'y')
		// 跨工作区会话聚合
		const session = {
			id: 'agg001',
			title: 'agg',
			charname: 'c',
			profile: 'build',
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
			memory: {},
			entries: [],
		}
		await codeFetch(node, 'POST', '/sessions', { machine: '0', workdir: root, session })
		const all = await (await codeFetch(node, 'GET', '/sessions/all')).json()
		const found = all.sessions.find(s => s.id === 'agg001')
		assert(found, '聚合会话含新建会话')
		assert(found.workspaceId, '聚合会话携带 workspaceId')
		assert(found.workspaceName, '聚合会话携带 workspaceName')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
		await stopNode(node)
	}
})
