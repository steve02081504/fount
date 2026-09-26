/**
 * JSDoc 禁用纯英文摘要 / 缺摘要的扫描器自测；`imgs/icon_anime` 应无英文摘要或空摘要残留。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import {
	extractJsdocBlocks,
	hasInlineJsdocClosing,
	hasInlineJsdocOpening,
	isEnglishJsdocSummary,
	isTagOnlyJsdoc,
	jsdocSummaryLines,
	scanFileJsdocClosing,
	scanFileJsdocNoEnglish,
	scanFileJsdocOpening,
	scanJsdocClosing,
	scanJsdocNoEnglish,
	scanJsdocOpening,
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
	const blocks = extractJsdocBlocks('/** 甲 */\nconst x = 1\n/** 乙 */')
	assertEquals(blocks.length, 2)
	assertEquals(blocks[0].startLine, 1)
	assertEquals(blocks[1].startLine, 3)
})

Deno.test('extractJsdocBlocks: ignores JSDoc text inside template literals', () => {
	const blocks = extractJsdocBlocks('const s = `\n/** English doc */\n`\n/** 中文摘要 */\n')
	assertEquals(blocks.length, 1)
	assertEquals(jsdocSummaryLines(blocks[0].text), ['中文摘要'])
})

Deno.test('extractJsdocBlocks: ignores JSDoc inside nested template interpolations', () => {
	const blocks = extractJsdocBlocks('const s = `${`\n/** English nested */\n`}`\n/** 中文摘要 */\n')
	assertEquals(blocks.length, 1)
	assertEquals(jsdocSummaryLines(blocks[0].text), ['中文摘要'])
})

Deno.test('extractJsdocBlocks: inline JSDoc before object literal property', () => {
	const blocks = extractJsdocBlocks('foo({ /** 中文摘要 */\n\tbar: 1 })\n')
	assertEquals(blocks.length, 1)
	assertEquals(blocks[0].startLine, 1)
	assertEquals(jsdocSummaryLines(blocks[0].text), ['中文摘要'])
})

Deno.test('extractJsdocBlocks: ignores JSDoc-shaped text inside line comments', () => {
	const blocks = extractJsdocBlocks('// /** English doc */\n/** 中文摘要 */\n')
	assertEquals(blocks.length, 1)
	assertEquals(jsdocSummaryLines(blocks[0].text), ['中文摘要'])
})

Deno.test('extractJsdocBlocks: ignores JSDoc-shaped text inside block comments', () => {
	const blocks = extractJsdocBlocks('/* /** English doc\n*/\n/** 中文摘要 */\n')
	assertEquals(blocks.length, 1)
	assertEquals(jsdocSummaryLines(blocks[0].text), ['中文摘要'])
})

Deno.test('scanFileJsdocNoEnglish: flags inline empty JSDoc stub', () => {
	const text = 'GetSource(cfg, { /**\n *\n */\n\tSaveConfig: async () => {} })'
	const issues = scanFileJsdocNoEnglish('foo.mjs', text)
	assertEquals(issues.length, 1)
	assertEquals(issues[0].missingSummary, true)
	assertEquals(issues[0].line, 1)
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

Deno.test('hasInlineJsdocOpening: multi-line block must open on its own line', () => {
	assertEquals(hasInlineJsdocOpening('/** 摘要 */'), false)
	assertEquals(hasInlineJsdocOpening('/**\n * 摘要\n */'), false)
	assertEquals(hasInlineJsdocOpening('/** 摘要\n * 第二行\n */'), true)
	assertEquals(hasInlineJsdocOpening('/** @typedef {{ x: number }}\n * @property {number} x\n */'), true)
	assertEquals(hasInlineJsdocOpening('/**\n *\n */'), false)
})

Deno.test('scanFileJsdocOpening: flags inline opening, ignores single-line', () => {
	const flagged = scanFileJsdocOpening('foo.mjs', '/** 摘要\n * 第二行\n */\nexport const x = 1')
	assertEquals(flagged.length, 1)
	assertEquals(flagged[0].line, 1)

	const clean = scanFileJsdocOpening('foo.mjs', '/** 摘要 */\n/**\n * 摘要\n */\n')
	assertEquals(clean.length, 0)
})

Deno.test('repo: multi-line JSDoc opens with /** alone on the first line', async () => {
	const { issues } = await scanJsdocOpening(REPO_ROOT)
	if (issues.length) {
		const sample = issues.slice(0, 12).map(i => `${i.path}:${i.line}`).join('\n')
		assert(false, `Multi-line JSDoc with content on the /** line (${issues.length}):\n${sample}`)
	}
})

Deno.test('icon_anime: multi-line JSDoc opens with /** alone on the first line', async () => {
	const { issues } = await scanJsdocOpening(REPO_ROOT, { under: 'imgs/icon_anime' })
	if (issues.length) {
		const sample = issues.slice(0, 8).map(i => `${i.path}:${i.line}`).join('\n')
		assert(false, `Inline JSDoc opening in icon_anime (${issues.length}):\n${sample}`)
	}
})

Deno.test('hasInlineJsdocClosing: multi-line block must close on its own line', () => {
	assertEquals(hasInlineJsdocClosing('/** 摘要 */'), false)
	assertEquals(hasInlineJsdocClosing('/**\n * 摘要\n */'), false)
	assertEquals(hasInlineJsdocClosing('/**\n * 摘要 */'), true)
	assertEquals(hasInlineJsdocClosing('/**\n * @typedef {{ x: number }} */'), true)
})

Deno.test('scanFileJsdocClosing: flags inline closing, ignores single-line', () => {
	const flagged = scanFileJsdocClosing('foo.mjs', '/**\n * 摘要 */\nexport const x = 1')
	assertEquals(flagged.length, 1)
	assertEquals(flagged[0].line, 1)

	const clean = scanFileJsdocClosing('foo.mjs', '/** 摘要 */\n/**\n * 摘要\n */\n')
	assertEquals(clean.length, 0)
})

Deno.test('repo: multi-line JSDoc closes with */ alone on the last line', async () => {
	const { issues } = await scanJsdocClosing(REPO_ROOT)
	if (issues.length) {
		const sample = issues.slice(0, 12).map(i => `${i.path}:${i.line}`).join('\n')
		assert(false, `Multi-line JSDoc with content on the */ line (${issues.length}):\n${sample}`)
	}
})

Deno.test('icon_anime: multi-line JSDoc closes with */ alone on the last line', async () => {
	const { issues } = await scanJsdocClosing(REPO_ROOT, { under: 'imgs/icon_anime' })
	if (issues.length) {
		const sample = issues.slice(0, 8).map(i => `${i.path}:${i.line}`).join('\n')
		assert(false, `Inline JSDoc closing in icon_anime (${issues.length}):\n${sample}`)
	}
})
