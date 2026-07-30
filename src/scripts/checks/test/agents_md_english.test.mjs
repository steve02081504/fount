/**
 * AGENTS.md + agent-facing linked `.md` English-only; `docs/design|review` may be Chinese.
 */
/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	CJK_RE,
	isHumanFacingDocsPath,
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
})

Deno.test('isHumanFacingDocsPath', () => {
	assertEquals(isHumanFacingDocsPath('docs/design/emoji-pack-spec.md'), true)
	assertEquals(isHumanFacingDocsPath('docs/review/foo.md'), true)
	assertEquals(isHumanFacingDocsPath('docs/AGENTS.md'), false)
	assertEquals(isHumanFacingDocsPath('src/scripts/test/AGENTS.md'), false)
})

Deno.test('CJK_RE matches Han only', () => {
	assert(CJK_RE.test('中文'))
	assertEquals(CJK_RE.test('English … — ok'), false)
})

Deno.test('AGENTS.md closure has no CJK (except design/review) and no missing links', async () => {
	const { issues } = await scanAgentsMdEnglish(REPO_ROOT)
	assertEquals(
		issues.map(i => i.missing
			? `missing ${i.path}${i.from ? ` <- ${i.from}` : ''}`
			: `${i.path}:${i.lines.join(',')}`),
		[],
		issues.map(i => i.missing
			? `missing ${i.path}${i.from ? ` <- ${i.from}` : ''}`
			: `${i.path} lines ${i.lines.join(', ')}`).join('\n'),
	)
})
