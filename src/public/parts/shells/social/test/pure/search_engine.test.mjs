/**
 * 共享搜索引擎纯测试。
 */
/* global Deno */
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { indexDocument, queryIndex, removeDocument, patchShardMeta } from 'fount/scripts/search/invertedIndex.mjs'
import { tokenizeForIndex, tokenizeForQuery } from 'fount/scripts/search/tokenize.mjs'
import { assertEquals } from 'jsr:@std/assert'

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

Deno.test('indexDocument does not recreate a deleted index parent tree', async () => {
	const root = mkdtempSync(join(tmpdir(), 'fount_search_gone_'))
	const groupDir = join(root, 'group')
	const indexDir = join(groupDir, 'search')
	try {
		mkdirSync(groupDir, { recursive: true })
		await indexDocument(indexDir, 's1', {
			id: 'seed',
			text: 'hello world seed',
			ts: 1,
			fields: {},
		})
		assertEquals(existsSync(join(indexDir, 's1', 'meta.json')), true)
		await rm(groupDir, { recursive: true, force: true })
		await indexDocument(indexDir, 's1', {
			id: 'after',
			text: 'hello world after leave',
			ts: 2,
			fields: {},
		})
		assertEquals(existsSync(groupDir), false, 'must not resurrect deleted group/search tree')
	}
	finally {
		rmSync(root, { recursive: true, force: true })
	}
})

Deno.test('indexDocument concurrent parent removal does not reject', async () => {
	for (let round = 0; round < 20; round++) {
		const root = mkdtempSync(join(tmpdir(), 'fount_search_race_'))
		const groupDir = join(root, 'group')
		const indexDir = join(groupDir, 'search')
		try {
			mkdirSync(groupDir, { recursive: true })
			await indexDocument(indexDir, 's1', {
				id: 'seed',
				text: 'hello world seed',
				ts: 1,
				fields: {},
			})
			const operations = []
			for (let documentIndex = 0; documentIndex < 12; documentIndex++)
				operations.push(indexDocument(indexDir, 's1', {
					id: `d${documentIndex}`,
					text: `hello world document ${documentIndex} extra tokens`,
					ts: documentIndex,
					fields: {},
				}))
			operations.push(rm(groupDir, { recursive: true, force: true }))
			await Promise.all(operations)
		}
		finally {
			rmSync(root, { recursive: true, force: true })
		}
	}
})
