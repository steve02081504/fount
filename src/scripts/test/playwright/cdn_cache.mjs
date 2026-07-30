/**
 * 前端 Playwright 跨用例复用外部 CDN（esm.sh / iconify / jsDelivr）GET 响应。
 * 挂在 BrowserContext.route；内存 + data/test/cdn_cache 磁盘，跨 phase 复用。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { cdnCacheDir } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

const CDN_HOSTS = new Set([
	'esm.sh',
	'api.iconify.design',
	'cdn.jsdelivr.net',
])

/** @type {Map<string, { status: number, headers: Record<string, string>, body: Buffer }>} */
const memory = new Map()

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
 * @param {string} url 完整 URL
 * @returns {string} 磁盘文件名（sha256 hex）
 */
function cacheFileName(url) {
	return `${createHash('sha256').update(url).digest('hex')}.json`
}

/**
 * 从磁盘读取已缓存的 CDN 响应。
 * @param {string} dir 缓存目录
 * @param {string} url 完整 URL
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer } | null>} 命中条目，或文件缺失/损坏时 `null`
 */
async function readDisk(dir, url) {
	try {
		const raw = JSON.parse(await readFile(join(dir, cacheFileName(url)), 'utf8'))
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
 * @param {string} url 完整 URL
 * @param {{ status: number, headers: Record<string, string>, body: Buffer }} entry 条目
 * @returns {Promise<void>} 写入完成
 */
async function writeDisk(dir, url, entry) {
	const payload = JSON.stringify({
		url,
		status: entry.status,
		headers: entry.headers,
		bodyBase64: entry.body.toString('base64'),
	})
	await writeFile(join(dir, cacheFileName(url)), payload)
}

/**
 * 在 BrowserContext 上安装 CDN 响应缓存路由。
 * @param {import('npm:@playwright/test').BrowserContext} context Playwright context
 * @returns {Promise<void>} 路由安装完成（`FOUNT_TEST_CDN_CACHE=0` 时立即返回）
 */
export async function installCdnResponseCache(context) {
	if (process.env.FOUNT_TEST_CDN_CACHE === '0') return
	const dir = cdnCacheDir(REPO_ROOT)
	await mkdir(dir, { recursive: true })

	await context.route(isExternalCdnUrl, async route => {
		const req = route.request()
		const method = req.method()
		if (method !== 'GET' && method !== 'HEAD') {
			await route.continue()
			return
		}
		const url = req.url()
		let hit = memory.get(url)
		if (!hit) {
			hit = await readDisk(dir, url) || undefined
			if (hit) memory.set(url, hit)
		}
		if (hit) {
			await route.fulfill({
				status: hit.status,
				headers: hit.headers,
				body: method === 'HEAD' ? undefined : hit.body,
			})
			return
		}
		let response
		let lastError
		for (let attempt = 0; attempt < 3; attempt++) 
			try {
				response = await route.fetch()
				lastError = null
				break
			}
			catch (error) {
				lastError = error
				await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
			}
		
		if (!response) {
			// 首次拉取仍失败：放行浏览器自取，避免 route 抛错关掉 context
			try {
				await route.continue()
			}
			catch {
				if (lastError) console.warn('[cdn_cache] fetch failed:', lastError?.message || lastError)
			}
			return
		}
		const status = response.status()
		const headers = response.headers()
		const body = Buffer.from(await response.body())
		if (status >= 200 && status < 400) {
			const entry = { status, headers, body }
			memory.set(url, entry)
			await writeDisk(dir, url, entry).catch(() => { /* 磁盘满等非致命 */ })
		}
		await route.fulfill({ response, body })
	})
}
