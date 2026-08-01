/**
 * 共享 KV 客户端（经 hub `/shared-store/:namespace/:key`）。
 */
import { getTestHubBaseUrl } from '../base_url.mjs'

/** hub shared-store 有界超时（毫秒）。 */
const SHARED_STORE_FETCH_TIMEOUT_MS = 10_000

/**
 * @param {string} namespace 分区
 * @param {string} key 键
 * @returns {string | null} 请求 URL；无 hub 为 null
 */
function sharedStoreUrl(namespace, key) {
	const base = getTestHubBaseUrl()
	if (!base) return null
	return `${base}/shared-store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`
}

/**
 * @param {string} url 请求地址
 * @param {RequestInit} [init] fetch 选项
 * @returns {Promise<Response>} 响应
 */
async function sharedStoreFetch(url, init = {}) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), SHARED_STORE_FETCH_TIMEOUT_MS)
	try {
		return await fetch(url, { ...init, signal: controller.signal })
	}
	finally {
		clearTimeout(timer)
	}
}

/**
 * 读本次测试运行共享 KV。
 * @param {string} namespace 分区（如 `cdn`、`fixture`）
 * @param {string} key 键
 * @returns {Promise<unknown | undefined>} 值；缺失 / 无 hub 为 undefined
 */
export async function hubSharedStoreGet(namespace, key) {
	const url = sharedStoreUrl(namespace, key)
	if (!url) return undefined
	try {
		const res = await sharedStoreFetch(url)
		if (!res.ok) return undefined
		return await res.json()
	}
	catch {
		return undefined
	}
}

/**
 * 写本次测试运行共享 KV。
 * @param {string} namespace 分区
 * @param {string} key 键
 * @param {unknown} value JSON 可序列化值
 * @returns {Promise<boolean>} 是否写入成功
 */
export async function hubSharedStoreSet(namespace, key, value) {
	const url = sharedStoreUrl(namespace, key)
	if (!url) return false
	try {
		const res = await sharedStoreFetch(url, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(value),
		})
		return res.ok
	}
	catch {
		return false
	}
}

/**
 * 删本次测试运行共享 KV 条目。
 * @param {string} namespace 分区
 * @param {string} key 键
 * @returns {Promise<boolean>} 是否删除成功（无 hub 为 false）
 */
export async function hubSharedStoreDelete(namespace, key) {
	const url = sharedStoreUrl(namespace, key)
	if (!url) return false
	try {
		const res = await sharedStoreFetch(url, { method: 'DELETE' })
		return res.ok
	}
	catch {
		return false
	}
}
