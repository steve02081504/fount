/**
 * 单节点 live 探针共用断言与汇总。
 */
import process from 'node:process'

import { allowNoise } from '../../core/allowNoise.mjs'
import { requireLiveApiKey, requireLiveBaseUrl } from '../env.mjs'
import { invokeMultipart, invokeRequest, okStatus, pollUntil as pollUntilHttp } from '../http.mjs'
import { createLiveShellHttp } from '../wsHarness.mjs'

/** @typedef {import('../http.mjs').LiveHttpResponse} LiveHttpResponse */

let pass = 0
let fail = 0
let skip = 0
/** @type {string[]} */
const failures = []

/**
 * @param {object} [options] 选项
 * @param {string} [options.base] 基址 URL
 * @param {string} [options.key] API key
 * @returns {{ node: { base: string, key: string }, chatApi: Function, chatApiJson: Function, chatApiMultipart: Function, pollUntil: Function, okStatus: typeof okStatus, testCase: typeof testCase, skipCase: typeof skipCase, writeLiveSection: typeof writeLiveSection, writeLiveSummary: typeof writeLiveSummary, completeLiveScript: typeof completeLiveScript, allowNoise: typeof allowNoise }} 单节点探针（`okStatus`/`pollUntil` 来自 `http.mjs`）
 */
export function createSingleNodeProbe(options = {}) {
	const base = options.base ?? requireLiveBaseUrl()
	const key = options.key ?? requireLiveApiKey()
	const node = { base: base.trim().replace(/\/+$/, ''), key: key.trim() }

	/**
	 * @param {string} method HTTP 方法
	 * @param {string} path 路径
	 * @param {object} [body] 请求体
	 * @param {number} [timeoutSec] 超时秒数
	 * @returns {Promise<LiveHttpResponse>} Chat API 响应
	 */
	function chatApi(method, path, body, timeoutSec = 60) {
		return invokeRequest(node, method, path, body, { timeoutSec, shell: 'chat' })
	}

	/**
	 * @param {string} method HTTP 方法
	 * @param {string} path 路径
	 * @param {object} [body] 请求体
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
	 * @param {string} method HTTP 方法
	 * @param {string} path 路径
	 * @param {Record<string, string>} fields 表单字段
	 * @param {string} fileField 表单文件字段名
	 * @param {string} fileName 文件名
	 * @param {Uint8Array | Buffer} fileBytes 文件字节
	 * @param {string} [contentType] MIME 类型
	 * @returns {Promise<LiveHttpResponse>} multipart 响应
	 */
	function chatApiMultipart(method, path, fields, fileField, fileName, fileBytes, contentType = 'image/png') {
		return invokeMultipart(node, 'chat', method, path, fields, fileField, fileName, fileBytes, contentType)
	}

	/**
	 * @param {() => boolean | Promise<boolean>} predicate 条件
	 * @param {number} [timeoutSec] 超时秒数
	 * @param {number} [intervalSec] 轮询间隔秒
	 * @returns {Promise<boolean>} 超时前是否满足条件
	 */
	async function pollUntil(predicate, timeoutSec = 30, intervalSec = 0.4) {
		return Boolean(await pollUntilHttp(predicate, timeoutSec, intervalSec))
	}

	return {
		node,
		chatApi,
		chatApiJson,
		chatApiMultipart,
		pollUntil,
		okStatus,
		testCase,
		skipCase,
		writeLiveSection,
		writeLiveSummary,
		completeLiveScript,
		allowNoise,
	}
}

/**
 * 任意 shell 的单节点探针（底层复用 `createLiveShellHttp`）。
 * @param {string} shell shell 名
 * @param {object} [options] 选项
 * @param {string} [options.base] 基址 URL
 * @param {string} [options.key] API key
 * @returns {{ node: { base: string, key: string }, shellApi: Function, testCase: typeof testCase, skipCase: typeof skipCase, writeLiveSection: typeof writeLiveSection, writeLiveSummary: typeof writeLiveSummary, completeLiveScript: typeof completeLiveScript }} shell 探针工具集
 */
export function createShellProbe(shell, options = {}) {
	const { base, key, shellApi } = createLiveShellHttp({ shell, ...options })
	return {
		node: { base, key },
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
 * @returns {Promise<void>}
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
 * @returns {void}
 */
export function skipCase(name, why) {
	skip++
	console.log(`  skip  ${name} (${why})`)
}

/**
 * @param {string} title 小节标题
 * @returns {void}
 */
export function writeLiveSection(title) {
	console.log(`\n=== ${title} ===`)
}

/**
 * @param {string} tag 汇总标签
 * @returns {void}
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
