/**
 * 共享 KV 客户端（经 hub `/shared-store/:namespace/:key`）。
 */
import { getTestHubBaseUrl } from '../base_url.mjs'

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
 * 读本次测试运行共享 KV。
 * @param {string} namespace 分区（如 `cdn`、`fixture`）
 * @param {string} key 键
 * @returns {Promise<unknown | undefined>} 值；缺失 / 无 hub 为 undefined
 */
export async function hubSharedStoreGet(namespace, key) {
	const url = sharedStoreUrl(namespace, key)
	if (!url) return undefined
	try {
		const res = await fetch(url)
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
		const res = await fetch(url, {
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
		const res = await fetch(url, { method: 'DELETE' })
		return res.ok
	}
	catch {
		return false
	}
}
