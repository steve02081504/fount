/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { createWebSearchReplyHandler, formatSearchResults } from '../../handler.mjs'

/**
 * 构造一个记录查询并返回固定结果的假搜索源。
 * @param {object[]} calls - 调用记录。
 * @param {object} results - 返回结果。
 * @returns {object} 假搜索源。
 */
function fakeSearchSource(calls, results) {
	return {
		/**
		 * 执行搜索。
		 * @param {string} query - 查询词。
		 * @param {object} options - 选项。
		 * @returns {Promise<object>} 搜索结果。
		 */
		Search: async (query, options) => {
			calls.push({ query, options })
			return results
		},
	}
}

/**
 * 构造前两次失败、第三次成功的假搜索源。
 * @param {object[]} calls - 调用记录。
 * @returns {object} 假搜索源。
 */
function fakeFlakySource(calls) {
	return {
		/**
		 * 执行搜索。
		 * @returns {Promise<object>} 空搜索结果。
		 */
		Search: async () => {
			calls.push({})
			if (calls.length < 3) throw new Error('temporary failure')
			return { results: [] }
		},
	}
}

/**
 * 构造返回固定搜索源的 getSearchSource。
 * @param {object | undefined} source - 搜索源。
 * @returns {() => object | undefined} getSearchSource 函数。
 */
function sourceGetter(source) {
	return () => source
}

/**
 * 收集工具日志的函数。
 * @param {object[]} logs - 日志数组。
 * @returns {(entry: object) => void} 收集函数。
 */
function collectLog(logs) {
	return entry => {
		logs.push(entry)
	}
}

/**
 * 立即完成的无操作等待。
 * @returns {Promise<void>} 立即完成。
 */
function noSleep() {
	return Promise.resolve()
}

/**
 * 不做重试，直接执行一次搜索。
 * @param {() => Promise<any>} search - 搜索操作。
 * @returns {Promise<any>} 搜索结果。
 */
function noRetry(search) {
	return search()
}

Deno.test('formatSearchResults handles empty results and labels multi-query results', () => {
	assertEquals(formatSearchResults('fount', { results: [] }, false), '未找到相关搜索结果。')
	assertEquals(
		formatSearchResults('fount', { results: [{ title: 'Fount', link: 'https://example.com', description: 'A framework', source: 'Example' }] }, true),
		'对于“fount”的搜索：\n搜索结果：\n1. [Example] Fount\n   https://example.com\nA framework',
	)
})

Deno.test('web search splits queries, searches each with a five-result limit, and logs safe output', async () => {
	const calls = []
	const logs = []
	const handler = createWebSearchReplyHandler({
		getSearchSource: sourceGetter(fakeSearchSource(calls, { results: [{ title: '<img onerror=alert(1)>', link: 'https://example.com', description: 'description' }] })),
		retry: noRetry,
	})

	const result = await handler.handle({}, {
		AddLongTimeLog: collectLog(logs),
	}, { inner: ' first query \n\n second query ' })

	assertEquals(result, { regen: true })
	assertEquals(calls, [
		{ query: 'first query', options: { limit: 5 } },
		{ query: 'second query', options: { limit: 5 } },
	])
	assertEquals(logs.length, 2)
	assertStringIncludes(logs[0].content, '对于“first query”的搜索')
	assertStringIncludes(logs[0].content_for_show, '```')
	assertEquals(logs[0].name, 'web-search.search')
})

Deno.test('web search reports a missing source and retries failed searches', async () => {
	const missingSourceLogs = []
	const missingSourceHandler = createWebSearchReplyHandler({ getSearchSource: sourceGetter(undefined) })
	await missingSourceHandler.handle({}, {
		AddLongTimeLog: collectLog(missingSourceLogs),
	}, { inner: 'query' })
	assertStringIncludes(missingSourceLogs[0].content, '未找到可用的搜索源')

	const calls = []
	const logs = []
	const handler = createWebSearchReplyHandler({
		getSearchSource: sourceGetter(fakeFlakySource(calls)),
		sleep: noSleep,
	})
	await handler.handle({}, {
		AddLongTimeLog: collectLog(logs),
	}, { inner: 'query' })
	assertEquals(calls.length, 3)
	assertStringIncludes(logs[0].content, '未找到相关搜索结果')
})
