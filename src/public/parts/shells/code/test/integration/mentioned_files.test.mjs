/* global Deno */
/**
 * 聊天提及文件预读取 · 单元测试。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

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
