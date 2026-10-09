/* global Deno */
/**
 * 文件操作 · glob/grep 搜索（tgrep 索引 / ripgrep WASM）单元测试。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { assert, assertEquals } from 'jsr:@std/assert'

import { runReplyHandlers } from '../../../../shells/chat/src/reply/handlerPipeline.mjs'
import { tgrepIndexPath } from '../../../../shells/code/src/search_index.mjs'
import { fileOperationsReplyHandlers } from '../../handler.mjs'
import { runRipgrep } from '../../src/search.mjs'
import { createTargetExecutor } from '../../src/target.mjs'

/**
 * 通过回复管线运行文件操作 handler。
 * @param {string} content 原始生成
 * @param {object} args 请求上下文
 * @returns {Promise<boolean>} 是否建议重新生成
 */
async function runFileOps(content, args) {
	return runReplyHandlers({ content, extension: {} }, args, fileOperationsReplyHandlers)
}

/**
 * 在临时工作区写入搜索用的测试文件。
 * @param {string} root - 工作区根。
 * @returns {Promise<void>}
 */
async function seedWorkspace(root) {
	await fs.mkdir(path.join(root, 'sub'), { recursive: true })
	await fs.writeFile(path.join(root, 'a.mjs'), 'hello world\nconst x = () => 1\nTODO fix\n')
	await fs.writeFile(path.join(root, 'b.txt'), 'nothing here\nTODO too\n')
	await fs.writeFile(path.join(root, 'sub', 'c.mjs'), 'deep hello\n')
}

/**
 * 创建临时目录。
 * @returns {Promise<string>} 目录路径。
 */
async function tempDir() {
	return await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_search_'))
}

/**
 * 构造 handler 调用参数，收集回写日志。
 * @param {string} root - 工作区根。
 * @returns {{logs: object[], args: object}} 日志数组与参数。
 */
function createHandlerArgs(root) {
	const logs = []
	/**
	 * 收集工具回写日志。
	 * @param {object} entry - 日志条目。
	 * @returns {void}
	 */
	const addLog = entry => { logs.push(entry) }
	return {
		logs,
		args: {
			Charname: 'TestChar',
			username: 'test-user',
			workdir: { machine: '0', path: root },
			chat_scoped_char_memory: {},
			AddLongTimeLog: addLog,
		},
	}
}

Deno.test('local executor resolvePath resolves against workdir', async () => {
	const root = await tempDir()
	try {
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		assertEquals(await executor.resolvePath('sub/c.mjs'), path.join(root, 'sub', 'c.mjs'))
		assertEquals(await executor.resolvePath(''), path.resolve(root))
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob lists matching files relative to root', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		const result = await executor.execJs(runRipgrep, { mode: 'glob', root, patterns: ['**/*.mjs'], limit: 10 })
		assertEquals(result.ok, true)
		assertEquals(result.files, ['a.mjs', 'sub/c.mjs'])
		assertEquals(result.total, 2)
		assertEquals(result.truncated, false)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob matches relative paths, unions patterns, and lists first-level directories', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		await fs.mkdir(path.join(root, 'chat'))
		await fs.mkdir(path.join(root, 'social'))
		await fs.mkdir(path.join(root, 'empty'))
		await fs.mkdir(path.join(root, 'sub', 'nested'))
		await fs.mkdir(path.join(root, 'ignored'))
		await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\n')
		await fs.writeFile(path.join(root, 'ignored', 'main.mjs'), '')
		await fs.writeFile(path.join(root, 'chat', 'main.mjs'), '')
		await fs.writeFile(path.join(root, 'social', 'main.mjs'), '')
		await fs.writeFile(path.join(root, 'main.mjs'), '')
		for (const pattern of ['*/main.mjs', '{chat,social}/main.mjs']) {
			const result = await runRipgrep({ mode: 'glob', root, patterns: [pattern], limit: 20 })
			assertEquals(result.files, ['chat/main.mjs', 'social/main.mjs'], pattern)
		}
		const literal = await runRipgrep({ mode: 'glob', root, patterns: ['chat/main.mjs', 'social/main.mjs'], limit: 20 })
		assertEquals(literal.files, ['chat/main.mjs', 'social/main.mjs'])
		const basename = await runRipgrep({ mode: 'glob', root, patterns: ['main.mjs'], limit: 20 })
		assertEquals(basename.files, ['chat/main.mjs', 'main.mjs', 'social/main.mjs'])
		const union = await runRipgrep({ mode: 'glob', root, patterns: ['*/main.mjs', '*/fount.json'], limit: 20 })
		assertEquals(union.files, ['chat/main.mjs', 'social/main.mjs'])
		const dirs = await runRipgrep({ mode: 'glob', root, patterns: ['*/'], limit: 20 })
		assertEquals(dirs.files, ['chat/', 'empty/', 'social/', 'sub/'])
		const deep = await runRipgrep({ mode: 'glob', root, patterns: ['**/'], limit: 20 })
		assertEquals(deep.files, ['chat/', 'empty/', 'social/', 'sub/', 'sub/nested/'])
		const nested = await runRipgrep({ mode: 'glob', root, patterns: ['sub/*/'], limit: 20 })
		assertEquals(nested.files, ['sub/nested/'])
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob reports per-pattern hit counts for multi-pattern searches', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'glob', root, patterns: ['**/*.mjs', 'nope/*.mjs'], limit: 20 })
		assertEquals(result.ok, true)
		assertEquals(result.patterns, [
			{ pattern: '**/*.mjs', count: 2 },
			{ pattern: 'nope/*.mjs', count: 0 },
		])
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob keeps a single pattern free of per-pattern stats', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'glob', root, patterns: ['**/*.mjs'], limit: 20 })
		assertEquals(result.patterns, undefined)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('file-operations handler warns on glob patterns with zero hits', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const run = createHandlerArgs(root)
		assertEquals(await runFileOps('<glob path=".">**/*.mjs\nnope/*.mjs</glob>', run.args), true)
		const content = run.logs.map(entry => entry.content).join('\n')
		assert(content.includes('0 命中'), `glob output should warn zero-hit patterns: ${content}`)
		assert(content.includes('nope/*.mjs'), `glob warning should name the pattern: ${content}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob truncates at limit', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'glob', root, patterns: ['**/*'], limit: 1 })
		assertEquals(result.ok, true)
		assertEquals(result.files.length, 1)
		assertEquals(result.total, 3)
		assertEquals(result.truncated, true)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep grep returns matches with line numbers and honors include', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: 'hello', includes: ['*.mjs'], limit: 10 })
		assertEquals(result.ok, true)
		assertEquals(result.matches, [
			{ path: 'a.mjs', line: 1, text: 'hello world' },
			{ path: 'sub/c.mjs', line: 1, text: 'deep hello' },
		])
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep grep filesOnly lists matching files', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: 'hello', filesOnly: true, limit: 10 })
		assertEquals(result.ok, true)
		assertEquals(result.files, ['a.mjs', 'sub/c.mjs'])
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep reports invalid regex as an error result', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: '(unclosed', limit: 10 })
		assertEquals(result.ok, false)
		assert(result.error.includes('regex'), `error should mention regex: ${result.error}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('file-operations 只读 handler 声明可并行，写操作保持屏障', () => {
	for (const name of ['list-machines', 'view-file', 'glob', 'grep'])
		assertEquals(fileOperationsReplyHandlers.find(candidate => candidate.name === name)?.parallel, true, `${name} 应声明可并行`)
	for (const name of ['set-workdir', 'replace-file', 'override-file'])
		assertEquals(fileOperationsReplyHandlers.find(candidate => candidate.name === name)?.parallel, undefined, `${name} 不应并行`)
})

Deno.test('file-operations handler executes <glob> and <grep> tags', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)

		const globRun = createHandlerArgs(root)
		assertEquals(await runFileOps('<glob path=".">**/*.mjs</glob>', globRun.args), true)
		const globContent = globRun.logs.map(entry => entry.content).join('\n')
		assert(globContent.includes('a.mjs') && globContent.includes('sub/c.mjs'), `glob output: ${globContent}`)
		const mixedRun = createHandlerArgs(root)
		assertEquals(await runFileOps('<glob path=".">*/\nsub/c.mjs</glob>', mixedRun.args), true)
		assert(mixedRun.logs[0].content.includes('sub/\nsub/c.mjs'), `glob multi-line output: ${mixedRun.logs[0].content}`)

		const grepRun = createHandlerArgs(root)
		assertEquals(await runFileOps('<grep include="*.mjs">hello</grep>', grepRun.args), true)
		const grepContent = grepRun.logs.map(entry => entry.content).join('\n')
		assert(grepContent.includes('a.mjs:') && grepContent.includes('1: hello world'), `grep output: ${grepContent}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('file-operations handler gives grep/glob tool entries a human content_for_show layer', async () => {
	const root = await tempDir()
	try {
		await seedWorkspace(root)

		const globRun = createHandlerArgs(root)
		await runFileOps('<glob path=".">**/*.mjs</glob>', globRun.args)
		const globEntry = globRun.logs.find(entry => entry.role === 'tool' && entry.name === 'file-operations.glob')
		assert(globEntry, 'glob tool entry should exist')
		assert(globEntry.content_for_show, 'glob tool entry should have content_for_show')
		assert(globEntry.content_for_show !== globEntry.content, 'show layer should differ from agent layer')
		assert(globEntry.content_for_show.includes('**/*.mjs'), `glob show layer should keep the executed pattern: ${globEntry.content_for_show}`)
		assert(globEntry.content_for_show.includes('a.mjs'), `glob show layer should keep the result: ${globEntry.content_for_show}`)

		const grepRun = createHandlerArgs(root)
		await runFileOps('<grep include="*.mjs">hello</grep>', grepRun.args)
		const grepEntry = grepRun.logs.find(entry => entry.role === 'tool' && entry.name === 'file-operations.grep')
		assert(grepEntry, 'grep tool entry should exist')
		assert(grepEntry.content_for_show, 'grep tool entry should have content_for_show')
		assert(grepEntry.content_for_show !== grepEntry.content, 'show layer should differ from agent layer')
		assert(grepEntry.content_for_show.includes('hello'), `grep show layer should keep the pattern: ${grepEntry.content_for_show}`)
		assert(grepEntry.content_for_show.includes('a.mjs:'), `grep show layer should keep the result: ${grepEntry.content_for_show}`)

		// handler 不再以 char 角色重放调用：只追加工具结果日志（原始生成入日志由管线负责）
		assert(!grepRun.logs.some(entry => entry.role === 'char'), 'handler should only append tool result logs')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

/**
 * 替换 `Deno.Command`，记录每次尝试的命令并让它们全部「不存在」。
 * @returns {{calls: Array<{name: string, args: string[]}>, restore: () => void}} 调用记录与还原函数
 */
function recordMissingCommands() {
	const realCommand = Deno.Command
	const calls = []
	/**
	 * 只记录调用的 Command 替身。
	 */
	class RecordingCommand {
		/**
		 * @param {string} name 命令名或路径
		 * @param {{args: string[]}} options 命令选项
		 */
		constructor(name, options) {
			calls.push({ name, args: options.args })
		}
		/**
		 * @returns {Promise<never>} 与真实缺席命令一致地拒绝
		 */
		output() {
			return Promise.reject(new Deno.errors.NotFound('probe'))
		}
	}
	Deno.Command = RecordingCommand
	/**
	 * 还原真实的 `Deno.Command`。
	 * @returns {void}
	 */
	const restore = () => { Deno.Command = realCommand }
	return { calls, restore }
}

Deno.test('runRipgrep 用 code shell 的索引目录搜索工作区，无 tgrep 时退回 rg', async () => {
	const root = await tempDir()
	const { calls, restore } = recordMissingCommands()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: 'hello', indexRoot: root, limit: 10 })
		assertEquals(result.matches.length, 2)
		assertEquals(calls.map(call => call.name), [
			'tgrep',
			path.join(os.tmpdir(), 'fount', 'bin', process.platform === 'win32' ? 'tgrep.exe' : 'tgrep'),
			'rg',
		])
		const indexArgs = ['--index-path', tgrepIndexPath(root), '--no-require-git']
		assertEquals(calls[0].args.slice(0, 3), indexArgs)
		assertEquals(calls[1].args.slice(0, 3), indexArgs)
		assertEquals(calls[2].args.slice(0, 3), ['--json', '-e', 'hello'])
	}
	finally {
		restore()
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep 非 Git 目录不给 indexRoot 时只用 rg', async () => {
	const root = await tempDir()
	const { calls, restore } = recordMissingCommands()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'grep', root, pattern: 'hello', limit: 10 })
		assertEquals(result.matches.length, 2)
		assertEquals(calls.map(call => call.name), ['rg'])
	}
	finally {
		restore()
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep 从文件目标向上发现 Git 索引，序列化执行仍可搜索', async () => {
	const root = await tempDir()
	const index = tgrepIndexPath(root)
	const previousTest = process.env.FOUNT_TEST
	process.env.FOUNT_TEST = '1'
	const { calls, restore } = recordMissingCommands()
	try {
		await seedWorkspace(root)
		await fs.mkdir(path.join(root, '.git'))
		await fs.writeFile(path.join(root, '.git', 'config'), '')
		await fs.mkdir(index, { recursive: true })
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		const result = await executor.execJs(runRipgrep, { mode: 'grep', root: path.join(root, 'sub', 'c.mjs'), pattern: 'hello' })
		assertEquals(result.total, 1)
		assertEquals(calls.map(call => call.name), ['rg', 'tgrep', path.join(os.tmpdir(), 'fount', 'bin', process.platform === 'win32' ? 'tgrep.exe' : 'tgrep')])
		assertEquals(calls[1].args.slice(0, 3), ['--index-path', index, '--no-require-git'])
	}
	finally {
		restore()
		if (previousTest === undefined) delete process.env.FOUNT_TEST
		else process.env.FOUNT_TEST = previousTest
		await fs.rm(index, { recursive: true, force: true })
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep 远端机器不给 indexRoot 时不发现索引', async () => {
	const root = await tempDir()
	const index = tgrepIndexPath(root)
	const { calls, restore } = recordMissingCommands()
	try {
		await seedWorkspace(root)
		await fs.mkdir(path.join(root, '.git'))
		await fs.writeFile(path.join(root, '.git', 'config'), '')
		await fs.mkdir(index, { recursive: true })
		const result = await runRipgrep({ mode: 'grep', root, pattern: 'hello', machine: '1', limit: 10 })
		assertEquals(result.matches.length, 2)
		// 索引服务只有本机起得来：远端连模块都取不到，只跑 rg。
		assertEquals(calls.map(call => call.name), ['rg'])
	}
	finally {
		restore()
		await fs.rm(index, { recursive: true, force: true })
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('runRipgrep glob 模式不把 --no-require-git 重复传给 tgrep', async () => {
	const root = await tempDir()
	const { calls, restore } = recordMissingCommands()
	try {
		await seedWorkspace(root)
		const result = await runRipgrep({ mode: 'glob', root, patterns: ['**/*.mjs'], indexRoot: root, limit: 10 })
		assertEquals(result.files, ['a.mjs', 'sub/c.mjs'])
		// tgrep 把重复的全局开关当参数冲突报错（exit 2），去重后索引搜索才真的可用。
		for (const call of calls)
			assertEquals(call.args.filter(arg => arg === '--no-require-git').length, 1)
	}
	finally {
		restore()
		await fs.rm(root, { recursive: true, force: true })
	}
})
