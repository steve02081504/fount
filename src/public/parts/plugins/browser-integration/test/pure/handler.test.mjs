/* global Deno */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { flattenReplyHandlers } from '../../../../shells/chat/src/reply/defineReplyHandler.mjs'
import {
	createBrowserIntegrationReplyHandler,
	handleBrowserJsCallback,
	parseDanmakuOptions,
	resolvePageId,
} from '../../handler.mjs'
import { registerChannel } from '../../state.mjs'

/**
 * 构造一个记录运行 JS 调用的假浏览器集成 API。
 * @param {object[]} jsCalls - 运行 JS 的调用记录。
 * @returns {object} 假 API。
 */
function makeFakeApi(jsCalls) {
	return {
		/**
		 * 返回焦点页面。
		 * @returns {object} 页面信息。
		 */
		getFocusedPageInfo: () => ({ id: 1, url: 'https://a', title: 'A', hasFocus: true }),
		/**
		 * 返回最近页面。
		 * @returns {object} 页面信息。
		 */
		getMostRecentPageInfo: () => ({ id: 2, url: 'https://b', title: 'B', hasFocus: false }),
		/**
		 * 记录一次运行 JS。
		 * @param {string} username - 用户名。
		 * @param {number} pageId - 页面 ID。
		 * @param {string} script - 脚本。
		 * @param {object} callbackInfo - 回调信息。
		 * @returns {Promise<object>} 运行结果。
		 */
		runJsOnPage: async (username, pageId, script, callbackInfo) => {
			jsCalls.push({ username, pageId, script, callbackInfo })
			return { result: 1 }
		},
	}
}

/**
 * 构造返回固定假 API 的 getApi。
 * @param {object} api - 假 API。
 * @returns {() => Promise<object>} getApi 函数。
 */
function apiGetter(api) {
	return async () => api
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

/**
 * 找到指定名字的叶子 handler。
 * @param {object} handler - 组合 handler。
 * @param {string} name - 工具名。
 * @returns {object} 叶子 handler。
 */
function findHandler(handler, name) {
	const leaf = flattenReplyHandlers(handler).find(candidate => candidate.name === name)
	if (!leaf) throw new Error(`handler not found: ${name}`)
	return leaf
}

Deno.test('resolvePageId resolves aliases and numeric ids', () => {
	const api = makeFakeApi([])
	assertEquals(resolvePageId(api, 'u', 'focused'), 1)
	assertEquals(resolvePageId(api, 'u', 'mostRecent'), 2)
	assertEquals(resolvePageId(api, 'u', ' 7 '), 7)
	let error
	try { resolvePageId(api, 'u', '') }
	catch (caught) { error = caught }
	assertStringIncludes(error.message, '缺少页面 ID')
})

Deno.test('parseDanmakuOptions reads required and optional tags', () => {
	assertEquals(parseDanmakuOptions('<content> hi </content>'), { content: 'hi' })
	assertEquals(
		parseDanmakuOptions('<content>hi</content><speed>5</speed><color>red</color><fontSize>30</fontSize><yPos>0.5</yPos>'),
		{ content: 'hi', speed: 5, color: 'red', fontSize: 30, yPos: 0.5 },
	)
})

Deno.test('run-js-on-page forwards a plugin callback token and logs safe output', async () => {
	const jsCalls = []
	const logs = []
	const handler = createBrowserIntegrationReplyHandler({
		/** 注入记录调用的 fake 浏览器 API 取值器。 */
		getApi: apiGetter(makeFakeApi(jsCalls))
	})
	const runJs = findHandler(handler, 'browser-integration.run-js-on-page')
	const result = await runJs.handle({}, {
		username: 'u',
		char_id: 'c',
		AddLongTimeLog: collectLog(logs),
	}, { inner: '<pageId>mostRecent</pageId><script>return 42</script>' })

	assertEquals(result, { regen: true })
	assertEquals(jsCalls, [{
		username: 'u',
		pageId: 2,
		script: 'return 42',
		callbackInfo: { partpath: 'plugins/browser-integration', char_id: 'c' },
	}])
	assertEquals(logs.length, 1)
	assertStringIncludes(logs[0].content, '运行 JS 的结果')
	assertStringIncludes(logs[0].content_for_show, '```')
})

Deno.test('get-visible-html guards oversized page HTML', async () => {
	const logs = []
	const api = {
		...makeFakeApi([]),
		/**
		 * 返回超长可见 HTML。
		 * @returns {Promise<{html: string}>} 可见 HTML。
		 */
		getVisibleHtml: async () => ({ html: 'H'.repeat(30_000) }),
	}
	const handler = createBrowserIntegrationReplyHandler({
		/** 注入带超长可见 HTML 的 fake API 取值器。 */
		getApi: apiGetter(api)
	})
	const getVisible = findHandler(handler, 'browser-integration.get-visible-html')
	await getVisible.handle({}, {
		username: 'u',
		char_id: 'c',
		AddLongTimeLog: collectLog(logs),
	}, { inner: '1' })
	assertStringIncludes(logs[0].content, '完整内容已保存到')
	assertStringIncludes(logs[0].content, '本行已截断')
})

Deno.test('run-js-on-page compresses long identical-line runs in the result', async () => {
	const logs = []
	const api = {
		...makeFakeApi([]),
		/**
		 * 返回一个含大量连续重复行的脚本结果。
		 * @returns {Promise<object>} 运行结果。
		 */
		runJsOnPage: async () => ({ result: ['same line', ...Array.from({ length: 3000 }, () => 'same line')] }),
	}
	const handler = createBrowserIntegrationReplyHandler({
		/** 注入返回重复行结果的 fake API 取值器。 */
		getApi: apiGetter(api)
	})
	const runJs = findHandler(handler, 'browser-integration.run-js-on-page')
	await runJs.handle({}, {
		username: 'u',
		char_id: 'c',
		AddLongTimeLog: collectLog(logs),
	}, { inner: '<pageId>1</pageId><script>return list</script>' })
	assert(logs[0], '应写入工具日志')
	assertStringIncludes(logs[0].content, '已省略', '连续重复行应被压缩')
	assert(!logs[0].content.includes('\'same line\',\n  \'same line\',\n  \'same line\',\n  \'same line\''), '不应保留巨量重复行')
})

Deno.test('run-js-on-page reports a missing script tag', async () => {
	const logs = []
	const handler = createBrowserIntegrationReplyHandler({
		/** 注入空 fake 浏览器 API 的取值器。 */
		getApi: apiGetter(makeFakeApi([]))
	})
	const runJs = findHandler(handler, 'browser-integration.run-js-on-page')
	await runJs.handle({}, {
		username: 'u',
		char_id: 'c',
		AddLongTimeLog: collectLog(logs),
	}, { inner: '<pageId>1</pageId>' })
	assertStringIncludes(logs[0].content, '缺少 <script> 标签')
})

Deno.test('browser JS callback is injected into the registered channel and wakes it', async () => {
	const entries = []
	const wakes = []
	registerChannel('callback-user', 'callback-char', {
		chat_name: 'c1',
		AppendChatLogEntry: collectLog(entries),
		/** 记录一次唤醒请求。 @returns {Promise<void>} */
		RequestCharReply: async () => { wakes.push(true) },
	})
	await handleBrowserJsCallback({
		username: 'callback-user',
		data: { ok: true },
		pageId: 3,
		script: 'callback({ ok: true })',
		char_id: 'callback-char',
	})
	assertEquals(entries.length, 1)
	assertEquals(entries[0].role, 'system')
	assertEquals(entries[0].charVisibility, ['callback-char'])
	assertStringIncludes(entries[0].content, 'callback 函数被调用了')
	assertStringIncludes(entries[0].content_for_show, '```')
	assertEquals(wakes.length, 1, '应在追加后请求一次唤醒')
})

Deno.test('browser JS callback guards oversized payloads', async () => {
	const entries = []
	registerChannel('callback-big-user', 'callback-big-char', {
		chat_name: 'c2',
		AppendChatLogEntry: collectLog(entries),
		/** 记录一次唤醒请求。 @returns {Promise<void>} */
		RequestCharReply: async () => { },
	})
	await handleBrowserJsCallback({
		username: 'callback-big-user',
		data: ['x'.repeat(10_000), 'y'.repeat(10_000), 'z'.repeat(10_000)],
		pageId: 1,
		script: 'callback()',
		char_id: 'callback-big-char',
	})
	assertEquals(entries.length, 1)
	assertStringIncludes(entries[0].content, '完整内容已保存到')
})
