/* global Deno */
/**
 * 聊天提及文件预读取 · 单元测试。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { getFileOperationsPrompt } from '../../../../plugins/file-operations/prompt.mjs'
import { collectMentionedFiles, extractPathCandidates } from '../../../../plugins/file-operations/src/mentioned_files.mjs'
import { createTargetExecutor } from '../../../../plugins/file-operations/src/target.mjs'

Deno.test('extractPathCandidates finds backticked and absolute paths', () => {
	const candidates = extractPathCandidates('看看 `src/a.txt` 与 C:\\proj\\b.md，还有 https://example.com/x')
	assert(candidates.includes('src/a.txt'), '应提取反引号相对路径')
	assert(candidates.includes('C:\\proj\\b.md'), '应提取 Windows 绝对路径')
})

Deno.test('collectMentionedFiles preloads existing relative files under workdir', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_mention_'))
	try {
		await fs.writeFile(path.join(root, 'note.txt'), 'hello\nworld', 'utf8')
		await fs.writeFile(path.join(root, 'other.md'), '# other', 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })

		const result = await collectMentionedFiles(executor, '请看看 `note.txt`，还有 `note.txt`', { maxFiles: 5 })
		assertEquals(result.textFiles.length, 1, '重复提及应去重')
		assertEquals(result.textFiles[0].path, 'note.txt')
		assert(result.textFiles[0].content.includes('hello'))
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectMentionedFiles deduplicates equivalent absolute and relative paths, including directories', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_mention_'))
	try {
		await fs.mkdir(path.join(root, 'docs'))
		await fs.writeFile(path.join(root, 'docs', 'a.md'), 'only-once', 'utf8')
		const executor = createTargetExecutor('u', { machine: '0', workdir: root })
		const text = `看 \`docs/a.md\` 和 \`${path.join(root, 'docs', 'a.md')}\`；目录 \`docs\` 和 \`${path.join(root, 'docs')}\``
		const result = await collectMentionedFiles(executor, text)
		assertEquals(result.textFiles.length, 1)
		assertEquals(result.dirs.length, 1)
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('file-operations only preloads paths in the newest user message', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_mention_'))
	try {
		await fs.writeFile(path.join(root, 'old.md'), 'old-context', 'utf8')
		await fs.writeFile(path.join(root, 'new.md'), 'new-context', 'utf8')
		const args = {
			username: 'u', Charname: 'Char', UserCharname: 'User',
			workdir: { machine: '0', path: root },
			chat_log: [{ role: 'user', content: '读 `old.md`' }, { role: 'char', content: '读 `old.md`' }, { role: 'user', content: '读 `new.md`' }],
		}
		const current = await getFileOperationsPrompt(args)
		assertEquals(current.additional_chat_log.length, 1)
		assert(current.additional_chat_log[0].content.includes('new-context'))
		assert(!current.additional_chat_log[0].content.includes('old-context'))
		args.chat_log.push({ role: 'char', content: '处理中 `new.md`' })
		assertEquals((await getFileOperationsPrompt(args)).additional_chat_log, [])
	}
	finally { await fs.rm(root, { recursive: true, force: true }) }
})

Deno.test('collectMentionedFiles lists mentioned directories', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_mention_'))
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
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_mention_'))
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
