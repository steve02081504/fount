/**
 * AGENTS.md 与引用闭包 `.md`：英文、可解析链接；非 AGENTS.md 须在 docs/ 下。
 * `docs/design/`、`docs/review/`、`docs/issues/`、`docs/readme/` 可为中文。
 */
/* global Deno */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	CJK_RE,
	isAgentsAuxDocPlacementOk,
	isAgentsMdBasename,
	isHumanFacingDocsPath,
	localMdLinkTargets,
	resolveMdLink,
	scanAgentsMdEnglish,
} from '../agents_md_english.mjs'

/**
 * 将 scan 问题格式化为断言可读字符串。
 * @param {{ path: string, lines: number[], missing?: boolean, placement?: boolean, from?: string }} issue 问题
 * @returns {string} 一行摘要
 */
function formatIssue(issue) {
	if (issue.missing) return `missing ${issue.path}${issue.from ? ` <- ${issue.from}` : ''}`
	if (issue.placement) return `placement ${issue.path}`
	return `${issue.path}:${issue.lines.join(',')}`
}

Deno.test('resolveMdLink handles repo-root and relative links', () => {
	assertEquals(resolveMdLink('AGENTS.md', 'docs/AGENTS.md'), 'docs/AGENTS.md')
	assertEquals(
		resolveMdLink('src/scripts/test/docs/domain-harness.md', '../../p2p/docs/signaling.md'),
		'src/scripts/p2p/docs/signaling.md',
	)
	assertEquals(resolveMdLink('docs/AGENTS.md', 'https://example.com/x.md'), null)
	assertEquals(resolveMdLink('docs/AGENTS.md', 'mailto:a@b.com/x.md'), null)
	assertEquals(resolveMdLink('docs/AGENTS.md', '//cdn.example/x.md'), null)
})

Deno.test('localMdLinkTargets parses bare, angle-bracket, titled, and fragment forms', () => {
	assertEquals(localMdLinkTargets('see [a](docs/a.md) and [b](docs/b.md#sec)'), [
		'docs/a.md',
		'docs/b.md',
	])
	assertEquals(localMdLinkTargets('see [a](<docs/a.md>) and [b](<docs/b.md#sec>)'), [
		'docs/a.md',
		'docs/b.md',
	])
	assertEquals(localMdLinkTargets('see [a](docs/a.md "Title") and [b](<docs/b.md#x> \'Alt\')'), [
		'docs/a.md',
		'docs/b.md',
	])
	assertEquals(localMdLinkTargets('skip [ext](https://example.com/x.md)'), [])
})

Deno.test('isAgentsAuxDocPlacementOk / isAgentsMdBasename', () => {
	assertEquals(isAgentsMdBasename('AGENTS.md'), true)
	assertEquals(isAgentsMdBasename('src/foo/agents.md'), true)
	assertEquals(isAgentsMdBasename('docs/notes.md'), false)
	assertEquals(isAgentsAuxDocPlacementOk('AGENTS.md'), true)
	assertEquals(isAgentsAuxDocPlacementOk('path/docs/git-notes.md'), true)
	assertEquals(isAgentsAuxDocPlacementOk('docs/design/spec.md'), true)
	assertEquals(isAgentsAuxDocPlacementOk('imgs/icon_anime/physics-notes.md'), false)
})

Deno.test('angle-bracket and titled .md links are discovered and scanned recursively', async () => {
	const { mkdtemp } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const dir = await mkdtemp(join(tmpdir(), 'agents-md-links-'))
	try {
		await writeFile(join(dir, 'AGENTS.md'), [
			'# Root',
			'',
			'See [angled](<nested/docs/guide.md#top>) and [titled](nested/docs/other.md "Other") and [bad](nested/loose.md).',
			'',
		].join('\n'), 'utf8')
		await mkdir(join(dir, 'nested', 'docs'), { recursive: true })
		await writeFile(join(dir, 'nested', 'docs', 'guide.md'), [
			'# Guide',
			'',
			'See [leaf](leaf.md).',
			'中文说明',
			'',
		].join('\n'), 'utf8')
		await writeFile(join(dir, 'nested', 'docs', 'other.md'), [
			'# Other',
			'',
			'See [missing](gone.md).',
			'',
		].join('\n'), 'utf8')
		await writeFile(join(dir, 'nested', 'docs', 'leaf.md'), '# Leaf\n', 'utf8')
		await writeFile(join(dir, 'nested', 'loose.md'), '# Loose\n', 'utf8')

		const { files, issues } = await scanAgentsMdEnglish(dir)
		assertEquals(issues.map(formatIssue).sort(), [
			'missing nested/docs/gone.md <- nested/docs/other.md',
			'nested/docs/guide.md:4',
			'placement nested/loose.md',
		].sort())
		assertEquals(files, [
			'AGENTS.md',
			'nested/docs/guide.md',
			'nested/docs/leaf.md',
			'nested/docs/other.md',
			'nested/loose.md',
		].sort())
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

Deno.test('isHumanFacingDocsPath', () => {
	assertEquals(isHumanFacingDocsPath('docs/design/emoji-pack-spec.md'), true)
	assertEquals(isHumanFacingDocsPath('docs/review/foo.md'), true)
	assertEquals(isHumanFacingDocsPath('docs/issues/part-hot-reload.md'), true)
	assertEquals(isHumanFacingDocsPath('docs/readme/Readme.zh-CN.md'), true)
	assertEquals(isHumanFacingDocsPath('docs/AGENTS.md'), false)
	assertEquals(isHumanFacingDocsPath('src/scripts/test/AGENTS.md'), false)
})

Deno.test('CJK_RE matches CJK scripts', () => {
	assert(CJK_RE.test('中文'))
	assert(CJK_RE.test('ひらがな'))
	assert(CJK_RE.test('カタカナ'))
	assert(CJK_RE.test('한글'))
	assertEquals(CJK_RE.test('English … — ok'), false)
})

Deno.test('AGENTS.md closure: English, resolvable links, aux docs under docs/', async () => {
	const { issues } = await scanAgentsMdEnglish(REPO_ROOT)
	assertEquals(
		issues.map(formatIssue),
		[],
		issues.map(formatIssue).join('\n'),
	)
})
