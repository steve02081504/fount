import { redactSecrets } from '../../../../scripts/secret_filter.mjs'
import { renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'
import { hashContent, resolveEffectiveLog } from '../file-operations/src/context_files.mjs'

import { preloadQrCodes } from './qrcode.mjs'

/**
 * 从消息中提取唯一 HTTP(S) 地址。
 * @param {string} text 消息。
 * @returns {string[]} 规范化地址。
 */
export function extractUrls(text) {
	const urls = new Set()
	for (const match of String(text ?? '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
		let value = match[0].replace(/[.,;!?。，；！？]+$/, '')
		while (value.endsWith(')') && (value.match(/\)/g) || []).length > (value.match(/\(/g) || []).length) value = value.slice(0, -1)
		try { const url = new URL(value); url.hash = ''; urls.add(url.href) } catch { /* 无效地址 */ }
	}
	return [...urls]
}

/**
 * 读取最多 1 MiB 的响应体，始终取消并释放读取器。
 * @param {Response} response 响应。
 * @returns {Promise<string>} 前缀正文。
 */
async function readPrefix(response) {
	if (!response.body) return ''
	const reader = response.body.getReader()
	const chunks = []
	let length = 0
	try {
		while (length < 1024 * 1024) {
			const { value, done } = await reader.read()
			if (done) break
			const chunk = value.subarray(0, 1024 * 1024 - length)
			chunks.push(chunk); length += chunk.length
		}
	} finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
	return new TextDecoder().decode(bytes)
}

/**
 * 获取链接元信息；只预读元信息，不抓取整页或使用 AI。
 * @param {string} url 地址。
 * @returns {Promise<string>} 标题、描述等，或 HTTP 状态/文件信息。
 */
export async function fetchUrlMetadata(url) {
	const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { Range: 'bytes=0-1048575' } })
	const type = response.headers.get('content-type') || ''
	if (!response.ok) { await response.body?.cancel(); return `HTTP ${response.status} ${response.statusText}` }
	if (!type.includes('html')) {
		await response.body?.cancel()
		return [`类型：${type || '未知'}`, response.headers.get('content-disposition'), response.headers.get('content-length') && `大小：${response.headers.get('content-length')} bytes`].filter(Boolean).join('\n')
	}
	const html = await readPrefix(response)
	const { parse } = await import('npm:node-html-parser')
	const root = parse(html)
	const record = {}
	if (root.querySelector('title')?.text?.trim()) record.title = root.querySelector('title').text.trim()
	for (const element of root.querySelectorAll('meta')) {
		const key = element.getAttribute('name') || element.getAttribute('property')
		const value = element.getAttribute('content')
		if (key && value && /^(description|keywords|author|og:|twitter:)/i.test(key)) record[key] = value.slice(0, 2000)
	}
	const icon = root.querySelector('link[rel="icon"], link[rel="shortcut icon"]')?.getAttribute('href')
	if (icon) try { record.favicon = new URL(icon, response.url || url).href } catch { /* 无效图标地址 */ }
	return Object.entries(record).map(([key, value]) => `${key}: ${value}`).join('\n') || '网页未提供元信息。'
}

/**
 * 将最新消息提及的链接元信息持久化；跨请求按 URL 去重，失败也记录，避免重复请求。
 * @param {object} args 回复上下文。
 * @param {object} [options] 可注入的抓取依赖。
 * @param {Function} [options.fetchMetadata] 元信息抓取函数。
 * @param {Function} [options.decodeQr] 二维码解码函数。
 * @returns {Promise<void>} 完成预读。
 */
export async function preloadMentionedUrls(args, { fetchMetadata = fetchUrlMetadata, decodeQr } = {}) {
	if (!args.AddLongTimeLog) return
	const qrContents = await preloadQrCodes(args, { decodeQr })
	const logs = resolveEffectiveLog(args)
	const known = new Set(logs.flatMap(entry => entry?.extension?.pluginData?.['web-browse']?.urls || []))
	args.extension ??= {}
	const inRequest = args.extension.webBrowsePreloadedUrls ??= []
	for (const url of inRequest) known.add(url)
	const entries = logs.filter(entry => ['user', 'char'].includes(entry.role)).slice(-5)
	const urls = [...new Set([...qrContents.flatMap(extractUrls), ...entries.flatMap(entry => extractUrls(entry.content))])].filter(url => !known.has(url)).slice(0, 5)
	for (const url of urls) {
		let metadata
		try { metadata = await fetchMetadata(url) } catch (error) { metadata = `元信息预读失败：${error.message}` }
		const content = `链接元信息（预读资料）：\n${url}\n${metadata}`
		args.AddLongTimeLog({ id: `web-browse-preload:${hashContent(url)}`, name: 'web-browse.preload', role: 'tool', charVisibility: [args.char_id], content: redactSecrets(content), content_for_show: renderMarkdownCodeBlock(content), files: [], extension: { pluginData: { 'web-browse': { urls: [url] } } } })
		inRequest.push(url)
	}
}
