/* global Deno */
/**
 * 文件操作 · 写操作防呆单元测试（edit_safety 纯函数 + handler 端到端）。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert'

import { allowNoise } from 'fount/scripts/test/core/allowNoise.mjs'

import { runReplyHandlers } from '../../../../shells/chat/src/reply/handlerPipeline.mjs'
import { fileOperationsReplyHandlers } from '../../handler.mjs'
import { applyEol, applyReplacement, buildFileEditSummary, detectTextStyle, normalizeTagBody, renderLineDiff, restoreBom, similarityRatio, stripBom, toLf } from '../../src/edit_safety.mjs'

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
 * 创建临时目录。
 * @returns {Promise<string>} 目录路径。
 */
async function tempDir() {
	return await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_safety_'))
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

/**
 * 将 handler 的所有回写日志拼为文本。
 * @param {object[]} logs - 日志数组。
 * @returns {string} 拼接文本。
 */
function logText(logs) {
	return logs.map(entry => entry.content).join('\n')
}

Deno.test('edit_safety keeps CRLF and BOM through round trip', () => {
	const style = detectTextStyle('\uFEFFa\r\nb\r\n')
	assertEquals(style, { eol: '\r\n', bom: true })
	const lf = toLf(stripBom('\uFEFFa\r\nb\r\n'))
	assertEquals(lf, 'a\nb\n')
	assertEquals(restoreBom(applyEol(lf, style.eol), style.bom), '\uFEFFa\r\nb\r\n')
})

Deno.test('normalizeTagBody strips only boundary newlines and keeps inner whitespace', () => {
	assertEquals(normalizeTagBody('\n\tline   \n'), '\tline   ')
	assertEquals(normalizeTagBody('inline'), 'inline')
	assertEquals(normalizeTagBody('\n\nline\n\n'), '\nline\n')
	assertEquals(normalizeTagBody('\r\nline\r\n'), 'line')
	assertEquals(normalizeTagBody(''), '')
})

Deno.test('applyReplacement rejects empty search', () => {
	assertEquals(applyReplacement('abc', { search: '   ' }).status, 'empty')
})

Deno.test('applyReplacement rejects multiple matches unless replaceAll', () => {
	const multi = applyReplacement('x\nx\n', { search: 'x' })
	assertEquals(multi.status, 'multi')
	assertEquals(multi.matchCount, 2)
	const all = applyReplacement('x\nx\n', { search: 'x', replace: 'y', replaceAll: true })
	assertEquals(all.status, 'applied')
	assertEquals(all.content, 'y\ny\n')
})

Deno.test('applyReplacement does not interpret $ in literal replacement', () => {
	const result = applyReplacement('abc', { search: 'abc', replace: '$&X' })
	assertEquals(result.status, 'applied')
	assertEquals(result.content, '$&X')
})

Deno.test('applyReplacement supports regex backreferences', () => {
	const result = applyReplacement('abc', { search: '/a(b)c/', replace: '$1$1', regex: true })
	assertEquals(result.status, 'applied')
	assertEquals(result.content, 'bb')
})

Deno.test('applyReplacement falls back to line-trim fuzzy match', () => {
	const result = applyReplacement('  const x = 1  \n  const y = 2  \n', { search: 'const x = 1\nconst y = 2', replace: 'const z = 3' })
	assertEquals(result.status, 'applied')
	assertEquals(result.method, 'fuzzy:line-trim')
	assertEquals(result.content, 'const z = 3\n')
})

Deno.test('applyReplacement falls back to whitespace-normalized fuzzy match', () => {
	const result = applyReplacement('foo   bar', { search: 'foo bar', replace: 'baz' })
	assertEquals(result.status, 'applied')
	assertEquals(result.method, 'fuzzy:whitespace-normalized')
	assertEquals(result.content, 'baz')
})

Deno.test('applyReplacement reports no-match and invalid regex', () => {
	assertEquals(applyReplacement('abc', { search: 'zzz' }).status, 'no-match')
	assertEquals(applyReplacement('abc', { search: '(unclosed', regex: true }).status, 'invalid')
})

Deno.test('similarityRatio distinguishes identical and unrelated text', () => {
	assertEquals(similarityRatio('a\nb\nc\n', 'a\nb\nc\n'), 1)
	assert(similarityRatio('a\nb\nc\n', 'x\ny\nz\n') < 0.3)
})

Deno.test('renderLineDiff emits changed lines with context', () => {
	const diff = renderLineDiff('a\nb\nc', 'a\nB\nc')
	assert(diff.includes('- b') && diff.includes('+ B'), `diff: ${diff}`)
	assertEquals(renderLineDiff('same', 'same'), '')
})

Deno.test('handler replace preserves CRLF file semantics', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'line1\r\nline2\r\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"><replacement><search>line1\nline2</search><replace>LINE1\nLINE2</replace></replacement></file></replace-file>'
		assertEquals(await runFileOps(content, run.args), true)
		const written = await fs.readFile(path.join(root, 'f.txt'), 'utf8')
		assertEquals(written, 'LINE1\r\nLINE2\r\n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler rejects empty and multi-match replacements without writing', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'dup\ndup\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt">'
			+ '<replacement><search>   </search><replace>x</replace></replacement>'
			+ '<replacement><search>dup</search><replace>one</replace></replacement>'
			+ '</file></replace-file>'
		await runFileOps(content, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'dup\ndup\n', 'multi/empty must not modify file')
		const text = logText(run.logs)
		assert(text.includes('命中 2 处'), `log should mention multi-match: ${text}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replace parse failure marks failed and skips the next same-round call', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'a\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"></file></replace-file>\n'
			+ '<override-file path="new.txt">hello</override-file>'
		// 该用例故意触发解析失败：product 的 console.error 回执属预期输出，豁免其噪声判定。
		await allowNoise('Error parsing replace-file', () => runFileOps(content, run.args))
		await assertRejects(() => fs.access(path.join(root, 'new.txt')))
		assert(logText(run.logs).includes('解析replace-file失败'), '失败回执应存在')
		assert(run.logs.some(entry => entry.name === 'chat.skipped-calls'), '应追加跳过提示')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replace no-match marks failed and skips the next same-round call', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'alpha\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"><replacement><search>absent</search><replace>x</replace></replacement></file></replace-file>\n'
			+ '<override-file path="new.txt">hello</override-file>'
		await runFileOps(content, run.args)
		await assertRejects(() => fs.access(path.join(root, 'new.txt')))
		assert(run.logs.some(entry => entry.name === 'chat.skipped-calls'), '应追加跳过提示')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replaceAll replaces every occurrence', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'dup\ndup\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"><replacement replaceAll="true"><search>dup</search><replace>one</replace></replacement></file></replace-file>'
		await runFileOps(content, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'one\none\n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replace preserves leading indentation of search and replace', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), ' * before\n * target\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"><replacement><search> * target</search><replace> * targetX</replace></replacement></file></replace-file>'
		await runFileOps(content, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), ' * before\n * targetX\n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replace strips one tag-boundary newline from search and replace', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), ' * before\n * target\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"><replacement>\n<search>\n * target\n</search>\n<replace>\n * targetX\n</replace>\n</replacement></file></replace-file>'
		await runFileOps(content, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), ' * before\n * targetX\n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replace does not accumulate spaces across consecutive edits', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), ' * target\n', 'utf8')
		const first = createHandlerArgs(root)
		await runFileOps('<replace-file><file path="f.txt"><replacement><search> * target</search><replace> * step1</replace></replacement></file></replace-file>', first.args)
		const second = createHandlerArgs(root)
		await runFileOps('<replace-file><file path="f.txt"><replacement><search> * step1</search><replace> * step2</replace></replacement></file></replace-file>', second.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), ' * step2\n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replace preserves tabs and trailing spaces', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), '\tvalue   \n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"><replacement><search>\tvalue   </search><replace>\tnewValue   </replace></replacement></file></replace-file>'
		await runFileOps(content, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), '\tnewValue   \n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler replace keeps leading indentation in CRLF file', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), '  a\r\n  b\r\n', 'utf8')
		const run = createHandlerArgs(root)
		const content = '<replace-file><file path="f.txt"><replacement><search>  b</search><replace>  c</replace></replacement></file></replace-file>'
		await runFileOps(content, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), '  a\r\n  c\r\n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler override preserves leading indentation and trailing spaces', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), '\tkeep\n', 'utf8')
		const run = createHandlerArgs(root)
		await runFileOps('<override-file path="f.txt" force="true">\n\tindented   \n</override-file>', run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), '\tindented   \n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler blocks drastic override unless force', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'alpha\nbeta\ngamma\ndelta\n', 'utf8')
		const blocked = createHandlerArgs(root)
		await runFileOps('<override-file path="f.txt">omega</override-file>', blocked.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'alpha\nbeta\ngamma\ndelta\n')
		assert(logText(blocked.logs).includes('被拒绝'), 'override should be rejected')

		const forced = createHandlerArgs(root)
		await runFileOps('<override-file path="f.txt" force="true">omega</override-file>', forced.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'omega\n')
		assert(logText(forced.logs).includes('变更摘要（行级 diff）'), 'successful override should expose a diff for the code shell preview')
		const edit = forced.logs.at(-1).extension?.pluginData?.['file-operations']?.edit
		assertEquals(edit?.path, 'f.txt', 'the change card reads the structured edit, not the localized log text')
		assertEquals(edit.added, 1)
		assertEquals(edit.removed, 4)
		assert(edit.diff.includes('- alpha') && edit.diff.includes('+ omega'), 'the edit carries the display diff')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler records a structured edit only for writes that land', async () => {
	const root = await tempDir()
	try {
		await fs.writeFile(path.join(root, 'f.txt'), 'alpha\nbeta\ngamma\n', 'utf8')
		const edited = createHandlerArgs(root)
		await runFileOps('<replace-file><file path="f.txt"><replacement><search>beta</search><replace>BETA</replace></replacement></file></replace-file>', edited.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'alpha\nBETA\ngamma\n')
		const edit = edited.logs.at(-1).extension?.pluginData?.['file-operations']?.edit
		assertEquals(edit?.path, 'f.txt')
		assertEquals([edit.added, edit.removed], [1, 1])

		const untouched = createHandlerArgs(root)
		await runFileOps('<replace-file><file path="f.txt"><replacement><search>absent</search><replace>x</replace></replacement></file></replace-file>', untouched.args)
		assertEquals(untouched.logs.at(-1).extension?.pluginData?.['file-operations']?.edit, undefined, 'a no-op edit must not appear in the change card')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler override creates new files and leaves no temp residue', async () => {
	const root = await tempDir()
	try {
		const run = createHandlerArgs(root)
		await runFileOps('<override-file path="new/f.txt">hello</override-file>', run.args)
		assertEquals(await fs.readFile(path.join(root, 'new', 'f.txt'), 'utf8'), 'hello\n')
		const entries = await fs.readdir(path.join(root, 'new'))
		assert(entries.every(name => !name.includes('.fount-write-')), `temp residue: ${entries.join(', ')}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('edit summary counts all changes even when its preview is truncated', () => {
	const oldText = Array.from({ length: 100 }, (_, i) => `old ${i}`).join('\n')
	const newText = Array.from({ length: 120 }, (_, i) => `new ${i}`).join('\n')
	const edit = buildFileEditSummary('large.txt', oldText, newText)
	assertEquals([edit.added, edit.removed], [120, 100])
	assert(edit.diff.includes('未显示'))
	assertEquals(buildFileEditSummary('same.txt', 'same', 'same'), { path: 'same.txt', diff: '', added: 0, removed: 0 })
})

Deno.test('large edit previews retain exact omitted counts and capped output', () => {
	const oldText = Array.from({ length: 50000 }, (_, i) => `old ${i}`).join('\n')
	const newText = Array.from({ length: 50000 }, (_, i) => `new ${i}`).join('\n')
	const edit = buildFileEditSummary('large.txt', oldText, newText)
	assertEquals([edit.added, edit.removed], [50000, 50000])
	assertEquals(edit.diff.split('\n').length, 81)
	assertEquals(edit.diff.split('\n').at(-1), '…（99921 行未显示）')
	assertEquals(renderLineDiff('a\nb', 'a\nB', { maxLines: 0 }), '…（4 行未显示）')
})

Deno.test('diff context intervals preserve overlapping and separated hunks', () => {
	const oldText = Array.from({ length: 15 }, (_, i) => String(i)).join('\n')
	const newText = oldText.split('\n').map((line, i) => [2, 3, 12].includes(i) ? `new ${line}` : line).join('\n')
	assertEquals(renderLineDiff(oldText, newText, { context: 1 }),
		'@@ 2 @@\n  1\n- 2\n- 3\n+ new 2\n+ new 3\n  4\n@@ 12 @@\n  11\n- 12\n+ new 12\n  13')
})
