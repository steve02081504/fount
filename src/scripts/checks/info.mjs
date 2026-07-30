/**
 * parts locales.json / achievements_registry.json 的 info 健康检查（原 .esh/commands/verify-info.py）。
 * 只读断言：不再写回清理 provider。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const EMOJI_LANG_PATTERNS = Object.freeze([
	['中文', /[\u4e00-\u9fff]/u],
	['日文', /[\u3040-\u309f\u30a0-\u30ff]/u],
	['俄文', /[\u0400-\u04ff]/u],
	['英文', /[a-zA-Z]/u],
])

const EMOJI_SKIP_KEYS = Object.freeze(new Set(['author', 'avatar', 'version', 'home_page']))
const EMOJI_STRIP_MD_LINK_URL_RE = /(\[[^\]]*\]\()[^)]*(\))/g

const URL_CHECK_TIMEOUT_MS = 10_000
const URL_CHECK_CONCURRENCY = 16

/**
 * @param {unknown} obj 任意 JSON 值
 * @param {string[]} out 收集字符串
 * @returns {void}
 */
function collectStrings(obj, out) {
	if (typeof obj === 'string') {
		out.push(obj)
		return
	}
	if (Array.isArray(obj)) {
		for (const item of obj) collectStrings(item, out)
		return
	}
	if (obj && typeof obj === 'object')
		for (const value of Object.values(obj)) collectStrings(value, out)

}

/**
 * emoji 块内字符串是否含中/英/俄/日任一种。
 * @param {Record<string, unknown>} emojiBlock info.emoji
 * @returns {{ warn: boolean, langs: string[] }} 是否警告及检测到的语言名
 */
export function hasEmojiLocaleWarning(emojiBlock) {
	/** @type {string[]} */
	const strings = []
	for (const [key, value] of Object.entries(emojiBlock)) {
		if (EMOJI_SKIP_KEYS.has(key)) continue
		collectStrings(value, strings)
	}
	const text = strings.join(' ').replace(EMOJI_STRIP_MD_LINK_URL_RE, '$1$2')
	const langs = EMOJI_LANG_PATTERNS.filter(([, pat]) => pat.test(text)).map(([name]) => name)
	return { warn: langs.length > 0, langs }
}

/**
 * info 各 locale 中残留的 provider 键。
 * @param {Record<string, unknown>} info info 块
 * @returns {string[]} 含 provider 的 locale 键
 */
export function localesWithInfoProvider(info) {
	return Object.entries(info)
		.filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'provider' in /** @type {object} */ (value))
		.map(([key]) => key)
}

/**
 * product_info 中缺少 provider 的 locale。
 * @param {Record<string, unknown>} block product_info
 * @returns {string[]} locale 键
 */
export function localesMissingProvider(block) {
	return Object.entries(block)
		.filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && !('provider' in /** @type {object} */ (value)))
		.map(([key]) => key)
}

/**
 * @param {string} url 候选 URL
 * @returns {boolean} 是否 http(s)
 */
export function isHttpUrl(url) {
	try {
		const { protocol } = new URL(url)
		return protocol === 'http:' || protocol === 'https:'
	}
	catch {
		return false
	}
}

/**
 * HEAD 失败再 GET；确认为 404 或两次都失败时返回 true。
 * @param {string} url http(s) URL
 * @param {number} [timeoutMs] 超时
 * @returns {Promise<boolean>} 不可用则为 true
 */
export async function isUrlUnavailable(url, timeoutMs = URL_CHECK_TIMEOUT_MS) {
	if (!isHttpUrl(url)) return false
	const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0' }

	/**
	 * @param {string} method HTTP 方法
	 * @returns {Promise<'ok' | 'not_found' | 'error'>} 探测结果
	 */
	async function once(method) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		try {
			const response = await fetch(url, { method, headers, signal: controller.signal, redirect: 'follow' })
			if (response.status === 404) return 'not_found'
			if (response.ok) return 'ok'
			// HEAD 405/403 等：回退 GET；GET 非 404 视为可达（与旧脚本一致）
			if (method === 'HEAD') return 'error'
			return 'ok'
		}
		catch {
			return 'error'
		}
		finally {
			clearTimeout(timer)
		}
	}

	const head = await once('HEAD')
	if (head === 'ok') return false
	// 部分 CDN 对 HEAD 回 404/错误但 GET 正常；以 GET 为准
	const get = await once('GET')
	return get !== 'ok'
}

/**
 * @template T
 * @param {T[]} items 任务项
 * @param {number} concurrency 并发
 * @param {(item: T) => Promise<void>} worker 处理函数
 * @returns {Promise<void>}
 */
async function mapPool(items, concurrency, worker) {
	let index = 0
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (index < items.length) {
			const current = items[index++]
			await worker(current)
		}
	})
	await Promise.all(runners)
}

/**
 * @typedef {object} InfoScanIssue
 * @property {string} path 相对路径
 * @property {string} message 问题描述
 */

/**
 * @typedef {{ kind: 'avatar', path: string } | { kind: 'achievement', path: string, achievementId: string, key: string }} UrlRef
 */

/**
 * 扫描单个 locales.json。
 * @param {string} relPath 相对路径
 * @param {unknown} data JSON
 * @returns {{ issues: InfoScanIssue[], avatarUrls: string[], emojiMissingAvatar: boolean }} 静态问题与待检 avatar
 */
export function scanLocalesData(relPath, data) {
	/** @type {InfoScanIssue[]} */
	const issues = []
	/** @type {string[]} */
	const avatarUrls = []
	let emojiMissingAvatar = false

	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		issues.push({ path: relPath, message: '根对象不是 object' })
		return { issues, avatarUrls, emojiMissingAvatar }
	}

	const root = /** @type {Record<string, unknown>} */ (data)
	const info = /** @type {Record<string, unknown>} */ (root.info)
	if (info && typeof info === 'object' && !Array.isArray(info)) {
		const withProvider = localesWithInfoProvider(/** @type {Record<string, unknown>} */ (info))
		if (withProvider.length)
			issues.push({ path: relPath, message: `info 残留 provider（应只在 product_info）: ${withProvider.join(', ')}` })

		const emojiBlock = /** @type {Record<string, unknown>} */ (info.emoji)
		if (emojiBlock && typeof emojiBlock === 'object' && !Array.isArray(emojiBlock)) {
			const { warn, langs } = hasEmojiLocaleWarning(/** @type {Record<string, unknown>} */ (emojiBlock))
			if (warn)
				issues.push({ path: relPath, message: `emoji 内字符串含 ${langs.join('/')}，请确认 emoji 本地化` })
			const av = /** @type {Record<string, unknown>} */ (emojiBlock).avatar
			if (av == null || av === '')
				emojiMissingAvatar = true
		}

		for (const value of Object.values(info)) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue
			const url = /** @type {Record<string, unknown>} */ (value).avatar
			if (typeof url === 'string' && url.trim())
				avatarUrls.push(url.trim())
		}
	}

	const productInfo = /** @type {Record<string, unknown>} */ (root.product_info)
	if (productInfo && typeof productInfo === 'object' && !Array.isArray(productInfo)) {
		const missing = localesMissingProvider(/** @type {Record<string, unknown>} */ (productInfo))
		if (missing.length)
			issues.push({ path: relPath, message: `product_info 缺少 provider: ${missing.join(', ')}` })
	}

	return { issues, avatarUrls, emojiMissingAvatar }
}

/**
 * @param {string} relPath 相对路径
 * @param {unknown} data JSON
 * @returns {{ issues: InfoScanIssue[], iconUrls: { achievementId: string, key: string, url: string }[] }} 静态问题与待检 icon
 */
export function scanAchievementsData(relPath, data) {
	/** @type {InfoScanIssue[]} */
	const issues = []
	/** @type {{ achievementId: string, key: string, url: string }[]} */
	const iconUrls = []

	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		issues.push({ path: relPath, message: '根对象不是 object' })
		return { issues, iconUrls }
	}

	const achievements = /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (data).achievements)
	if (!achievements || typeof achievements !== 'object' || Array.isArray(achievements))
		return { issues, iconUrls }

	for (const [achId, ach] of Object.entries(achievements)) {
		if (!ach || typeof ach !== 'object' || Array.isArray(ach)) continue
		for (const key of /** @type {const} */ (['icon', 'locked_icon'])) {
			const url = /** @type {Record<string, unknown>} */ (ach)[key]
			if (typeof url === 'string' && url.trim())
				iconUrls.push({ achievementId: achId, key, url: url.trim() })
		}
	}
	return { issues, iconUrls }
}

/**
 * @param {string} repoRoot 仓库根
 * @param {string} rel 相对路径
 * @param {InfoScanIssue[]} issues 问题列表
 * @returns {Promise<unknown | undefined>} 解析后的 JSON，失败时 undefined
 */
async function readJsonSafe(repoRoot, rel, issues) {
	try {
		return JSON.parse(await readFile(join(repoRoot, rel), 'utf8'))
	}
	catch (error) {
		issues.push({ path: rel, message: `无法读取/解析: ${error}` })
		return undefined
	}
}

/**
 * @param {Map<string, UrlRef[]>} urlRefs URL → 引用
 * @param {Set<string>} badUrls 不可用 URL
 * @param {InfoScanIssue[]} issues 问题列表
 */
function reportBadUrls(urlRefs, badUrls, issues) {
	for (const url of badUrls) {
		const refs = urlRefs.get(url) || []
		/** @type {Set<string>} */
		const seen = new Set()
		for (const ref of refs)
			if (ref.kind === 'avatar') {
				const key = `avatar:${ref.path}:${url}`
				if (seen.has(key)) continue
				seen.add(key)
				issues.push({ path: ref.path, message: `avatar URL 不可用: ${url}` })
			}
			else {
				const key = `ach:${ref.path}:${ref.achievementId}:${ref.key}:${url}`
				if (seen.has(key)) continue
				seen.add(key)
				issues.push({
					path: ref.path,
					message: `成就 '${ref.achievementId}' 的 ${ref.key} 不可用: ${url}`,
				})
			}

	}
}

/**
 * 扫描 parts 下 locales / achievements，含去重后的 URL 可用性检查。
 * @param {object} options 选项
 * @param {string} options.repoRoot 仓库根
 * @param {string[]} options.localesPaths 相对路径（locales.json）
 * @param {string[]} options.achievementPaths 相对路径（achievements_registry.json）
 * @param {(url: string) => Promise<boolean>} [options.checkUrl] URL 检查；默认 {@link isUrlUnavailable}
 * @returns {Promise<InfoScanIssue[]>} 全部问题
 */
export async function scanPartsInfo({
	repoRoot,
	localesPaths,
	achievementPaths,
	checkUrl = isUrlUnavailable,
}) {
	/** @type {InfoScanIssue[]} */
	const issues = []
	/** @type {Map<string, UrlRef[]>} */
	const urlRefs = new Map()

	for (const rel of localesPaths) {
		const data = await readJsonSafe(repoRoot, rel, issues)
		if (data === undefined) continue
		const scanned = scanLocalesData(rel, data)
		issues.push(...scanned.issues)
		if (scanned.emojiMissingAvatar)
			issues.push({ path: rel, message: 'info.emoji 无 avatar（无字段或空串）' })
		for (const url of scanned.avatarUrls) {
			const list = urlRefs.get(url) ?? []
			list.push({ kind: 'avatar', path: rel })
			urlRefs.set(url, list)
		}
	}

	for (const rel of achievementPaths) {
		const data = await readJsonSafe(repoRoot, rel, issues)
		if (data === undefined) continue
		const scanned = scanAchievementsData(rel, data)
		issues.push(...scanned.issues)
		for (const { achievementId, key, url } of scanned.iconUrls) {
			const list = urlRefs.get(url) ?? []
			list.push({ kind: 'achievement', path: rel, achievementId, key })
			urlRefs.set(url, list)
		}
	}

	const urls = [...urlRefs.keys()].filter(isHttpUrl)
	/** @type {Set<string>} */
	const badUrls = new Set()
	await mapPool(urls, URL_CHECK_CONCURRENCY, async url => {
		if (await checkUrl(url))
			badUrls.add(url)
	})

	reportBadUrls(urlRefs, badUrls, issues)
	return issues
}
