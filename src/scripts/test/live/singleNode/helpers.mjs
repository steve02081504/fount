/**
 * 单节点 live 探针共用断言与汇总。
 */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/require-param-type -- live probe harness */
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
 * @param {string} base
 * @param {string} key
 */
function nodeHandle(base, key) {
	return { base: base.trim().replace(/\/+$/, ''), key: key.trim() }
}

/**
 * @param {object} [options]
 * @param {string} [options.base]
 * @param {string} [options.key]
 */
export function createSingleNodeProbe(options = {}) {
	const base = options.base ?? requireLiveBaseUrl()
	const key = options.key ?? requireLiveApiKey()
	const node = nodeHandle(base, key)

	/** @param {string} method @param {string} path @param {unknown} [body] @param {number} [timeoutSec] */
	function chatApi(method, path, body, timeoutSec = 60) {
		return invokeRequest(node, method, path, body, { timeoutSec, shell: 'chat' })
	}

	/** @param {string} method @param {string} path @param {unknown} [body] @param {number} [timeoutSec] */
	async function chatApiJson(method, path, body, timeoutSec = 90) {
		const response = await chatApi(method, path, body, timeoutSec)
		if (response.status < 200 || response.status >= 300) {
			if (response.raw) throw new Error(`HTTP ${response.status}: ${response.raw}`)
			throw new Error(`HTTP ${response.status} ${method} ${path}`)
		}
		return response.json
	}

	/** @param {string} method @param {string} path @param {Record<string,string|number|boolean>} fields @param {string} fileField @param {string} fileName @param {Uint8Array} fileBytes @param {string} [contentType] */
	function chatApiMultipart(method, path, fields, fileField, fileName, fileBytes, contentType = 'image/png') {
		return invokeMultipart(node, 'chat', method, path, fields, fileField, fileName, fileBytes, contentType)
	}

	/** @param {() => boolean | Promise<boolean>} predicate @param {number} [timeoutSec] @param {number} [intervalSec] */
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
 * @param {string} shell
 * @param {object} [options]
 * @param {string} [options.base]
 * @param {string} [options.key]
 */
export function createShellProbe(shell, options = {}) {
	const base = options.base ?? requireLiveBaseUrl()
	const key = options.key ?? requireLiveApiKey()
	const node = nodeHandle(base, key)

	/** @param {string} method @param {string} path @param {unknown} [body] @param {number} [timeoutSec] */
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
 * @param {string} name
 * @param {() => boolean | Promise<boolean>} fn
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
 * @param {string} name
 * @param {string} why
 */
export function skipCase(name, why) {
	skip++
	console.log(`  skip  ${name} (${why})`)
}

/** @param {string} title */
export function writeLiveSection(title) {
	console.log(`\n=== ${title} ===`)
}

/** @param {string} tag */
export function writeLiveSummary(tag) {
	console.log('\n========================================')
	console.log(`${tag}  PASS=${pass}  FAIL=${fail}  SKIP=${skip}`)
	if (failures.length) {
		console.log('FAILURES:')
		for (const row of failures) console.log(`  - ${row}`)
	}
	console.log('========================================')
}

/** @returns {never} */
export function completeLiveScript() {
	if (fail > 0) process.exit(1)
}
