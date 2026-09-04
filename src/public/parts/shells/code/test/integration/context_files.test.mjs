/* global Deno */
/**
 * 向上上下文收集（AGENTS.md / .agents/docs glob 触发）· 单元测试。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { collectUpwardContext, formatUpwardContext, globToRegExp, parseFrontmatter } from '../../../../plugins/file-operations/src/context_files.mjs'
import { createTargetExecutor } from '../../../../plugins/file-operations/src/target.mjs'

/**
 * 创建临时目录。
 * @returns {Promise<string>} 目录路径。
 */
async function tempDir() {
	return await fs.mkdtemp(path.join(os.tmpdir(), 'fount_code_ctx_'))
}

Deno.test('parseFrontmatter extracts scalar keys', () => {
	const text = '---\nglob: src/**/*.ts\ndescription: "触发文档"\n---\n\n正文'
	assertEquals(parseFrontmatter(text), { glob: 'src/**/*.ts', description: '触发文档' })
	assertEquals(parseFrontmatter('没有 frontmatter'), {})
})

Deno.test('globToRegExp matches documented patterns', () => {
	const re = globToRegExp('src/**/*.ts')
	assert(re.test('src/a/b.ts'))
	assert(re.test('src/b.ts'))
	assert(!re.test('src/a/b.js'))
	const single = globToRegExp('docs/*.md')
	assert(single.test('docs/a.md'))
	assert(!single.test('docs/sub/a.md'))
	const star = globToRegExp('*')
	assert(star.test('anything.txt'))
})

Deno.test('collectUpwardContext walks up for AGENTS.md and triggered docs', async () => {
	const root = await tempDir()
	try {
		const executor = createTargetExecutor('u', { machine: 0 })
		await fs.mkdir(path.join(root, 'src', 'deep'), { recursive: true })
		await fs.mkdir(path.join(root, 'src', '.agents', 'docs'), { recursive: true })
		await fs.writeFile(path.join(root, 'AGENTS.md'), '# root rules', 'utf8')
		await fs.writeFile(path.join(root, 'src', 'AGENTS.md'), '# src rules', 'utf8')
		await fs.writeFile(path.join(root, 'src', '.agents', 'docs', 'ts.md'), '---\nglob: **/*.ts\n---\nts 触发', 'utf8')
		await fs.writeFile(path.join(root, 'src', '.agents', 'docs', 'other.md'), '---\nglob: nomatch/*\n---\n不该触发', 'utf8')
		await fs.writeFile(path.join(root, 'src', 'deep', 'a.ts'), 'export {}', 'utf8')

		const context = await collectUpwardContext(executor, root, path.join(root, 'src', 'deep', 'a.ts'))
		assertEquals(context.agents.length, 2, '两级 AGENTS.md 均收集')
		assert(context.agents.some(a => a.content.includes('root rules')))
		assert(context.agents.some(a => a.content.includes('src rules')))
		assertEquals(context.docs.length, 1)
		assertEquals(context.docs[0].content, '---\nglob: **/*.ts\n---\nts 触发')
		assert(formatUpwardContext(context).includes('ts 触发'))
	}
	finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
