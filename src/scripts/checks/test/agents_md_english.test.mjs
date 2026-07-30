/**
 * AGENTS.md + agent-facing linked `.md` English-only; `docs/design/` and `docs/review/` may be Chinese.
 */
/* global Deno */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	CJK_RE,
	isHumanFacingDocsPath,
	localMdLinkTargets,
	resolveMdLink,
	scanAgentsMdEnglish,
} from '../agents_md_english.mjs'

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

Deno.test('angle-bracket and titled .md links are discovered and scanned recursively', async () => {
	const { mkdtemp } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const dir = await mkdtemp(join(tmpdir(), 'agents-md-links-'))
	try {
		await writeFile(join(dir, 'AGENTS.md'), [
			'# Root',
			'',
			'See [angled](<nested/guide.md#top>) and [titled](nested/other.md "Other").',
			'',
		].join('\n'), 'utf8')
		await mkdir(join(dir, 'nested'))
		await writeFile(join(dir, 'nested', 'guide.md'), '# Guide\n\nSee [leaf](leaf.md).\n', 'utf8')
		await writeFile(join(dir, 'nested', 'other.md'), '# Other\n', 'utf8')
		await writeFile(join(dir, 'nested', 'leaf.md'), '# Leaf\n', 'utf8')

		const { files, issues } = await scanAgentsMdEnglish(dir)
		assertEquals(issues, [])
		assertEquals(files, [
			'AGENTS.md',
			'nested/guide.md',
			'nested/leaf.md',
			'nested/other.md',
		].sort())
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

Deno.test('isHumanFacingDocsPath', () => {
	assertEquals(isHumanFacingDocsPath('docs/design/emoji-pack-spec.md'), true)
	assertEquals(isHumanFacingDocsPath('docs/review/foo.md'), true)
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

Deno.test('AGENTS.md closure has no CJK (except design/review) and no missing links', async () => {
	const { issues } = await scanAgentsMdEnglish(REPO_ROOT)
	assertEquals(
		issues.map(issue => issue.missing
			? `missing ${issue.path}${issue.from ? ` <- ${issue.from}` : ''}`
			: `${issue.path}:${issue.lines.join(',')}`),
		[],
		issues.map(issue => issue.missing
			? `missing ${issue.path}${issue.from ? ` <- ${issue.from}` : ''}`
			: `${issue.path} lines ${issue.lines.join(', ')}`).join('\n'),
	)
})
