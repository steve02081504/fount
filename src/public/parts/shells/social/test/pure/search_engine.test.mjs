/**
 * 共享搜索引擎纯测试。
 */
/* global Deno */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { indexDocument, queryIndex, removeDocument, patchShardMeta } from 'fount/scripts/search/invertedIndex.mjs'
import { tokenizeForIndex, tokenizeForQuery } from 'fount/scripts/search/tokenize.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('tokenize mixes cjk bigrams and latin words', () => {
	const tokens = tokenizeForIndex('你好世界 hello #tag')
	assertEquals(tokens.includes('你好'), true)
	assertEquals(tokens.includes('好世'), true)
	assertEquals(tokens.includes('世界'), true)
	assertEquals(tokens.includes('hello'), true)
	assertEquals(tokens.includes('#tag'), true)
})

Deno.test('queryIndex verifies substring truth after bigram recall', async () => {
	const indexDir = mkdtempSync(join(tmpdir(), 'fount_search_test_'))
	try {
		await indexDocument(indexDir, 's1', {
			id: 'exact',
			text: '这是测试文本内容',
			ts: 1,
			fields: {},
		})
		await indexDocument(indexDir, 's1', {
			id: 'partial',
			text: '这是测试另一段内容',
			ts: 2,
			fields: {},
		})
		const hits = await queryIndex({
			indexDir,
			shardKeys: ['s1'],
			query: '测试文本',
			limit: 10,
			/**
			 * 倒排索引候选二次校验。
			 * @param {object} doc 索引文档行
			 * @returns {boolean} 正文是否包含查询子串
			 */
			verify: doc => doc.text.includes('测试文本'),
		})
		assertEquals(hits.length, 1)
		assertEquals(hits[0].id, 'exact')
		await removeDocument(indexDir, 's1', 'exact')
		const afterRemove = await queryIndex({
			indexDir,
			shardKeys: ['s1'],
			query: '测试文本',
			limit: 10,
			/**
			 * 倒排索引候选二次校验。
			 * @param {object} doc 索引文档行
			 * @returns {boolean} 正文是否包含查询子串
			 */
			verify: doc => doc.text.includes('测试文本'),
		})
		assertEquals(afterRemove.length, 0)
	}
	finally {
		rmSync(indexDir, { recursive: true, force: true })
	}
})

Deno.test('patchShardMeta stores coverage watermark', async () => {
	const indexDir = mkdtempSync(join(tmpdir(), 'fount_search_test_'))
	try {
		const meta = await patchShardMeta(indexDir, 'ch1', { coverage: { '2026-01': true } })
		assertEquals(meta.coverage?.['2026-01'], true)
	}
	finally {
		rmSync(indexDir, { recursive: true, force: true })
	}
})

Deno.test('tokenizeForQuery matches index tokens', () => {
	assertEquals(tokenizeForQuery('测试').sort().join(','), tokenizeForIndex('测试').sort().join(','))
})
