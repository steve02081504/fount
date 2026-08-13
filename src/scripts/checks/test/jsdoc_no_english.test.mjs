/**
 * JSDoc 禁用纯英文摘要 / 缺摘要的扫描器自测；`imgs/icon_anime` 应无英文摘要或空摘要残留。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	extractJsdocBlocks,
	isEnglishJsdocSummary,
	isTagOnlyJsdoc,
	jsdocSummaryLines,
	scanFileJsdocNoEnglish,
	scanJsdocNoEnglish,
} from '../jsdoc_no_english.mjs'

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
	assertEquals(isTagOnlyJsdoc('/**\n * @typedef {object} Foo\n * @property {number} x\n */'), true)
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

Deno.test('extractJsdocBlocks: ignores JSDoc inside nested template interpolations', () => {
	const text = 'const s = `${`\n/** English nested */\n`}`\n/** 中文摘要 */\n'
	const blocks = extractJsdocBlocks(text)
	assertEquals(blocks.length, 1)
	assertEquals(jsdocSummaryLines(blocks[0].text), ['中文摘要'])
})

Deno.test('scanFileJsdocNoEnglish: flags English summary and empty /** */', () => {
	const english = scanFileJsdocNoEnglish('foo.mjs', '/** English doc */\nexport const x = 1')
	assertEquals(english.length, 1)
	assertEquals(english[0].summary, 'English doc')
	assertEquals(english[0].missingSummary, false)

	const empty = scanFileJsdocNoEnglish('foo.mjs', '/** */\nexport const x = 1')
	assertEquals(empty.length, 1)
	assertEquals(empty[0].missingSummary, true)
	assertEquals(empty[0].summary, '')
})

Deno.test('scanFileJsdocNoEnglish: template literal English is not flagged', () => {
	const issues = scanFileJsdocNoEnglish('foo.mjs', 'const s = `/** English doc */`\n')
	assertEquals(issues.length, 0)
})

Deno.test('repo: no English or missing JSDoc summaries', async () => {
	const { issues } = await scanJsdocNoEnglish(REPO_ROOT)
	if (issues.length) {
		const sample = issues.slice(0, 12).map(i => `${i.path}:${i.line} ${i.summary || '(missing)'}`).join('\n')
		assert(false, `English/missing JSDoc (${issues.length}):\n${sample}`)
	}
})

Deno.test('icon_anime: no English or missing JSDoc summaries', async () => {
	const { issues } = await scanJsdocNoEnglish(REPO_ROOT, { under: 'imgs/icon_anime' })
	if (issues.length) {
		const sample = issues.slice(0, 8).map(i => `${i.path}:${i.line} ${i.summary || '(missing)'}`).join('\n')
		assert(false, `English/missing JSDoc in icon_anime (${issues.length}):\n${sample}`)
	}
})
