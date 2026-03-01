/**
 * 预加载 URL 列表：扫描 public/pages、public/parts 及用户目录下的 public，提取外部 URL 并分类；
 * 在 src/public 变动或部件安装/卸载时清空对应缓存。
 * @module preload_list
 */

import fs from 'node:fs'
import path from 'node:path'

import { getUserDictionary } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { events } from '../events.mjs'

const EXTERNAL_URL_REG = /^https?:\/\//

/** @typedef {'mjs'|'css'|'js'|'resource'} PreloadResourceType */

/**
 * 从 URL 路径推断资源类型（用于 JSON 等无上下文场景）。
 * @param {string} url - 完整 URL。
 * @returns {PreloadResourceType} - 资源类型。
 */
function typeFromUrlSuffix(url) {
	try {
		const { pathname } = new URL(url)
		if (/\.mjs(\?|$)/i.test(pathname)) return 'mjs'
		if (/\.js(\?|$)/i.test(pathname)) return 'js'
		if (/\.css(\?|$)/i.test(pathname)) return 'css'
	} catch (_) { /* ignore */ }
	return 'resource'
}

/**
 * 去掉 JS 中的多行注释（不处理字符串内的）。
 * @param {string} s - 源码。
 * @returns {string} - 去掉注释后的源码。
 */
function stripBlockComments(s) {
	return s.replace(/\/\*[\S\s]*?\*\//g, '')
}

/**
 * 从 .mjs / .js 中提取外部 URL 并分类：仅 import/import() 与 // @fetch-resource，排除注释与 location 赋值。
 * @param {string} content - 文件内容。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 提取到的资源列表。
 */
function extractFromJs(content) {
	const out = []
	const noBlock = stripBlockComments(content)
	const lines = noBlock.split(/\r?\n/)
	/**
	 * 跳过注释和 location 赋值。
	 * @param {string} line - 行内容。
	 * @returns {boolean} - 是否跳过。
	 */
	const skipLine = (line) => {
		if (/@fetch-resource/i.test(line)) return false
		const t = line.trim()
		if (t.startsWith('//')) return true
		if (/\.href\s*=\s*["']|window\.location\s*\.href\s*=|location\.href\s*=\s*["']|window\.location\s*=\s*["']/i.test(line)) return true
		return false
	}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (skipLine(line)) continue
		// import X from 'url' / import('url')
		const importFrom = line.match(/import\s+(?:[\s\w*,{}]+\s+from\s+)?["'](https?:\/\/[^"']+)["']/)
		if (importFrom) {
			out.push({ url: importFrom[1].trim(), type: 'mjs' })
			continue
		}
		const importCall = line.match(/import\s*\(\s*["'](https?:\/\/[^"']+)["']\s*\)/)
		if (importCall) {
			out.push({ url: importCall[1].trim(), type: 'mjs' })
			continue
		}
		// // @fetch-resource [url] 或下一行含 http(s) URL
		const fetchResource = line.match(/\/\/\s*@fetch-resource\s+(https?:\/\/\S+)/)
		if (fetchResource) {
			out.push({ url: fetchResource[1].trim(), type: typeFromUrlSuffix(fetchResource[1]) })
			continue
		}
		if (line.trim().startsWith('//') && /@fetch-resource/i.test(line)) {
			const next = lines[i + 1]
			if (next) {
				const urlMatch = next.match(/(https?:\/\/[^\s"']+)/)
				if (urlMatch) out.push({ url: urlMatch[1].trim(), type: typeFromUrlSuffix(urlMatch[1]) })
			}
			i++
			continue
		}
	}
	return out
}

/**
 * 从 HTML 中仅提取带 src 的标签的外部 URL，按标签类型分类；不匹配 href/placeholder 等。
 * @param {string} content - 文件内容。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 提取到的资源列表。
 */
function extractFromHtml(content) {
	const out = []
	// 只匹配 src=，且限定在 script/img/iframe/video/audio/source 等标签上下文中
	const tagSrcRe = /<(script|img|iframe|video|audio|source)(\s[^>]*)?\s*src\s*=\s*["'](https?:\/\/[^"']+)["']/gi
	let m
	while ((m = tagSrcRe.exec(content)) !== null) {
		const tag = (m[1] || '').toLowerCase()
		if (tag === 'iframe') continue
		const url = m[3]
		let type = 'resource'
		if (tag === 'script')
			type = /type\s*=\s*["']module["']/i.test(m[2] || '') ? 'mjs' : 'js'

		out.push({ url, type })
	}
	return out
}

/**
 * 从 JSON 中提取 "https?://..."，按 URL 后缀分类。
 * @param {string} content - 文件内容。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 提取到的资源列表。
 */
function extractFromJson(content) {
	const out = []
	const re = /"(https?:\/\/[^"]+)"/g
	let m
	while ((m = re.exec(content)) !== null) {
		const url = m[1]
		out.push({ url, type: typeFromUrlSuffix(url) })
	}
	return out
}

/**
 * 从 CSS 中仅提取 @import 的外部 URL，类型为 css。
 * @param {string} content - 文件内容。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 提取到的资源列表。
 */
function extractFromCss(content) {
	const out = []
	const re1 = /@import\s+url\s*\(\s*["']?(https?:\/\/[^\s"')]+)["']?\s*\)/g
	const re2 = /@import\s+["'](https?:\/\/[^"']+)["']/g
	let m
	while ((m = re1.exec(content)) !== null) out.push({ url: m[1].trim(), type: 'css' })
	while ((m = re2.exec(content)) !== null) out.push({ url: m[1].trim(), type: 'css' })
	return out
}

/**
 * 按文件扩展名选择提取器并返回带类型的 URL 列表。
 * @param {string} filePath - 文件路径（用于判断扩展名）。
 * @param {string} content - 文件内容。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 提取到的资源列表。
 */
function extractTypedUrls(filePath, content) {
	const ext = path.extname(filePath).toLowerCase()
	if (ext === '.mjs' || ext === '.js') return extractFromJs(content)
	if (ext === '.html') return extractFromHtml(content)
	if (ext === '.json') return extractFromJson(content)
	if (ext === '.css') return extractFromCss(content)
	return []
}

/**
 * 合并多条结果并去重（按 url，保留首次出现的类型）。
 * @param {{ url: string, type: PreloadResourceType }[][]} lists - 多条结果。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 合并后的资源列表。
 */
function mergeAndDedupe(lists) {
	const byUrl = new Map()
	for (const list of lists)
		for (const { url, type } of list) {
			if (!EXTERNAL_URL_REG.test(url)) continue
			if (!byUrl.has(url)) byUrl.set(url, type)
		}

	return [...byUrl.entries()].map(([url, type]) => ({ url, type }))
}

// --- 公用缓存（所有用户共享）
/** @type {{ url: string, type: PreloadResourceType }[] | null} */
let commonCache = null

// --- 用户缓存
/** @type {Record<string, { url: string, type: PreloadResourceType }[] | null>} */
const userCaches = {}

/**
 * 递归收集目录下匹配指定扩展名的文件路径。
 * @param {string} dir - 根目录。
 * @param {string[]} exts - 扩展名列表（如 ['.mjs', '.html']）。
 * @returns {string[]} 文件绝对路径数组。
 */
function collectFiles(dir, exts) {
	const normalized = exts.map(e => e.startsWith('.') ? e : '.' + e)
	const out = []
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return out
	const walk = /** @param {string} d - 目录路径。 */ (d) => {
		try {
			const entries = fs.readdirSync(d, { withFileTypes: true })
			for (const e of entries) {
				const full = path.join(d, e.name)
				if (e.isDirectory()) walk(full)
				else if (normalized.some(ext => e.name.endsWith(ext))) out.push(full)
			}
		} catch (_) { /* ignore */ }
	}
	walk(dir)
	return out
}

/**
 * 扫描目录树中 .mjs/.html/.json/.css，提取外部 URL 并带类型去重。
 * @param {string} rootDir - 根目录。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 提取到的资源列表。
 */
function scanDirectoryForTypedUrls(rootDir) {
	const exts = ['.mjs', '.js', '.html', '.json', '.css']
	const files = collectFiles(rootDir, exts)
	const all = []
	for (const file of files) try {
		const content = fs.readFileSync(file, 'utf8')
		all.push(extractTypedUrls(file, content))
	} catch (_) { /* ignore */ }

	return mergeAndDedupe(all)
}

/**
 * 递归收集目录下所有名为 public 的子目录路径（不进入 public 内再找 public）。
 * @param {string} root - 根目录（如用户目录或 parts 根）。
 * @returns {string[]} public 目录的绝对路径列表。
 */
function collectPublicDirs(root) {
	const out = []
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return out
	const walk = /** @param {string} d - 目录路径。 */ (d) => {
		try {
			const entries = fs.readdirSync(d, { withFileTypes: true })
			for (const e of entries) {
				if (!e.isDirectory()) continue
				const full = path.join(d, e.name)
				if (e.name === 'public') out.push(full)
				else walk(full)
			}
		} catch (_) { /* ignore */ }
	}
	walk(root)
	return out
}

/**
 * 构建公用预加载列表：扫描 pages 与 parts 下所有 public 目录。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 公用预加载 URL 列表。
 */
function buildCommonPreloadUrls() {
	const publicRoot = path.join(__dirname, 'src', 'public')
	const lists = []
	const pagesDir = path.join(publicRoot, 'pages')
	if (fs.existsSync(pagesDir)) lists.push(scanDirectoryForTypedUrls(pagesDir))
	const partsDir = path.join(publicRoot, 'parts')
	if (fs.existsSync(partsDir))
		for (const publicDir of collectPublicDirs(partsDir))
			lists.push(scanDirectoryForTypedUrls(publicDir))

	return mergeAndDedupe(lists)
}

/**
 * 获取公用预加载 URL 列表。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 公用预加载 URL 列表。
 */
function getCommonPreloadUrls() {
	return commonCache ??= buildCommonPreloadUrls()
}

/**
 * 清除公用预加载缓存（下次 getCommonPreloadUrls 时会重新构建）。
 * @returns {void}
 */
function clearCommonCache() {
	commonCache = null
}

/**
 * 构建指定用户的预加载列表：仅扫描该用户目录下各 public 子目录。
 * @param {string} username - 用户名。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 用户预加载 URL 列表。
 */
function buildUserPreloadUrls(username) {
	const userRoot = getUserDictionary(username)
	const lists = []
	for (const publicDir of collectPublicDirs(userRoot))
		lists.push(scanDirectoryForTypedUrls(publicDir))

	return mergeAndDedupe(lists)
}

/**
 * 获取用户预加载 URL 列表。
 * @param {string} username - 用户名。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 用户预加载 URL 列表。
 */
function getCachedUserPreloadUrls(username) {
	return userCaches[username] ??= buildUserPreloadUrls(username)
}

/**
 * 清除用户预加载 URL 列表缓存。
 * @param {string} username - 用户名。
 * @returns {void}
 */
function clearUserPreloadCache(username) {
	delete userCaches[username]
}

/**
 * 获取预加载 URL 列表（带类型）。username 为 undefined 时仅返回公用列表；否则合并公用与对应用户列表并去重。
 * @param {string | undefined} [username] - 已登录用户名，未登录或不传为 undefined。
 * @returns {{ url: string, type: PreloadResourceType }[]} - 预加载 URL 列表。
 */
export function getUserPreloadUrls(username) {
	const common = getCommonPreloadUrls()
	if (!username) return common
	const user = getCachedUserPreloadUrls(username)
	const byUrl = new Map(common.map(({ url, type }) => [url, type]))
	for (const { url, type } of user) if (!byUrl.has(url)) byUrl.set(url, type)
	return [...byUrl.entries()].map(([url, type]) => ({ url, type }))
}

fs.watch(path.join(__dirname, 'src', 'public'), { recursive: true }, clearCommonCache)
events.on('part-installed', ({ username }) => {
	clearUserPreloadCache(username)
})
events.on('part-uninstalled', ({ username }) => {
	clearUserPreloadCache(username)
})
