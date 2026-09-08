/**
 * 前端 Playwright 跨用例复用外部 CDN（esm.sh / iconify / jsDelivr）GET 响应。
 * 挂在 BrowserContext.route；内存 + data/test/cdn_cache 磁盘，跨 phase 复用。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ms } from '../../ms.mjs'
import { cdnCacheDir } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

const CDN_HOSTS = new Set([
	'esm.sh',
	'api.iconify.design',
	'cdn.jsdelivr.net',
	'data.jsdelivr.com',
	'api.github.com',
])

/** 未版本化 esm.sh URL 的复验间隔（esm.sh 边缘 max-age=600，同量级）。 */
const REVALIDATE_TTL = ms('10m')
/** 单次 HEAD 探测超时。 */
const PROBE_TIMEOUT = ms('5s')

/** @type {Map<string, { status: number, headers: Record<string, string>, body: Buffer }>} */
const memory = new Map()
/** @type {Map<string, number>} 可变 CDN URL 复验键 → 上次探测时刻。 */
const lastRevalidatedAt = new Map()

/**
 * @param {string | URL} url 请求 URL
 * @returns {boolean} 是否为可缓存的外部 CDN
 */
export function isExternalCdnUrl(url) {
	try {
		const parsed = typeof url === 'string' ? new URL(url) : url
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
			&& CDN_HOSTS.has(parsed.hostname)
	}
	catch {
		return false
	}
}

/**
 * 判断 esm.sh URL 是否未版本化（未版本化 URL 指向 esm.sh 当前 latest，会随发包漂移）。
 * 路径形态：`/@pkg[/subpath]`、`/@pkg@ver[/subpath]`、scoped 为 `/@scope/name[@ver][/subpath]`，
 * 允许 `v135` 式 build 前缀段；query 不参与判断。
 * @param {string | URL} url 请求 URL
 * @returns {boolean} 是否为未版本化的 esm.sh URL
 */
export function isUnversionedEsmShUrl(url) {
	try {
		const parsed = typeof url === 'string' ? new URL(url) : url
		if (parsed.hostname !== 'esm.sh') return false
		const segments = parsed.pathname.split('/').filter(Boolean)
		let i = 0
		if (i < segments.length && /^v\d+$/.test(segments[i])) i++
		if (i >= segments.length) return false
		if (segments[i].startsWith('@')) return !segments[i + 1]?.includes('@')
		return !segments[i].includes('@')
	}
	catch {
		return false
	}
}

/**
 * 判断 jsDelivr URL 是否可变（`/npm/` 看包段是否带版本；`/gh/` 分支与 tag 无法从 URL 区分，一律可变；
 * `wp` / `combine` 等其余前缀一律可变——探测便宜且 fail-open）。
 * @param {URL} parsed 已解析 URL
 * @returns {boolean} 是否可变
 */
function isMutableJsDelivrUrl(parsed) {
	const segments = parsed.pathname.split('/').filter(Boolean)
	if (segments[0] !== 'npm' || segments.length < 2) return true
	const pkgSegment = segments[1].startsWith('@') ? segments[2] : segments[1]
	return pkgSegment == null || !pkgSegment.includes('@')
}

/**
 * 判断 URL 是否指向可能随上游漂移的资源（复验只作用于可变 URL；版本化路径视为 immutable 纯缓存）。
 * @param {string | URL} url 请求 URL
 * @returns {boolean} 是否可变
 */
export function isMutableCdnUrl(url) {
	try {
		const parsed = typeof url === 'string' ? new URL(url) : url
		switch (parsed.hostname) {
			case 'esm.sh': return isUnversionedEsmShUrl(parsed)
			case 'cdn.jsdelivr.net': return isMutableJsDelivrUrl(parsed)
			case 'data.jsdelivr.com':
			case 'api.iconify.design':
			case 'api.github.com': return true
			default: return false
		}
	}
	catch {
		return false
	}
}

/**
 * 从探测响应头取单值（兼容 Headers 实例与普通对象，大小写不敏感）。
 * @param {Record<string, string> | { get?: (name: string) => string | null } | undefined} headers 响应头
 * @param {string} name 头名（小写）
 * @returns {string | undefined} 头值，缺失时 `undefined`
 */
function readHeader(headers, name) {
	if (!headers) return undefined
	if (typeof headers.get === 'function') {
		const value = headers.get(name)
		return value == null ? undefined : value
	}
	const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
	return match?.[1]
}

/**
 * @param {string} method HTTP 方法
 * @param {string} url 完整 URL
 * @returns {string} 缓存键（method + URL）
 */
function cacheKey(method, url) {
	return `${method}\n${url}`
}

/**
 * @param {string} method HTTP 方法
 * @param {string} url 完整 URL
 * @returns {string} 磁盘文件名（sha256 hex）
 */
export function cacheFileName(method, url) {
	return `${createHash('sha256').update(cacheKey(method, url)).digest('hex')}.json`
}

/**
 * 从磁盘读取已缓存的 CDN 响应。
 * @param {string} dir 缓存目录
 * @param {string} method HTTP 方法
 * @param {string} url 完整 URL
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer } | null>} 命中条目，或文件缺失/损坏时 `null`
 */
async function readDisk(dir, method, url) {
	try {
		const raw = JSON.parse(await readFile(join(dir, cacheFileName(method, url)), 'utf8'))
		if (!raw || typeof raw.status !== 'number' || typeof raw.bodyBase64 !== 'string') return null
		return {
			status: raw.status,
			headers: raw.headers && typeof raw.headers === 'object' ? raw.headers : {},
			body: Buffer.from(raw.bodyBase64, 'base64'),
		}
	}
	catch {
		return null
	}
}

/**
 * 将 CDN 响应写入磁盘（base64 编码 body）。
 * @param {string} dir 缓存目录
 * @param {string} method HTTP 方法
 * @param {string} url 完整 URL
 * @param {{ status: number, headers: Record<string, string>, body: Buffer }} entry 条目
 * @returns {Promise<void>} 写入完成
 */
async function writeDisk(dir, method, url, entry) {
	const payload = JSON.stringify({
		method,
		url,
		status: entry.status,
		headers: entry.headers,
		bodyBase64: entry.body.toString('base64'),
	})
	await writeFile(join(dir, cacheFileName(method, url)), payload)
}

/**
 * 清理缓存写入用的响应头：去掉 content-encoding，并用明文 body 长度覆盖 content-length。
 * @param {Record<string, string>} headers 原始响应头
 * @param {Buffer} body 已解码的 body
 * @returns {Record<string, string>} 可安全 fulfill 的头
 */
function headersForCachedBody(headers, body) {
	/** @type {Record<string, string>} */
	const cleaned = {}
	for (const [name, value] of Object.entries(headers || {})) {
		if (name.toLowerCase() === 'content-encoding') continue
		cleaned[name] = value
	}
	cleaned['content-length'] = String(body.length)
	return cleaned
}

/**
 * @param {import('npm:@playwright/test').Route} route Playwright route
 * @param {string} method HTTP 方法
 * @param {{ status: number, headers: Record<string, string>, body: Buffer }} hit 缓存条目
 * @returns {Promise<void>}
 */
async function fulfillFromCache(route, method, hit) {
	const headers = method === 'HEAD'
		? hit.headers
		: headersForCachedBody(hit.headers, hit.body)
	await route.fulfill({
		status: hit.status,
		headers,
		body: method === 'HEAD' ? undefined : hit.body,
	})
}

/**
 * 带重试的 route.fetch。
 * @param {import('npm:@playwright/test').Route} route Playwright route
 * @returns {Promise<{ response: import('npm:@playwright/test').APIResponse | null, lastError: unknown }>} 响应或失败时的 lastError
 */
async function fetchWithRetries(route) {
	let response = null
	let lastError
	for (let attempt = 0; attempt < 3; attempt++)
		try {
			response = await route.fetch()
			lastError = null
			break
		}
		catch (error) {
			lastError = error
			if (attempt < 2)
				await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
		}

	return { response, lastError }
}

/**
 * 把已抓到的上游响应写入缓存并 fulfill（body 读取失败如 disposed 则 abort route）。
 * @param {import('npm:@playwright/test').Route} route Playwright route
 * @param {string} dir 缓存目录
 * @param {string} method HTTP 方法
 * @param {string} url 完整 URL
 * @param {import('npm:@playwright/test').APIResponse} response 上游响应
 * @returns {Promise<void>}
 */
async function cacheResponseAndFulfill(route, dir, method, url, response) {
	const status = response.status()
	let body
	try {
		body = Buffer.from(await response.body())
	}
	catch (error) {
		// 页面收尾 / context 关闭时 APIResponse 可能已 disposed
		if (!/disposed|target closed|has been closed/i.test(String(error?.message || error))) throw error
		try {
			await route.abort('failed')
		}
		catch { /* route 也可能已死 */ }
		return
	}
	const headers = method === 'HEAD'
		? response.headers()
		: headersForCachedBody(response.headers(), body)
	if (status >= 200 && status < 400) {
		const entry = { status, headers, body }
		memory.set(cacheKey(method, url), entry)
		await writeDisk(dir, method, url, entry).catch(() => { /* 磁盘满等非致命 */ })
	}
	await route.fulfill({
		status,
		headers,
		body: method === 'HEAD' ? undefined : body,
	})
}

/**
 * 抓取 CDN 响应，缓存后 fulfill。
 * @param {import('npm:@playwright/test').Route} route Playwright route
 * @param {string} dir 缓存目录
 * @param {string} method HTTP 方法
 * @param {string} url 完整 URL
 * @returns {Promise<void>}
 */
async function fetchCacheAndFulfill(route, dir, method, url) {
	const { response, lastError } = await fetchWithRetries(route)
	if (!response) {
		// 首次拉取仍失败：放行浏览器自取，避免 route 抛错关掉 context
		console.warn('[cdn_cache] fetch failed:', lastError?.message || lastError)
		try {
			await route.continue()
		}
		catch { /* continue 失败不覆盖原 fetch 诊断 */ }
		return
	}
	await cacheResponseAndFulfill(route, dir, method, url, response)
}

/**
 * 按缓存条目可用的校验信息选择复验方式（三级降级）：
 * 1. 版本 checknum 头（esm.sh `x-esm-path` / jsDelivr `x-jsd-version`）→ HEAD 探测比较，无 body 流量；
 * 2. etag / last-modified → HTTP 条件 GET（304 免重拉）；
 * 3. 都没有 → TTL 到期直接无条件重拉。
 * @param {Record<string, string>} cachedHeaders 缓存条目头
 * @returns {{ kind: 'head', checknumHeader: string } | { kind: 'conditional', conditionalHeader: string, cacheHeader: string } | { kind: 'refetch' }} 复验计划
 */
function probePlanFor(cachedHeaders) {
	const checknumHeader = ['x-esm-path', 'x-jsd-version'].find(name => readHeader(cachedHeaders, name) != null)
	if (checknumHeader) return { kind: 'head', checknumHeader }
	if (readHeader(cachedHeaders, 'etag') != null)
		return { kind: 'conditional', conditionalHeader: 'if-none-match', cacheHeader: 'etag' }
	if (readHeader(cachedHeaders, 'last-modified') != null)
		return { kind: 'conditional', conditionalHeader: 'if-modified-since', cacheHeader: 'last-modified' }
	return { kind: 'refetch' }
}

/**
 * 读探测响应的状态码（兼容 APIResponse 的 `status()` 与 fetch Response 的 `status` 属性）。
 * @param {{ status?: number | (() => number) }} probe 探测响应
 * @returns {number | undefined} 状态码
 */
function readProbeStatus(probe) {
	const raw = probe?.status
	return typeof raw === 'function' ? raw() : raw
}

/**
 * 把探测 fetch 的响应统一成 cacheResponseAndFulfill 需要的接口
 * （Playwright APIResponse 用方法取值；Node fetch Response 用属性 + arrayBuffer）。
 * @param {{ status: number | (() => number), headers: Record<string, string> | Headers, arrayBuffer?: () => Promise<ArrayBuffer> }} response 探测响应
 * @returns {{ status: () => number, headers: () => Record<string, string>, body: () => Promise<Buffer> }} 统一形状
 */
function wireProbeResponse(response) {
	if (typeof response.status === 'function' && typeof response.body === 'function') 
		return /** @type {{ status: () => number, headers: () => Record<string, string>, body: () => Promise<Buffer> }} */ response
	
	return {
		/**
		 * @returns {number} 状态码
		 */
		status: () => Number(response.status),
		/**
		 * @returns {Record<string, string>} 响应头（plain object）
		 */
		headers: () => typeof response.headers?.entries === 'function'
			? Object.fromEntries(response.headers.entries())
			: { ...response.headers },
		/**
		 * @returns {Promise<Buffer>} 响应体
		 */
		body: async () => Buffer.from(await response.arrayBuffer()),
	}
}

/**
 * 复验可变 URL 的缓存条目（每 URL 每 TTL 窗口最多探测一次，探测 / 重拉失败一律 fail-open 沿用旧缓存）。
 * @param {import('npm:@playwright/test').Route} route Playwright route
 * @param {string} dir 缓存目录
 * @param {string} method HTTP 方法（恒为 GET）
 * @param {string} url 完整 URL
 * @param {{ status: number, headers: Record<string, string>, body: Buffer }} hit 缓存条目
 * @param {(url: string, init?: { method?: string, headers?: Record<string, string>, signal?: AbortSignal }) => Promise<{ ok?: boolean, status?: number | (() => number), headers?: Record<string, string> | Headers, arrayBuffer?: () => Promise<ArrayBuffer> }>} probeFetch 探测实现（可注入）
 * @returns {Promise<boolean>} 是否已重拉并 fulfill（false = 调用方需用旧缓存 fulfill）
 */
async function revalidateEntry(route, dir, method, url, hit, probeFetch) {
	const key = cacheKey(method, url)
	if ((Date.now() - (lastRevalidatedAt.get(key) ?? 0)) < REVALIDATE_TTL) return false
	lastRevalidatedAt.set(key, Date.now())
	const plan = probePlanFor(hit.headers)
	if (plan.kind === 'head') {
		let probe
		try {
			probe = await probeFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT) })
		}
		catch {
			return false
		}
		const status = readProbeStatus(probe)
		if (status == null || status < 200 || status >= 300) return false
		const upstream = readHeader(probe?.headers, plan.checknumHeader)
		if (!upstream || upstream === readHeader(hit.headers, plan.checknumHeader)) return false
		const { response, lastError } = await fetchWithRetries(route)
		if (!response) {
			console.warn('[cdn_cache] revalidate fetch failed:', lastError?.message || lastError)
			return false
		}
		await cacheResponseAndFulfill(route, dir, method, url, response)
		return true
	}
	const headers = {}
	if (plan.kind === 'conditional')
		headers[plan.conditionalHeader] = readHeader(hit.headers, plan.cacheHeader) ?? ''
	let probe
	try {
		probe = await probeFetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(PROBE_TIMEOUT) })
	}
	catch {
		return false
	}
	const status = readProbeStatus(probe)
	if (status == null || (status !== 304 && (status < 200 || status >= 300))) return false
	if (status === 304) return false
	await cacheResponseAndFulfill(route, dir, method, url, wireProbeResponse(probe))
	return true
}

/**
 * 在 BrowserContext 上安装 CDN 响应缓存路由。
 * @param {import('npm:@playwright/test').BrowserContext} context Playwright context
 * @param {{ probeFetch?: (url: string, init?: { method?: string, headers?: Record<string, string>, signal?: AbortSignal }) => Promise<{ ok?: boolean, status?: number | (() => number), headers?: Record<string, string> | Headers, arrayBuffer?: () => Promise<ArrayBuffer> }> }} [options] 选项（probeFetch 供 selftest 注入）
 * @returns {Promise<void>} 路由安装完成（`FOUNT_TEST_CDN_CACHE=0` 时立即返回）
 */
export async function installCdnResponseCache(context, { probeFetch = (url, init) => fetch(url, init) } = {}) {
	if (process.env.FOUNT_TEST_CDN_CACHE === '0') return
	const dir = cdnCacheDir(REPO_ROOT)
	await mkdir(dir, { recursive: true })

	await context.route(isExternalCdnUrl, async route => {
		const req = route.request()
		const method = req.method()
		if ((method !== 'GET' && method !== 'HEAD') || req.headers().range) {
			await route.continue()
			return
		}
		const url = req.url()
		const key = cacheKey(method, url)
		let hit = memory.get(key)
		if (!hit) {
			hit = await readDisk(dir, method, url) || undefined
			if (hit) memory.set(key, hit)
		}
		if (hit) {
			if (method === 'GET' && isMutableCdnUrl(url)
				&& await revalidateEntry(route, dir, method, url, hit, probeFetch)) return
			await fulfillFromCache(route, method, hit)
			return
		}
		await fetchCacheAndFulfill(route, dir, method, url)
	})
}

/**
 * 测试用：清空内存缓存与复验时间戳（磁盘不动）。
 * @returns {void}
 */
export function clearCdnResponseMemoryCache() {
	memory.clear()
	lastRevalidatedAt.clear()
}
