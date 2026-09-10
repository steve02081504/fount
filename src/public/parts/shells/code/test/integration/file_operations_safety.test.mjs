/* global Deno */
/**
 * 文件操作 · 写操作防呆单元测试（edit_safety 纯函数 + handler 端到端）。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { fileOperationsReplyHandler } from '../../../../plugins/file-operations/handler.mjs'
import { applyEol, applyReplacement, detectTextStyle, renderLineDiff, restoreBom, similarityRatio, stripBom, toLf } from '../../../../plugins/file-operations/src/edit_safety.mjs'

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
		assertEquals(await fileOperationsReplyHandler({ content, content_for_handle: content }, run.args), true)
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
		await fileOperationsReplyHandler({ content, content_for_handle: content }, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'dup\ndup\n', 'multi/empty must not modify file')
		const text = logText(run.logs)
		assert(text.includes('命中 2 处'), `log should mention multi-match: ${text}`)
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
		await fileOperationsReplyHandler({ content, content_for_handle: content }, run.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'one\none\n')
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
		await fileOperationsReplyHandler({ content: '<override-file path="f.txt">omega</override-file>', content_for_handle: '<override-file path="f.txt">omega</override-file>' }, blocked.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'alpha\nbeta\ngamma\ndelta\n')
		assert(logText(blocked.logs).includes('被拒绝'), 'override should be rejected')

		const forced = createHandlerArgs(root)
		await fileOperationsReplyHandler({ content: '<override-file path="f.txt" force="true">omega</override-file>', content_for_handle: '<override-file path="f.txt" force="true">omega</override-file>' }, forced.args)
		assertEquals(await fs.readFile(path.join(root, 'f.txt'), 'utf8'), 'omega\n')
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('handler override creates new files and leaves no temp residue', async () => {
	const root = await tempDir()
	try {
		const run = createHandlerArgs(root)
		await fileOperationsReplyHandler({ content: '<override-file path="new/f.txt">hello</override-file>', content_for_handle: '<override-file path="new/f.txt">hello</override-file>' }, run.args)
		assertEquals(await fs.readFile(path.join(root, 'new', 'f.txt'), 'utf8'), 'hello\n')
		const entries = await fs.readdir(path.join(root, 'new'))
		assert(entries.every(name => !name.includes('.fount-write-')), `temp residue: ${entries.join(', ')}`)
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
