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

const EXTERNAL_URL_REG = /^https?:\/\//i
const BACKEND_IMPORT_REG = /(?:from\s+["']|import\s*\(\s*["'])(?:node|npm|jsr):/m
const BLOCK_COMMENT_REG = /\/\*[\S\s]*?\*\//g

/**
 * @typedef {'mjs'|'css'|'js'|'resource'} PreloadResourceType
 *
 * @typedef {Object} PreloadResource
 * @property {string} url - 资源的完整 URL
 * @property {PreloadResourceType} type - 资源类型
 * @property {number} [count] - 出现次数（合并后存在）
 */

/**
 * 判断文件内容是否包含仅后端可用的导入（node:/npm:/jsr:），用于整文件排除
 * @param {string} content - 文件内容
 * @returns {boolean} 是否包含仅后端可用的导入
 */
function hasBackendOnlyImports(content) {
	return BACKEND_IMPORT_REG.test(content.replace(BLOCK_COMMENT_REG, ''))
}

/**
 * 从 URL 路径推断资源类型
 * @param {string} url - 完整 URL
 * @returns {PreloadResourceType} 资源类型
 */
function typeFromUrlSuffix(url) {
	try {
		const { pathname } = new URL(url)
		if (/\.mjs$/i.test(pathname)) return 'mjs'
		if (/\.js$/i.test(pathname)) return 'js'
		if (/\.css$/i.test(pathname)) return 'css'
	} catch { /* ignore */ }
	return 'resource'
}

/**
 * 提取 JS/MJS 中的外部 URL（支持 import, import(), fetch, // @fetch-resource）
 * @param {string} content - 文件内容
 * @returns {PreloadResource[]} 提取的资源列表
 */
function extractFromJs(content) {
	const out = []
	const lines = content.replace(BLOCK_COMMENT_REG, '').split(/\r?\n/)

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim()
		if (!line) continue

		const isComment = line.startsWith('//')

		// 忽略页面跳转赋值 (非注释场景)
		if (!isComment && /(?:window\.)?location(?:\.href)?\s*=|\.href\s*=/.test(line))
			continue

		if (isComment) {
			if (/@fetch-resource/i.test(line)) {
				const inlineMatch = line.match(/@fetch-resource\s+(https?:\/\/\S+)/)
				if (inlineMatch)
					out.push({ url: inlineMatch[1], type: typeFromUrlSuffix(inlineMatch[1]) })
				else if (lines[i + 1]) {
					// 匹配下一行的 URL
					const nextMatch = lines[i + 1].match(/(https?:\/\/[^\s"']+)/)
					if (nextMatch) out.push({ url: nextMatch[1], type: typeFromUrlSuffix(nextMatch[1]) })
					i++ // 跳过已处理的下一行
				}
			}
			continue
		}

		// 匹配 import, import(), fetch()
		const urlMatch = line.match(/(?:import\s+(?:[^"']+\s+from\s+)?|import\s*\(\s*|fetch\s*\(\s*)["'](https?:\/\/[^"']+)["']/)
		if (urlMatch) {
			const url = urlMatch[1]
			const type = line.includes('import') ? 'mjs' : typeFromUrlSuffix(url)
			out.push({ url, type })
		}
	}
	return out
}

/**
 * 提取 HTML 中的外部 URL (script, img, video, audio, source 等标签)
 * @param {string} content - 文件内容
 * @returns {PreloadResource[]} 提取的资源列表
 */
function extractFromHtml(content) {
	const out = []
	const tagSrcRe = /<(script|img|video|audio|source)(\s[^>]*)?\s*src\s*=\s*["'](https?:\/\/[^"']+)["']/gi

	for (const match of content.matchAll(tagSrcRe)) {
		const tag = match[1].toLowerCase()
		let type = 'resource'
		if (tag === 'script') type = /type\s*=\s*["']module["']/i.test(match[2] || '') ? 'mjs' : 'js'
		out.push({ url: match[3], type })
	}
	return out
}

/**
 * 提取 JSON 中的外部 URL
 * @param {string} content - 文件内容
 * @returns {PreloadResource[]} 提取的资源列表
 */
function extractFromJson(content) {
	const out = []
	for (const match of content.matchAll(/"(https?:\/\/[^"]+)"/g))
		out.push({ url: match[1], type: typeFromUrlSuffix(match[1]) })
	return out
}

/**
 * 提取 CSS 中的 @import 外部 URL
 * @param {string} content - 文件内容
 * @returns {PreloadResource[]} 提取的资源列表
 */
function extractFromCss(content) {
	const out = []
	const re = /@import\s+(?:url\s*\(\s*)?["']?(https?:\/\/[^\s"'()]+)["']?\)?/g
	for (const match of content.matchAll(re))
		out.push({ url: match[1], type: 'css' })
	return out
}

// 提取器映射表，提升扩展性与可读性
const EXTRACTORS = {
	'.mjs': extractFromJs,
	'.js': extractFromJs,
	'.html': extractFromHtml,
	'.json': extractFromJson,
	'.css': extractFromCss
}

/**
 * 动态分发提取器获取带类型的 URL 列表
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容
 * @returns {PreloadResource[]} 提取的资源列表
 */
function extractTypedUrls(filePath, content) {
	const ext = path.extname(filePath).toLowerCase()
	return EXTRACTORS[ext] ? EXTRACTORS[ext](content) : []
}

/**
 * 合并多条结果并去重，累加出现次数，按次数降序排列
 * @param {PreloadResource[][]} lists - 多条结果的二维数组（支持携带基础 count）
 * @returns {PreloadResource[]} 合并后的资源列表
 */
function mergeAndDedupe(lists) {
	const map = new Map()

	for (const list of lists) for (const { url, type, count = 1 } of list) {
		if (!EXTERNAL_URL_REG.test(url)) continue

		const cur = map.get(url) || { type, count: 0 }
		cur.count += count
		map.set(url, cur)
	}

	return Array.from(map.entries(), ([url, { type, count }]) => ({ url, type, count }))
		.sort((a, b) => b.count - a.count)
}

// =======================
// 文件扫描与目录遍历
// =======================

/**
 * 递归收集目录下指定的扩展名文件
 * @param {string} dir - 根目录
 * @param {string[]} exts - 扩展名列表 (包含点，如 ['.mjs'])
 * @returns {string[]} 文件绝对路径数组
 */
function collectFiles(dir, exts) {
	const out = []
	/**
	 * 递归收集目录下指定的扩展名文件
	 * @param {string} dir - 目录路径
	 * @returns {void}
	 */
	const walk = (dir) => {
		try {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) walk(full)
				else if (exts.includes(path.extname(entry.name).toLowerCase())) out.push(full)
			}
		} catch { /* ignore */ }
	}
	walk(dir)
	return out
}

/**
 * 递归寻找名为 public 的目录 (一旦找到就不再进入其内部寻找)
 * @param {string} root - 根目录
 * @returns {string[]} public 目录绝对路径数组
 */
function collectPublicDirs(root) {
	const out = []
	/**
	 * 递归寻找名为 public 的目录 (一旦找到就不再进入其内部寻找)
	 * @param {string} dir - 目录路径
	 * @returns {void}
	 */
	const walk = (dir) => {
		try {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue
				const full = path.join(dir, entry.name)
				if (entry.name === 'public') out.push(full)
				else walk(full)
			}
		} catch { /* ignore */ }
	}
	walk(root)
	return out
}

/**
 * 扫描指定目录下的文件，并提取资源
 * @param {string} rootDir - 根目录
 * @returns {PreloadResource[]} 提取的资源列表
 */
function scanDirectoryForTypedUrls(rootDir) {
	const EXTS = ['.mjs', '.js', '.html', '.json', '.css']
	const all = []

	for (const file of collectFiles(rootDir, EXTS)) try {
		const content = fs.readFileSync(file, 'utf8')
		if (!hasBackendOnlyImports(content))
			all.push(extractTypedUrls(file, content))
	} catch { /* ignore */ }
	return mergeAndDedupe(all)
}

// =======================
// 缓存与核心业务逻辑
// =======================

const PUBLIC_ROOT = path.join(__dirname, 'src', 'public')

/** @type {PreloadResource[] | null} */
let commonCache = null

/** @type {Map<string, PreloadResource[]>} */
const userCaches = new Map()

/**
 * 获取或构建全局共用预加载列表
 * @returns {PreloadResource[]} 全局共用预加载列表
 */
function getCommonPreloadUrls() {
	if (commonCache) return commonCache

	const lists = []
	const pagesDir = path.join(PUBLIC_ROOT, 'pages')
	const partsDir = path.join(PUBLIC_ROOT, 'parts')

	if (fs.existsSync(pagesDir)) lists.push(scanDirectoryForTypedUrls(pagesDir))
	if (fs.existsSync(partsDir))
		for (const publicDir of collectPublicDirs(partsDir))
			lists.push(scanDirectoryForTypedUrls(publicDir))

	return commonCache = mergeAndDedupe(lists)
}

/**
 * 获取或构建指定用户的预加载列表
 * @param {string} username - 用户名
 * @returns {PreloadResource[]} 指定用户的预加载列表
 */
function getCachedUserPreloadUrls(username) {
	if (userCaches.has(username)) return userCaches.get(username)

	const lists = []
	const userRoot = getUserDictionary(username)
	for (const publicDir of collectPublicDirs(userRoot))
		lists.push(scanDirectoryForTypedUrls(publicDir))

	const result = mergeAndDedupe(lists)
	userCaches.set(username, result)
	return result
}

/**
 * 获取预加载 URL 列表。
 * username 为空仅返回公用列表；否则将公用列表与用户级列表合并，累加 count 后降序返回。
 *
 * @param {string} [username] - 已登录用户名
 * @returns {PreloadResource[]} 指定用户的预加载列表
 */
export function getUserPreloadUrls(username) {
	const common = getCommonPreloadUrls()
	if (!username) return common

	const user = getCachedUserPreloadUrls(username)
	return mergeAndDedupe([common, user])
}

// =======================
// 缓存清理与监听
// =======================

fs.watch(PUBLIC_ROOT, { recursive: true }, () => { commonCache = null })

events.on('part-installed', ({ username }) => userCaches.delete(username))
events.on('part-uninstalled', ({ username }) => userCaches.delete(username))

events.on('AfterUserDeleted', ({ username }) => userCaches.delete(username))
events.on('AfterUserRenamed', ({ oldUsername, newUsername }) => {
	if (userCaches.has(oldUsername)) userCaches.set(newUsername, userCaches.get(oldUsername))
	userCaches.delete(oldUsername)
})
