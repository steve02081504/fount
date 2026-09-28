/* global Deno */
/**
 * 聊天提及文件预读取 · 单元测试。
 * 预读经 `BeforeReply` 调用的 `preloadMentionedFiles(args)` 驱动，工具日志写入由假 `AddLongTimeLog` 收集。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { getFileOperationsPrompt } from '../../prompt.mjs'
import { mergeLineWindows, parseErrorLocations } from '../../src/error_windows.mjs'
import { collectMentionedFiles, extractPathCandidates } from '../../src/mentioned_files.mjs'
import { preloadMentionedFiles } from '../../src/preload.mjs'
import { formatLargeTextForContext } from '../../src/read_window.mjs'
import { createTargetExecutor } from '../../src/target.mjs'

/**
 * 构造一次生成请求上下文。
 * @param {string} root 工作区根。
 * @param {object[]} chat_log 聊天日志。
 * @returns {{args: object, logs: object[]}} 请求上下文与收集到的工具日志。
 */
function makeArgs(root, chat_log) {
	/** @type {object[]} */
	const logs = []
	return {
		logs,
		args: {
			username: 'u', Charname: 'Char', UserCharname: 'User', char_id: 'Char',
			workdir: { machine: '0', path: root },
			chat_log,
			/**
			 * 收集预读工具日志。
			 * @param {object} entry - 日志条目。
			 * @returns {void}
			 */
			AddLongTimeLog: entry => logs.push(entry),
		},
	}
}

/**
 * 取预读工具日志携带的 file-operations 私有数据。
 * @param {object} entry 日志条目。
 * @returns {object|undefined} 私有数据。
 */
function pluginData(entry) {
	return entry?.extension?.pluginData?.['file-operations']
}

/**
 * 创建临时目录。
 * @returns {Promise<string>} 目录路径。
 */
async function tempDir() {
	return await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_mention_'))
}

Deno.test('extractPathCandidates finds backticked and absolute paths', () => {
	const candidates = extractPathCandidates('看看 `src/a.txt` 与 C:\\proj\\b.md，还有 https://example.com/x')
	assert(candidates.includes('src/a.txt'), '应提取反引号相对路径')
	assert(candidates.includes('C:\\proj\\b.md'), '应提取 Windows 绝对路径')
})

Deno.test('collectMentionedFiles preloads existing relative files under workdir', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'note.txt'), 'hello\nworld', 'utf8')
		await fs.writeFile(path.join(root, 'other.md'), '# other', 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })

		const result = await collectMentionedFiles(executor, '请看看 `note.txt`，还有 `note.txt`', { maxFiles: 5 })
		assertEquals(result.textFiles.length, 1, '重复提及应去重')
		assertEquals(result.textFiles[0].path, 'note.txt')
		assert(result.textFiles[0].content.includes('hello'))
		assert(result.textFiles[0].resolved, '每个文本文件应带 realpath')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectMentionedFiles deduplicates equivalent absolute and relative paths, including directories', async () => {
	const root = await tempDir()
	try {
		await fs.mkdir(path.join(root, 'docs'))
		await fs.writeFile(path.join(root, 'docs', 'a.md'), 'only-once', 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		const text = `看 \`docs/a.md\` 和 \`${path.join(root, 'docs', 'a.md')}\`；目录 \`docs\` 和 \`${path.join(root, 'docs')}\``
		const result = await collectMentionedFiles(executor, text)
		assertEquals(result.textFiles.length, 1)
		assertEquals(result.dirs.length, 1)
		assert(result.dirs[0].resolved, '目录应带 realpath')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('preloadMentionedFiles preloads newest user message as a persistent tool log', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'old.md'), 'old-context', 'utf8')
		await fs.writeFile(path.join(root, 'new.md'), 'new-context', 'utf8')
		const run = makeArgs(root, [
			{ id: 'u1', role: 'user', content: '读 `old.md`' },
			{ role: 'char', content: '读 `old.md`' },
			{ id: 'u2', role: 'user', content: '读 `new.md`' },
		])
		await preloadMentionedFiles(run.args)

		assertEquals(run.logs.length, 1)
		assertEquals(run.logs[0].name, 'file-operations.preload')
		assertEquals(run.logs[0].role, 'tool')
		assertEquals(run.logs[0].charVisibility, ['Char'])
		assert(run.logs[0].content.includes('new-context'))
		assert(!run.logs[0].content.includes('old-context'))
		const data = pluginData(run.logs[0])
		assertEquals(data.preload.forUser, 'u2')
		assert(data.preload.files.some(item => item.path === 'new.md' && item.resolved))
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('preloadMentionedFiles is idempotent for the same user message', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'new.md'), 'new-context', 'utf8')
		const first = makeArgs(root, [{ id: 'u2', role: 'user', content: '读 `new.md`' }])
		await preloadMentionedFiles(first.args)
		assertEquals(first.logs.length, 1)

		// 重生成 / 异步触发：日志里已含该用户消息对应的预读条目，不再重复
		const second = makeArgs(root, [{ id: 'u2', role: 'user', content: '读 `new.md`' }, ...first.logs])
		await preloadMentionedFiles(second.args)
		assertEquals(second.logs, [], '同一用户消息不应重复预读')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('preloadMentionedFiles skips a mentioned file across messages regardless of content changes', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'note.txt'), 'first-version', 'utf8')
		const first = makeArgs(root, [{ id: 'u1', role: 'user', content: '看 `note.txt`' }])
		await preloadMentionedFiles(first.args)
		assertEquals(first.logs.length, 1)

		// 新用户消息提及同一文件但内容未变：按 realpath 跳过
		const same = makeArgs(root, [{ id: 'u1', role: 'user', content: '看 `note.txt`' }, ...first.logs, { id: 'u2', role: 'user', content: '再看 `note.txt`' }])
		await preloadMentionedFiles(same.args)
		assertEquals(same.logs, [], '同一文件不应跨轮重复预读')

		// 文件内容变了（agent 改过）：仍按 realpath 跳过，不把改动后的文件重新塞进上下文
		await fs.writeFile(path.join(root, 'note.txt'), 'second-version', 'utf8')
		const changed = makeArgs(root, [{ id: 'u1', role: 'user', content: '看 `note.txt`' }, ...first.logs, { id: 'u3', role: 'user', content: '再看 `note.txt`' }])
		await preloadMentionedFiles(changed.args)
		assertEquals(changed.logs, [], '内容变化的同一文件也不应重新预读')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('preloadMentionedFiles skips a file already preloaded even when diagnostics point at a new line', async () => {
	const root = await tempDir()
	try {
		const file = path.join(root, 'messages.mjs')
		await fs.writeFile(file, Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n'), 'utf8')
		const first = makeArgs(root, [{ id: 'u1', role: 'user', content: `${file}\n  12:1  error  Missing JSDoc  jsdoc/require-param-type` }])
		await preloadMentionedFiles(first.args)
		assertEquals(first.logs.length, 1)
		assert(first.logs[0].content.includes('line-10') && first.logs[0].content.includes('line-14'))
		assert(!first.logs[0].content.includes('line-20'), '报错窗口之外的内容不应预读')

		// 同一文件、新的报错行：仍按 realpath 跳过
		const second = makeArgs(root, [{ id: 'u1', role: 'user', content: `${file}\n  12:1  error  Missing JSDoc  jsdoc/require-param-type` }, ...first.logs, { id: 'u2', role: 'user', content: `${file}\n  20:1  error  Missing JSDoc  jsdoc/require-param-type` }])
		await preloadMentionedFiles(second.args)
		assertEquals(second.logs, [], '同一文件不应因报错行变化而重新预读')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('collectMentionedFiles clamps a single over-budget file', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'long.txt'), 'x'.repeat(500), 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })

		const result = await collectMentionedFiles(executor, '看 `long.txt`', { maxChars: 50 })
		assertEquals(result.textFiles.length, 1)
		assertEquals(result.textFiles[0].content.length, 50, '正文应被收进字符预算')
		assert(result.textFiles[0].notice, '应附省略提示')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('collectMentionedFiles lists mentioned directories', async () => {
	const root = await tempDir()
	try {
		await fs.mkdir(path.join(root, 'docs'))
		await fs.writeFile(path.join(root, 'docs', 'a.md'), 'a', 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })

		const result = await collectMentionedFiles(executor, '列一下 `docs` 里的东西', { maxFiles: 5 })
		const dir = result.dirs.find(item => item.path === 'docs')
		assert(dir, '应识别目录')
		assert(dir.entries.includes('a.md'))
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectMentionedFiles ignores non-existent paths', async () => {
	const root = await tempDir()
	try {
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		const result = await collectMentionedFiles(executor, '看看 `missing.txt`', { maxFiles: 5 })
		assertEquals(result.textFiles.length, 0)
		assertEquals(result.binaryFiles.length, 0)
		assertEquals(result.dirs.length, 0)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('getFileOperationsPrompt no longer emits transient preload entries', async () => {
	const current = await getFileOperationsPrompt({
		username: 'u', Charname: 'Char', UserCharname: 'User',
		chat_log: [{ role: 'user', content: '读 `note.txt`' }],
	})
	assertEquals(current.additional_chat_log, [])
})

Deno.test('parseErrorLocations reads eslint stylish, gcc, tsc, rustc and python locations', () => {
	const eslint = `PS C:\\proj> eslint --fix --quiet

C:\\proj\\src\\messages.mjs
  735:1  error  Missing JSDoc @param "root0" description  jsdoc/require-param-description
  735:1  error  Missing JSDoc @param "root0" type         jsdoc/require-param-type
  736:1  error  Missing JSDoc @param "root0.x" description  jsdoc/require-param-description
  751:1  warning  Missing JSDoc @param "entries" type     jsdoc/require-param-type

✖ 4 problems (3 errors, 1 warning)`
	const eslintLocations = parseErrorLocations(eslint)
	assertEquals(eslintLocations.length, 1)
	assertEquals(eslintLocations[0].path, 'C:\\proj\\src\\messages.mjs')
	assertEquals(eslintLocations[0].lines, [735, 736, 751])

	assertEquals(parseErrorLocations('src/a.c:12:5: error: bad').map(x => [x.path, x.lines]), [['src/a.c', [12]]])
	assertEquals(parseErrorLocations('src/a.ts(12,5): error TS2322: bad').map(x => [x.path, x.lines]), [['src/a.ts', [12]]])
	assertEquals(parseErrorLocations('  --> src/main.rs:12:5').map(x => [x.path, x.lines]), [['src/main.rs', [12]]])
	assertEquals(parseErrorLocations('  File "src/a.py", line 12, in foo').map(x => [x.path, x.lines]), [['src/a.py', [12]]])
})

Deno.test('parseErrorLocations handles eslint stylish headers without a directory and ansi colors', () => {
	assertEquals(parseErrorLocations('foo.mjs\n  1:1  error  bad  rule').map(x => [x.path, x.lines]), [['foo.mjs', [1]]])

	const ansi = '\u001b[0m\u001b[4mC:\\proj\\a.mjs\u001b[0m\n  \u001b[2m3:1\u001b[22m  \u001b[31merror\u001b[39m  bad  rule'
	assertEquals(parseErrorLocations(ansi).map(x => [x.path, x.lines]), [['C:\\proj\\a.mjs', [3]]])

	const mixed = 'C:\\proj\\a.mjs\n  1:1  error  bad  rule\n\nb.mjs\n  9:1  error  bad  rule'
	assertEquals(parseErrorLocations(mixed).map(x => [x.path, x.lines]), [['C:\\proj\\a.mjs', [1]], ['b.mjs', [9]]])
})

Deno.test('collectMentionedFiles with extractPaths false only resolves error locations', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'note.txt'), 'note-content', 'utf8')
		const file = path.join(root, 'src', 'a.c')
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n'), 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		const text = `看 \`note.txt\`\n${file}:12:5: error: boom`

		const withPaths = await collectMentionedFiles(executor, text, { maxFiles: 5 })
		assertEquals(withPaths.textFiles.map(x => x.path).sort(), [file, 'note.txt'].sort())

		const errorsOnly = await collectMentionedFiles(executor, text, { maxFiles: 5, extractPaths: false })
		assertEquals(errorsOnly.textFiles.length, 1, '关闭普通路径提取后只应命中报错文件')
		assertEquals(errorsOnly.textFiles[0].path, file)
		assertEquals(errorsOnly.textFiles[0].mode, 'errors')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('preloadMentionedFiles preloads error windows from trailing tool output but ignores its plain paths', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'note.txt'), 'note-content', 'utf8')
		const file = path.join(root, 'src', 'a.c')
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n'), 'utf8')
		const run = makeArgs(root, [
			{ id: 'u1', role: 'user', content: '修复构建错误' },
			{ role: 'char', content: '执行检查' },
			{ role: 'tool', name: 'code-execution.run-pwsh', content: `顺便记下 \`note.txt\`\n${file}:12:5: error: boom` },
		])
		await preloadMentionedFiles(run.args)

		assertEquals(run.logs.length, 1, '只应从工具输出预读报错文件')
		const preload = run.logs[0]
		assertEquals(preload.name, 'file-operations.preload')
		assert(preload.content.includes('line-10') && preload.content.includes('line-14'))
		assert(!preload.content.includes('line-20'), '报错窗口之外的内容不应预读')
		assert(!preload.content.includes('note-content'), '工具输出中的普通路径不应触发默认预读')
		assert(!pluginData(preload).preload.forUser, '工具输出预读不绑定用户消息 id')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('preloadMentionedFiles ignores trailing tool output without error locations', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'note.txt'), 'note-content', 'utf8')
		const run = makeArgs(root, [
			{ id: 'u1', role: 'user', content: '继续' },
			{ role: 'char', content: '继续' },
			{ role: 'tool', name: 'code-execution.run-pwsh', content: '列出了 `note.txt`，无报错' },
		])
		await preloadMentionedFiles(run.args)
		assertEquals(run.logs, [], '无报错定位的工具输出不应触发预读')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('preloadMentionedFiles does not rescan tool output already known as a preload file', async () => {
	const root = await tempDir()
	try {
		const file = path.join(root, 'src', 'a.c')
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n'), 'utf8')
		const tool = { role: 'tool', name: 'code-execution.run-pwsh', content: `${file}:12:5: error: boom` }

		const first = makeArgs(root, [{ id: 'u1', role: 'user', content: '继续' }, { role: 'char', content: '跑一下' }, tool])
		await preloadMentionedFiles(first.args)
		assertEquals(first.logs.length, 1)

		// 下一轮同一条错误输出仍在末尾：该文件已随预读条目记录，按 realpath 跳过
		const second = makeArgs(root, [{ id: 'u1', role: 'user', content: '继续' }, { role: 'char', content: '跑一下' }, tool, ...first.logs])
		await preloadMentionedFiles(second.args)
		assertEquals(second.logs, [], '已预读过的报错文件不应从工具输出重复预读')
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('mergeLineWindows expands and merges neighbouring error lines', () => {
	assertEquals(mergeLineWindows([735, 736, 751], 2), [{ start: 733, end: 738 }, { start: 749, end: 753 }])
	assertEquals(mergeLineWindows([5, 6], 2), [{ start: 3, end: 8 }])
	assertEquals(mergeLineWindows([1], 2), [{ start: 1, end: 3 }])
})

Deno.test('collectMentionedFiles reads only error windows when diagnostics are present', async () => {
	const root = await tempDir()
	try {
		const file = path.join(root, 'src', 'a.c')
		await fs.mkdir(path.dirname(file), { recursive: true })
		const lines = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`)
		await fs.writeFile(file, lines.join('\n'), 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })

		const result = await collectMentionedFiles(executor, `检查一下：\n${file}:12:5: error: boom`, { maxFiles: 5 })
		assertEquals(result.textFiles.length, 1)
		const textFile = result.textFiles[0]
		assertEquals(textFile.mode, 'errors')
		assertEquals(textFile.errorLines, [12])
		assertEquals(textFile.windows.length, 1)
		assertEquals([textFile.windows[0].start, textFile.windows[0].end], [10, 14])
		assert(textFile.windows[0].text.includes('line-10') && textFile.windows[0].text.includes('line-14'))
		assert(!textFile.windows[0].text.includes('line-20'))
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('formatLargeTextForContext keeps only head and tail beyond the line limit', () => {
	const text = Array.from({ length: 1000 }, (_, i) => `l${i + 1}`).join('\n')
	const formatted = formatLargeTextForContext(text)
	assertEquals(formatted.mode, 'truncated')
	assertEquals(formatted.totalLines, 1000)
	assertEquals(formatted.edge, 300)
	assertEquals(formatted.omitted, 400)
	assert(formatted.head.startsWith('l1\n'))
	assert(formatted.tail.endsWith('\nl1000'))
	assert(!formatted.head.includes('l301') && !formatted.tail.includes('l700'))
	assertEquals(formatLargeTextForContext('a\nb').mode, 'full')
})

Deno.test('collectMentionedFiles truncates over-large files and skips known paths', async () => {
	const root = await tempDir()
	try {
		const big = path.join(root, 'big.txt')
		await fs.writeFile(big, Array.from({ length: 700 }, (_, i) => `l${i + 1}`).join('\n'), 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })

		const result = await collectMentionedFiles(executor, '看 `big.txt`', { maxFiles: 5 })
		assertEquals(result.textFiles[0].mode, 'truncated')
		assertEquals(result.textFiles[0].omitted, 100)

		const { resolved } = result.textFiles[0]
		const skipped = await collectMentionedFiles(executor, '再看 `big.txt`', { maxFiles: 5, knownFiles: new Set([resolved]) })
		assertEquals(skipped.textFiles.length, 0)
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})
