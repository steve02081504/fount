/**
 * 纯英文 JSDoc 扫描器自测；`imgs/icon_anime` 应无英文摘要残留。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	extractJsdocBlocks,
	isEnglishJsdocSummary,
	isTagOnlyJsdoc,
	jsdocSummaryLines,
	scanFileJsdocEnglish,
	scanJsdocEnglish,
} from '../jsdoc_english.mjs'

Deno.test('jsdocSummaryLines: stops at first @tag', () => {
	const block = `/**
 * 中文摘要行。
 * 第二行。
 * @param {number} x column
 * @returns {void}
 */`
	assertEquals(jsdocSummaryLines(block), ['中文摘要行。', '第二行。'])
})

Deno.test('isEnglishJsdocSummary: CJK is not English', () => {
	assertEquals(isEnglishJsdocSummary(['中文摘要']), false)
	assertEquals(isEnglishJsdocSummary(['English only']), true)
	assertEquals(isEnglishJsdocSummary([]), false)
})

Deno.test('isTagOnlyJsdoc: empty stub is not tag-only', () => {
	assertEquals(isTagOnlyJsdoc('/** */'), false)
	assertEquals(isTagOnlyJsdoc('/**\n *\n */'), false)
	assertEquals(isTagOnlyJsdoc('/**\n * @typedef {{ x: number }}\n */'), true)
	assertEquals(isTagOnlyJsdoc('/**\n * @param {number} x\n * @returns {void}\n */'), true)
})

Deno.test('extractJsdocBlocks: line numbers', () => {
	const text = '/** 甲 */\nconst x = 1\n/** 乙 */'
	const blocks = extractJsdocBlocks(text)
	assertEquals(blocks.length, 2)
	assertEquals(blocks[0].startLine, 1)
	assertEquals(blocks[1].startLine, 3)
})

Deno.test('extractJsdocBlocks: ignores JSDoc text inside template literals', () => {
	const text = 'const s = `\n/** English doc */\n`\n/** 中文摘要 */\n'
	const blocks = extractJsdocBlocks(text)
	assertEquals(blocks.length, 1)
	assertEquals(jsdocSummaryLines(blocks[0].text), ['中文摘要'])
})

Deno.test('scanFileJsdocEnglish: flags English summary', () => {
	const issues = scanFileJsdocEnglish('foo.mjs', '/** English doc */\nexport const x = 1')
	assertEquals(issues.length, 1)
	assertEquals(issues[0].summary, 'English doc')
})

Deno.test('scanFileJsdocEnglish: template literal English is not flagged', () => {
	const issues = scanFileJsdocEnglish('foo.mjs', 'const s = `/** English doc */`\n')
	assertEquals(issues.length, 0)
})

Deno.test('repo: no English JSDoc summaries', async () => {
	const { issues } = await scanJsdocEnglish(REPO_ROOT)
	if (issues.length) {
		const sample = issues.slice(0, 12).map(i => `${i.path}:${i.line} ${i.summary || '(missing)'}`).join('\n')
		assert(false, `English JSDoc (${issues.length}):\n${sample}`)
	}
})

Deno.test('icon_anime: no English JSDoc summaries', async () => {
	const { issues } = await scanJsdocEnglish(REPO_ROOT, { under: 'imgs/icon_anime' })
	if (issues.length) {
		const sample = issues.slice(0, 8).map(i => `${i.path}:${i.line} ${i.summary || '(missing)'}`).join('\n')
		assert(false, `English JSDoc in icon_anime (${issues.length}):\n${sample}`)
	}
})
