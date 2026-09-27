/* global Deno */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { createWebBrowseReplyHandler, formatWebBrowseResult, parseWebBrowseCall } from '../../handler.mjs'

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
	await createWebBrowseReplyHandler({ fetchMarkdown: fetchReturning('') }).handle({}, {
		AddLongTimeLog: collectLog(missingLogs),
	}, { inner: '<question>no url</question>' })
	assertStringIncludes(missingLogs[0].content, '未找到 <url> 标签')

	const errorLogs = []
	await createWebBrowseReplyHandler({
		fetchMarkdown: fetchThrowing(new Error('<img onerror=alert(1)>')),
	}).handle({}, { AddLongTimeLog: collectLog(errorLogs) }, { inner: '<url>https://example.com</url>' })
	assertStringIncludes(errorLogs[0].content, '浏览网页“https://example.com”时出现错误')
	assertStringIncludes(errorLogs[0].content_for_show, '```')
})
