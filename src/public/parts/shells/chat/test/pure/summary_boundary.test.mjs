/**
 * 摘要边界纯函数：最新可见 summary 条目胜出，原始条目保留。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { isSummaryEntry } from '../../../../../../decl/chatLog.ts'
import { applySummaryBoundary } from '../../src/prompt_struct/summaryBoundary.mjs'

/**
 * 始终可见的判定函数。
 * @returns {boolean} 恒为 true
 */
const alwaysVisible = () => true

Deno.test('isSummaryEntry only matches type=summary', () => {
	assertEquals(isSummaryEntry({ type: 'summary' }), true)
	assertEquals(isSummaryEntry({ type: 'other' }), false)
	assertEquals(isSummaryEntry({}), false)
})

Deno.test('applySummaryBoundary slices from the newest visible summary', () => {
	const entries = [
		{ id: 'a', content: 'old' },
		{ id: 's1', type: 'summary', content: 'first' },
		{ id: 'b', content: 'mid' },
		{ id: 's2', type: 'summary', content: 'second' },
		{ id: 'c', content: 'new' },
	]
	assertEquals(applySummaryBoundary(entries, alwaysVisible).map(e => e.id), ['s2', 'c'])
})

Deno.test('applySummaryBoundary keeps everything when no summary exists', () => {
	const entries = [{ id: 'a' }, { id: 'b' }]
	assertEquals(applySummaryBoundary(entries, alwaysVisible).map(e => e.id), ['a', 'b'])
})

Deno.test('applySummaryBoundary skips summaries hidden from the viewer', () => {
	const entries = [
		{ id: 's1', type: 'summary', charVisibility: ['charA'] },
		{ id: 'b', content: 'mid' },
		{ id: 's2', type: 'summary', charVisibility: ['charB'] },
		{ id: 'c', content: 'new' },
	]
	/**
	 * 仅 charA 视角可见。
	 * @param {object} entry 日志条目
	 * @returns {boolean} 是否可见
	 */
	const isVisible = entry => entry.charVisibility?.includes('charA') ?? true
	assertEquals(applySummaryBoundary(entries, isVisible).map(e => e.id), ['s1', 'b', 's2', 'c'])
})

Deno.test('applySummaryBoundary does not mutate the input array', () => {
	const entries = [{ id: 'a' }, { id: 's', type: 'summary' }, { id: 'b' }]
	const snapshot = entries.slice()
	applySummaryBoundary(entries, alwaysVisible)
	assertEquals(entries, snapshot)
})
