/* global Deno */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { allowNoise } from 'fount/scripts/test/core/allowNoise.mjs'

import { parseParams } from '../../../../shells/chat/src/tags/index.mjs'
import { createWebBrowseReplyHandler, formatWebBrowseResult, parseWebBrowseCall } from '../../handler.mjs'
import { extractUrls, preloadMentionedUrls } from '../../preload.mjs'

/**
 * 构造一个返回固定 Markdown 的假抓取函数。
 * @param {string} markdown - 要返回的 Markdown。
 * @returns {(url: string) => Promise<string>} 假抓取函数。
 */
function fetchReturning(markdown) {
	return async () => markdown
}

/**
 * 构造一个总是抛错的假抓取函数。
 * @param {Error} error - 要抛出的错误。
 * @returns {(url: string) => Promise<string>} 假抓取函数。
 */
function fetchThrowing(error) {
	return async () => { throw error }
}

/**
 * 构造收集工具日志的函数。
 * @param {object[]} logs - 日志数组。
 * @returns {(entry: object) => void} 收集函数。
 */
function collectLog(logs) {
	return entry => {
		logs.push(entry)
	}
}

Deno.test('parseWebBrowseCall reads the url and question tags', () => {
	assertEquals(
		parseWebBrowseCall(' <url> https://example.com/a </url>\n<question> what is it? </question> '),
		{ url: 'https://example.com/a', question: 'what is it?' },
	)
	assertEquals(parseWebBrowseCall('<question>only question</question>'), { url: undefined, question: 'only question' })
})

Deno.test('formatWebBrowseResult appends the question when present', () => {
	assertEquals(formatWebBrowseResult('https://example.com', 'body', undefined), '网页 https://example.com 的内容：\nbody')
	assertEquals(
		formatWebBrowseResult('https://example.com', 'body', 'why?'),
		'网页 https://example.com 的内容：\nbody\n\n请根据以上网页内容回答：\nwhy?',
	)
})

Deno.test('web browse defaults to AI summary with isolated context, raw mode bypasses AI', async () => {
	const logs = []
	const prompts = []
	const source = {
		/**
		 * @param {object} prompt 临时提示。
		 * @param {object} options 生成选项。
		 * @returns {Promise<void>} 完成。
		 */
		StructCall: async (prompt, options) => { prompts.push(prompt); options.base_result.content = 'AI summary' } }
	const handler = createWebBrowseReplyHandler({ fetchMarkdown: fetchReturning('full page'),
		/**
		 * @param {object} args 请求。
		 * @returns {Promise<object>} 服务源。
		 */
		resolveSource: async args => args.ai_source })
	const args = { ai_source: source, chat_log: [{ role: 'user', content: 'PRIVATE HISTORY' }], AddLongTimeLog: collectLog(logs) }
	await handler.handle({}, args, { params: parseParams(handler.pattern.params, {}), inner: '<url>https://example.com</url><question>why?</question>' })
	assertEquals(prompts.length, 1)
	assertStringIncludes(prompts[0].chat_log[0].content, 'full page')
	assert(!JSON.stringify(prompts[0]).includes('PRIVATE HISTORY'))
	assertEquals(prompts[0].plugin_prompts, {})
	assertStringIncludes(logs[0].content, 'AI summary')
	await handler.handle({}, args, { params: parseParams(handler.pattern.params, { summarize: 'false' }), inner: '<url>https://example.com</url>' })
	assertEquals(prompts.length, 1)
	assertStringIncludes(logs[1].content, 'full page')
})

Deno.test('URL preload persists metadata, normalizes fragments and is idempotent across requests', async () => {
	assertEquals(extractUrls('[page](https://example.com/a#x) https://example.com/a#y, file:///a'), ['https://example.com/a'])
	const logs = [{ role: 'user', content: 'See https://example.com/a#x' }]
	let fetches = 0
	const options = {
		/**
		 * @returns {Promise<string>} 元信息。
		 */
		fetchMetadata: async () => { fetches++; return '<unsafe> title' } }
	const args = { char_id: 'test', chat_log: logs, AddLongTimeLog: collectLog(logs) }
	await preloadMentionedUrls(args, options)
	await preloadMentionedUrls(args, options)
	await preloadMentionedUrls({ char_id: 'test', chat_log: logs, AddLongTimeLog: collectLog(logs) }, options)
	assertEquals(fetches, 1)
	assertEquals(logs[1].role, 'tool')
	assertStringIncludes(logs[1].id, 'web-browse-preload:')
	assertStringIncludes(logs[1].content_for_show, '```')
	assertEquals(logs[1].extension.pluginData['web-browse'].urls, ['https://example.com/a'])
})

Deno.test('URL preload bounds each request and records failures without retrying them', async () => {
	const logs = [{ role: 'user', content: Array.from({ length: 9 }, (_, index) => `https://example.com/${index}`).join(' ') }]
	const options = {
		/**
		 * 始终失败的元信息抓取。
		 * @returns {Promise<string>} 从不返回。
		 */
		fetchMetadata: async () => { throw new Error('offline') } }
	const args = { chat_log: logs, AddLongTimeLog: collectLog(logs) }
	await preloadMentionedUrls(args, options)
	assertEquals(logs.length, 6)
	assertStringIncludes(logs[1].content, 'offline')
	await preloadMentionedUrls(args, options)
	assertEquals(logs.length, 10)
})

Deno.test('web browse fetches the page and logs a code-fenced result', async () => {
	const logs = []
	const handler = createWebBrowseReplyHandler({ fetchMarkdown: fetchReturning('markdown of the page') })
	const result = await handler.handle({}, { AddLongTimeLog: collectLog(logs) }, {
		inner: '<url>https://example.com</url><question>summary?</question>',
	})

	assertEquals(result, { regen: true })
	assertEquals(logs.length, 1)
	assertEquals(logs[0].name, 'web-browse.browse')
	assertStringIncludes(logs[0].content, 'markdown of the page')
	assertStringIncludes(logs[0].content, '无可用 AI 服务源')
	assertStringIncludes(logs[0].content, 'summary?')
	assertStringIncludes(logs[0].content_for_show, '```')
})

Deno.test('web browse truncates over-long single lines', async () => {
	const logs = []
	const longLine = 'x'.repeat(3000)
	await createWebBrowseReplyHandler({ fetchMarkdown: fetchReturning(`short\n${longLine}`) }).handle({}, {
		AddLongTimeLog: collectLog(logs),
	}, { inner: '<url>https://example.com</url>' })
	assertStringIncludes(logs[0].content, '本行已截断')
	assertStringIncludes(logs[0].content, 'short')
	assert(!logs[0].content.includes(longLine))
})

Deno.test('web browse passes the formatted result through the output guard', async () => {
	const logs = []
	const guardedCalls = []
	/**
	 * 记录调用参数的假护栏。
	 * @param {string} text - 待护栏文本。
	 * @param {object} options - 护栏选项。
	 * @returns {Promise<{text: string, truncated: boolean, omitted: number, savedPath: null}>} 固定护栏结果。
	 */
	const guardOutput = async (text, options) => {
		guardedCalls.push({ text, options })
		return { text: 'GUARDED', truncated: false, omitted: 0, savedPath: null }
	}
	await createWebBrowseReplyHandler({ fetchMarkdown: fetchReturning('page body'), guardOutput }).handle({}, {
		AddLongTimeLog: collectLog(logs),
	}, { inner: '<url>https://example.com/x</url><question>why?</question>' })

	assertEquals(guardedCalls.length, 1)
	assertStringIncludes(guardedCalls[0].text, 'page body')
	assertStringIncludes(guardedCalls[0].text, 'why?')
	assertEquals(guardedCalls[0].options.name, 'web-browse')
	assertEquals(logs[0].content, 'GUARDED')
})

Deno.test('web browse dumps oversized content to a temp file via the default guard', async () => {
	const logs = []
	const markdown = 'HEAD' + 'A'.repeat(30_000) + 'TAIL'
	await createWebBrowseReplyHandler({ fetchMarkdown: fetchReturning(markdown) }).handle({}, {
		AddLongTimeLog: collectLog(logs),
	}, { inner: '<url>https://example.com/big</url>' })

	assertStringIncludes(logs[0].content, '完整内容已保存到')
	assertStringIncludes(logs[0].content, '本行已截断')
})

Deno.test('web browse reports a missing url and a fetch failure without leaking raw html', async () => {
	const missingLogs = []
	const missingResult = await createWebBrowseReplyHandler({ fetchMarkdown: fetchReturning('') }).handle({}, {
		AddLongTimeLog: collectLog(missingLogs),
	}, { inner: '<question>no url</question>' })
	assertStringIncludes(missingLogs[0].content, '未找到 <url> 标签')
	assertEquals(missingResult, { regen: true, failed: true })

	const errorLogs = []
	const errorResult = await allowNoise('web browse failed:', () =>
		createWebBrowseReplyHandler({
			fetchMarkdown: fetchThrowing(new Error('<img onerror=alert(1)>')),
		}).handle({}, { AddLongTimeLog: collectLog(errorLogs) }, { inner: '<url>https://example.com</url>' }))
	assertStringIncludes(errorLogs[0].content, '浏览网页“https://example.com”时出现错误')
	assertStringIncludes(errorLogs[0].content_for_show, '```')
	assertEquals(errorResult, { regen: true, failed: true })
})
