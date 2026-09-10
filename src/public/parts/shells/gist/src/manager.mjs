import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getUserDictionary } from '../../../../../server/auth/index.mjs'

const GIST_ID_RE = /^[\w-]{1,64}$/

/**
 * 获取用户 gist 存储目录，不存在则递归创建。
 * @param {string} username - 用户名。
 * @returns {Promise<string>} gist 存储目录的绝对路径。
 */
async function getGistDir(username) {
	const dir = path.join(getUserDictionary(username), 'shells', 'gist', 'gists')
	await fs.mkdir(dir, { recursive: true })
	return dir
}

/**
 * 计算 markdown 内容哈希（sha256 十六进制）。
 * @param {string} markdown - markdown 内容。
 * @returns {string} 内容哈希。
 */
function hashMarkdown(markdown) {
	return crypto.createHash('sha256').update(String(markdown ?? ''), 'utf8').digest('hex')
}

/** 用户名 → 内容哈希到 gist id 的索引（懒加载）。 */
const contentIndexByUser = new Map()
/** 用户名 → 正在构建索引的 Promise（避免并发重复扫描）。 */
const contentIndexLoading = new Map()

/**
 * 扫描用户 gist 目录，构建内容哈希索引（同内容以最新创建者为准）。
 * @param {string} username - 用户名。
 * @returns {Promise<Map<string, string>>} 内容哈希 → gist id。
 */
async function buildContentIndex(username) {
	const dir = await getGistDir(username)
	let names
	try {
		names = await fs.readdir(dir)
	}
	catch {
		return new Map()
	}
	const gists = (await Promise.all(names
		.filter(name => name.endsWith('.json'))
		.map(async name => {
			try {
				return JSON.parse(await fs.readFile(path.join(dir, name), 'utf-8'))
			}
			catch {
				return null
			}
		})))
		.filter(gist => gist && typeof gist.id === 'string' && typeof gist.markdown === 'string')
		.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
	const index = new Map()
	for (const gist of gists) index.set(hashMarkdown(gist.markdown), gist.id)
	return index
}

/**
 * 获取用户内容哈希索引（懒加载并缓存）。
 * @param {string} username - 用户名。
 * @returns {Promise<Map<string, string>>} 内容哈希 → gist id。
 */
async function getContentIndex(username) {
	const cached = contentIndexByUser.get(username)
	if (cached) return cached
	let loading = contentIndexLoading.get(username)
	if (!loading) {
		loading = buildContentIndex(username)
			.then(index => {
				contentIndexByUser.set(username, index)
				contentIndexLoading.delete(username)
				return index
			})
			.catch(error => {
				contentIndexLoading.delete(username)
				throw error
			})
		contentIndexLoading.set(username, loading)
	}
	return loading
}

/**
 * 从 markdown 首个非空行生成标题（截断到 60 字符）。
 * @param {string} markdown - markdown 内容。
 * @returns {string} 生成的标题。
 */
function titleFromMarkdown(markdown) {
	const line = String(markdown ?? '').split('\n').find(line => line.trim())
	return (line?.trim() || 'Untitled').slice(0, 60)
}

/** 列表摘要最大字符数。 */
const EXCERPT_MAX = 180

/**
 * 从 markdown 提取纯文本摘要：去除代码块 / 图片 / 链接语法与常见行首标记后压平截断。
 * @param {string} markdown - markdown 内容。
 * @returns {string} 截断后的纯文本摘要。
 */
function excerptFromMarkdown(markdown) {
	return String(markdown ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/~~~[\s\S]*?~~~/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
		.replace(/^[ \t]*[>*+-][ \t]+/gm, '')
		.replace(/[`*_~]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, EXCERPT_MAX)
}

/**
 * 创建新的 gist；`dedupe` 开启时若已有相同 markdown 的 gist 则直接返回该 gist。
 * @param {string} username - 用户名。
 * @param {{ markdown: string, title?: string, securityLevel?: 'secure'|'trusted', source?: object|null, dedupe?: boolean }} data - 创建数据。
 * @returns {Promise<object>} 创建的完整 gist 对象（或命中的既有 gist）。
 */
export async function createGist(username, { markdown, title, securityLevel = 'trusted', source = null, dedupe = false } = {}) {
	const contentIndex = await getContentIndex(username)
	const contentHash = hashMarkdown(markdown)
	if (dedupe) {
		const existingId = contentIndex.get(contentHash)
		if (existingId) {
			const existing = await getGist(username, existingId)
			if (existing) return existing
			contentIndex.delete(contentHash)
		}
	}
	const now = Date.now()
	const gist = {
		id: crypto.randomUUID().slice(0, 8),
		title: title ?? titleFromMarkdown(markdown),
		markdown,
		securityLevel,
		source,
		createdAt: now,
		updatedAt: now,
	}
	await fs.writeFile(path.join(await getGistDir(username), `${gist.id}.json`), JSON.stringify(gist, null, 2), 'utf-8')
	contentIndex.set(contentHash, gist.id)
	return gist
}

/**
 * 按 id 获取单个 gist。
 * @param {string} username - 用户名。
 * @param {string} id - gist 的 id。
 * @returns {Promise<object|null>} gist 对象，不存在返回 null。
 */
export async function getGist(username, id) {
	if (!GIST_ID_RE.test(String(id ?? ''))) return null
	const filepath = path.join(await getGistDir(username), `${id}.json`)
	try {
		return JSON.parse(await fs.readFile(filepath, 'utf-8'))
	}
	catch {
		return null
	}
}

/**
 * 列出用户全部 gist 摘要（不含 markdown，另附 excerpt 纯文本摘要），按 updatedAt 降序（缺失时回退 createdAt）。
 * @param {string} username - 用户名。
 * @returns {Promise<Array<object>>} gist 摘要列表。
 */
export async function listGists(username) {
	const dir = await getGistDir(username)
	let names
	try {
		names = await fs.readdir(dir)
	}
	catch {
		return []
	}
	const gists = (await Promise.all(names
		.filter(name => name.endsWith('.json'))
		.map(async name => {
			try {
				return JSON.parse(await fs.readFile(path.join(dir, name), 'utf-8'))
			}
			catch {
				return null
			}
		})))
		.filter(Boolean)
	return gists
		.map(({ markdown, ...gist }) => ({ ...gist, excerpt: excerptFromMarkdown(markdown) }))
		.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
}

/**
 * 更新 gist 的可变字段。
 * @param {string} username - 用户名。
 * @param {string} id - gist 的 id。
 * @param {{ markdown?: string, title?: string, securityLevel?: 'secure'|'trusted' }} data - 更新数据。
 * @returns {Promise<object|null>} 更新后的完整 gist 对象，不存在返回 null。
 */
export async function updateGist(username, id, data = {}) {
	const gist = await getGist(username, id)
	if (!gist) return null
	if (data.markdown !== undefined) {
		const contentIndex = await getContentIndex(username)
		const oldHash = hashMarkdown(gist.markdown)
		if (contentIndex.get(oldHash) === id) contentIndex.delete(oldHash)
		gist.markdown = data.markdown
		contentIndex.set(hashMarkdown(gist.markdown), id)
	}
	if (data.securityLevel !== undefined) gist.securityLevel = data.securityLevel
	if (data.title !== undefined) gist.title = data.title
	gist.updatedAt = Date.now()
	await fs.writeFile(path.join(await getGistDir(username), `${id}.json`), JSON.stringify(gist, null, 2), 'utf-8')
	return gist
}

/**
 * 批量删除 gist：逐个删除并区分成功与缺失/非法的 id。
 * @param {string} username - 用户名。
 * @param {string[]} ids - gist 的 id 列表。
 * @returns {Promise<{ deleted: string[], missing: string[] }>} 删除结果。
 */
export async function deleteGists(username, ids) {
	const deleted = []
	const missing = []
	for (const id of ids) {
		if (!GIST_ID_RE.test(String(id ?? ''))) {
			missing.push(id)
			continue
		}
		try {
			await fs.unlink(path.join(await getGistDir(username), `${id}.json`))
			deleted.push(id)
		}
		catch {
			missing.push(id)
		}
	}
	if (deleted.length) {
		const deletedIds = new Set(deleted)
		const contentIndex = await getContentIndex(username)
		for (const [contentHash, indexedId] of contentIndex)
			if (deletedIds.has(indexedId)) contentIndex.delete(contentHash)
	}
	return { deleted, missing }
}
