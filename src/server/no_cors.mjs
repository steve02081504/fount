/**
 * 已认证用户的通用 no-CORS 中转：双向流式转发，支持任意方法 / Range / 自定义头。
 */
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const HOP_BY_HOP = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailers',
	'transfer-encoding',
	'upgrade',
])

/** 不转发给上游的本机连接头（含 fount 会话 Cookie / API key）。 */
const FOUNT_LOCAL = new Set([
	'host',
	'cookie',
	'fount-apikey',
	'content-length',
])

/**
 * 默认同名转发的请求头（Range 断点、条件请求、Content-Type 等）。
 * Cookie / Authorization 等敏感头须用 `No-Cors-*` 注入，避免把 fount 会话泄露给上游。
 */
const FORWARD_REQ = new Set([
	'accept',
	'accept-language',
	'content-type',
	'user-agent',
	'referer',
	'range',
	'if-range',
	'if-match',
	'if-none-match',
	'if-modified-since',
	'if-unmodified-since',
	'cache-control',
	'pragma',
])

const NO_CORS_PREFIX = 'no-cors-'

/**
 * @param {import('npm:express').Request} req 入站请求
 * @returns {Headers} 上游请求头
 */
export function buildUpstreamHeaders(req) {
	const headers = new Headers()
	for (const [key, value] of Object.entries(req.headers)) {
		if (value == null) continue
		const lower = key.toLowerCase()
		const text = Array.isArray(value) ? value.join(', ') : String(value)
		if (lower.startsWith(NO_CORS_PREFIX)) {
			const name = lower.slice(NO_CORS_PREFIX.length)
			if (!name || HOP_BY_HOP.has(name) || name === 'host') continue
			headers.set(name, text)
			continue
		}
		if (FOUNT_LOCAL.has(lower) || HOP_BY_HOP.has(lower)) continue
		if (!FORWARD_REQ.has(lower)) continue
		headers.set(lower, text)
	}
	return headers
}

/**
 * @param {Headers} upstreamHeaders 上游响应头
 * @param {import('npm:express').Response} res Express 响应
 * @returns {void}
 */
function writeResponseHeaders(upstreamHeaders, res) {
	for (const [key, value] of upstreamHeaders) {
		const lower = key.toLowerCase()
		if (HOP_BY_HOP.has(lower)) continue
		res.append(key, value)
	}
}

/**
 * 双向流式转发：不缓冲整包 body。
 * @param {import('npm:express').Request} req Express 请求
 * @param {import('npm:express').Response} res Express 响应
 * @returns {Promise<void>}
 */
export async function handleNoCors(req, res) {
	const raw = String(req.query.url || '')
	let parsed
	try {
		parsed = new URL(raw)
	}
	catch {
		res.status(400).json({ message: 'invalid url' })
		return
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		res.status(400).json({ message: 'only http(s) URLs are allowed' })
		return
	}

	const method = req.method.toUpperCase()
	const hasBody = method !== 'GET' && method !== 'HEAD'
	const ac = new AbortController()
	/**
	 * 客户端断开时中止上游，避免无用灌包。
	 * @returns {void}
	 */
	const onAbort = () => {
		if (!res.writableEnded) ac.abort()
	}
	req.on('aborted', onAbort)
	res.on('close', onAbort)

	/** @type {RequestInit} */
	const init = {
		method,
		headers: buildUpstreamHeaders(req),
		signal: ac.signal,
		redirect: hasBody ? 'manual' : 'follow',
	}
	if (hasBody) {
		init.body = Readable.toWeb(req)
		init.duplex = 'half'
	}

	let upstream
	try {
		upstream = await fetch(parsed.href, init)
	}
	catch (error) {
		if (ac.signal.aborted || error?.name === 'AbortError') return
		throw error
	}

	res.status(upstream.status)
	writeResponseHeaders(upstream.headers, res)
	if (upstream.url && upstream.url !== parsed.href)
		res.setHeader('X-No-Cors-Final-Url', upstream.url)

	if (method === 'HEAD' || !upstream.body) {
		res.end()
		return
	}

	try {
		await pipeline(Readable.fromWeb(upstream.body), res)
	}
	catch (error) {
		if (ac.signal.aborted || error?.code === 'ERR_STREAM_PREMATURE_CLOSE') return
		throw error
	}
}

/**
 * @param {string} path 请求路径
 * @returns {boolean} 是否为 no-cors 路由（跳过 body 解析中间件）
 */
export function isNoCorsPath(path) {
	return path === '/api/no-cors'
}
