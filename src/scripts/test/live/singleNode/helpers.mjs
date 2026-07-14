/**
 * 单节点 live 探针共用断言与汇总。
 */
import process from 'node:process'

import { allowNoise } from '../../core/allowNoise.mjs'
import { requireLiveApiKey, requireLiveBaseUrl } from '../env.mjs'
import { invokeMultipart, invokeRequest, sleep } from '../http.mjs'

/** @typedef {import('../http.mjs').LiveHttpResponse} LiveHttpResponse */

let pass = 0
let fail = 0
let skip = 0
/** @type {string[]} */
const failures = []

/**
 * @param {string} base 基址 URL
 * @param {string} key 键
 * @returns {import('../http.mjs').LiveNodeHandle} 节点句柄
 */
function nodeHandle(base, key) {
	return { base: base.trim().replace(/\/+$/, ''), key: key.trim() }
}

/**
 * @param {object} [options] 选项
 * @param {string} [options.base] 基址 URL
 * @param {string} [options.key] API key
 * @returns {ReturnType<typeof createSingleNodeProbe>} 单节点探针工具集
 */
export function createSingleNodeProbe(options = {}) {
	const base = options.base ?? requireLiveBaseUrl()
	const key = options.key ?? requireLiveApiKey()
	const node = nodeHandle(base, key)

	/**
	 * @param {string} method @param {string} path @param {unknown} [body] @param {number} [timeoutSec]
	 * @param {string} path 路径
	 * @param {object | undefined} body 请求体
	 * @param {number} [timeoutSec] 超时秒数
	 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} Chat API 响应
	 */
	function chatApi(method, path, body, timeoutSec = 60) {
		return invokeRequest(node, method, path, body, { timeoutSec, shell: 'chat' })
	}

	/**
	 * @param {string} method @param {string} path @param {unknown} [body] @param {number} [timeoutSec]
	 * @param {string} path 路径
	 * @param {object | undefined} body 请求体
	 * @param {number} [timeoutSec] 超时秒数
	 * @returns {Promise<unknown>} 解析后的 JSON 响应体
	 */
	async function chatApiJson(method, path, body, timeoutSec = 90) {
		const response = await chatApi(method, path, body, timeoutSec)
		if (response.status < 200 || response.status >= 300) {
			if (response.raw) throw new Error(`HTTP ${response.status}: ${response.raw}`)
			throw new Error(`HTTP ${response.status} ${method} ${path}`)
		}
		return response.json
	}

	/**
	 * @param {string} method @param {string} path @param {Record<string,string|number|boolean>} fields @param {string} fileField @param {string} fileName @param {Uint8Array} fileBytes @param {string} [contentType]
	 * @param {string} path 路径
	 * @param {Record<string, string>} fields 表单字段
	 * @param {string} fileField 表单文件字段名
	 * @param {string} fileName 文件名
	 * @param {Uint8Array | Buffer} fileBytes 文件字节
	 * @param {string} [contentType] MIME 类型
	 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} multipart 响应
	 */
	function chatApiMultipart(method, path, fields, fileField, fileName, fileBytes, contentType = 'image/png') {
		return invokeMultipart(node, 'chat', method, path, fields, fileField, fileName, fileBytes, contentType)
	}

	/**
	 * @param {() => boolean | Promise<boolean>} predicate @param {number} [timeoutSec] @param {number} [intervalSec]
	 * @param {number} [timeoutSec] 超时秒数
	 * @param {number} [intervalSec] 轮询间隔秒
	 * @returns {Promise<boolean>} 超时前是否满足条件
	 */
	async function pollUntil(predicate, timeoutSec = 30, intervalSec = 0.4) {
		const deadline = Date.now() + timeoutSec * 1000
		while (Date.now() < deadline) {
			if (await predicate()) return true
			await sleep(intervalSec * 1000)
		}
		return false
	}

	return {
		node,
		chatApi,
		chatApiJson,
		chatApiMultipart,
		pollUntil,
		testCase,
		skipCase,
		writeLiveSection,
		writeLiveSummary,
		completeLiveScript,
		allowNoise,
	}
}

/**
 * @param {string} shell shell 名
 * @param {object} [options] 选项
 * @param {string} [options.base] 基址 URL
 * @param {string} [options.key] API key
 * @returns {object} shell 探针工具集
 */
export function createShellProbe(shell, options = {}) {
	const base = options.base ?? requireLiveBaseUrl()
	const key = options.key ?? requireLiveApiKey()
	const node = nodeHandle(base, key)

	/**
	 * @param {string} method @param {string} path @param {unknown} [body] @param {number} [timeoutSec]
	 * @param {string} path 路径
	 * @param {object | undefined} body 请求体
	 * @param {number} [timeoutSec] 超时秒数
	 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} shell API 响应
	 */
	function shellApi(method, path, body, timeoutSec = 60) {
		return invokeRequest(node, method, path, body, { timeoutSec, shell })
	}

	return {
		node,
		shellApi,
		testCase,
		skipCase,
		writeLiveSection,
		writeLiveSummary,
		completeLiveScript,
	}
}

/**
 * @param {string} name 名称
 * @param {() => boolean | Promise<boolean>} fn 回调
 * @returns {Promise<void>} 无
 */
export async function testCase(name, fn) {
	try {
		const ok = await fn()
		if (ok === false) {
			fail++
			failures.push(name)
			console.log(`  FAIL  ${name}`)
		}
		else {
			pass++
			console.log(`  ok    ${name}`)
		}
	}
	catch (error) {
		fail++
		failures.push(`${name} :: ${error.message}`)
		console.log(`  FAIL  ${name} :: ${error.message}`)
	}
}

/**
 * @param {string} name 名称
 * @param {string} why 原因说明
 * @returns {void} 无
 */
export function skipCase(name, why) {
	skip++
	console.log(`  skip  ${name} (${why})`)
}

/**
 * @param {string} title 小节标题
 * @returns {void} 无
 */
export function writeLiveSection(title) {
	console.log(`\n=== ${title} ===`)
}

/**
 * @param {string} tag 汇总标签
 * @returns {void} 无
 */
export function writeLiveSummary(tag) {
	console.log('\n========================================')
	console.log(`${tag}  PASS=${pass}  FAIL=${fail}  SKIP=${skip}`)
	if (failures.length) {
		console.log('FAILURES:')
		for (const row of failures) console.log(`  - ${row}`)
	}
	console.log('========================================')
}

/**
 * @returns {never} 失败时退出进程
 */
export function completeLiveScript() {
	if (fail > 0) process.exit(1)
}
