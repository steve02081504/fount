/**
 * 资料 links 的 href 清扫（Deno-pure）：http(s) 原样；fount: 走 protocol 页。
 */
import { wrapProtocolHttpsUrl } from './runUri.mjs'

/**
 * @param {string} raw 原始链接
 * @returns {string|null} 可写入 `<a href>` 的 URL
 */
export function safeProfileLink(raw) {
	const text = String(raw || '').trim()
	if (!text) return null
	if (/^fount:/i.test(text)) try {
		const url = new URL(text)
		if (url.protocol.toLowerCase() !== 'fount:') return null
		return wrapProtocolHttpsUrl(text)
	}
	catch {
		return null
	}

	try {
		const url = new URL(text, typeof location !== 'undefined' ? location.origin : 'http://localhost')
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
	}
	catch {
		return null
	}
}
