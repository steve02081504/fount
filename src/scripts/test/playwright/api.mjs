/**
 * Playwright API 请求共用：newContext + dispose、viewer / 建群。
 */
import { request as playwrightRequest } from '@playwright/test'

/**
 * 创建一次性 APIRequestContext，在 fn 结束后 dispose。
 * @template T
 * @param {(req: import('@playwright/test').APIRequestContext) => Promise<T>} fn 请求回调
 * @returns {Promise<T>} fn 返回值
 */
export async function withApiRequest(fn) {
	const req = await playwrightRequest.newContext()
	try {
		return await fn(req)
	}
	finally {
		await req.dispose()
	}
}

/**
 * 拉取本机 operator entityHash（chat `/viewer`）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {object} [options] 选项
 * @param {number} [options.retries=0] 网络瞬时错误重试次数
 * @returns {Promise<string>} viewerEntityHash
 */
export async function fetchViewerEntityHash(baseUrl, apiKey, options = {}) {
	const retries = options.retries ?? 0
	return withApiRequest(async req => {
		const url = `${baseUrl}/api/parts/shells:chat/viewer?fount-apikey=${encodeURIComponent(apiKey)}`
		let lastErr
		for (let attempt = 0; attempt <= retries; attempt++)
			try {
				const res = await req.get(url)
				if (!res.ok()) throw new Error(`viewer failed: ${res.status()}`)
				const data = await res.json()
				if (!data.viewerEntityHash) throw new Error('viewerEntityHash missing')
				return data.viewerEntityHash
			}
			catch (err) {
				lastErr = err
				if (attempt === retries || !/ECONNRESET|ECONNREFUSED|socket hang up/i.test(String(err)))
					throw err
				await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
			}

		throw lastErr
	})
}

/**
 * 通过 Chat API 创建测试群。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {object} [options] 可选项
 * @param {string} [options.name] 群名
 * @param {string} [options.description] 描述
 * @param {string} [options.defaultChannelName] 默认频道名
 * @returns {Promise<{ groupId: string, defaultChannelId: string, channelId: string }>} 群与默认频道
 */
export async function createChatTestGroup(baseUrl, apiKey, options = {}) {
	const name = options.name ?? `pw-group-${Date.now()}`
	const body = {
		name,
		description: options.description ?? 'playwright frontend test',
		...options.defaultChannelName ? { defaultChannelName: options.defaultChannelName } : {},
	}
	return withApiRequest(async req => {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:chat/groups/?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: body },
		)
		if (!res.ok()) throw new Error(`createGroup failed: ${res.status()}`)
		const data = await res.json()
		if (!data.groupId) throw new Error('groupId missing')
		const defaultChannelId = data.defaultChannelId || 'default'
		return {
			groupId: data.groupId,
			defaultChannelId,
			channelId: defaultChannelId,
		}
	})
}
