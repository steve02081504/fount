import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getUserDictionary } from '../../../../../server/auth/index.mjs'

const GIST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

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
 * 从 markdown 首个非空行生成标题（截断到 60 字符）。
 * @param {string} markdown - markdown 内容。
 * @returns {string} 生成的标题。
 */
function titleFromMarkdown(markdown) {
	const line = String(markdown ?? '').split('\n').find(line => line.trim())
	return (line?.trim() || 'Untitled').slice(0, 60)
}

/**
 * 创建新的 gist。
 * @param {string} username - 用户名。
 * @param {{ markdown: string, title?: string, securityLevel?: 'secure'|'trusted', source?: object|null }} data - 创建数据。
 * @returns {Promise<object>} 创建的完整 gist 对象。
 */
export async function createGist(username, { markdown, title, securityLevel = 'trusted', source = null } = {}) {
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
 * 列出用户全部 gist（不含 markdown），按 createdAt 降序。
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
		.map(({ markdown, ...gist }) => gist)
		.sort((a, b) => b.createdAt - a.createdAt)
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
	if (data.securityLevel !== undefined) gist.securityLevel = data.securityLevel
	if (data.markdown !== undefined) gist.markdown = data.markdown
	if (data.title !== undefined) gist.title = data.title
	gist.updatedAt = Date.now()
	await fs.writeFile(path.join(await getGistDir(username), `${id}.json`), JSON.stringify(gist, null, 2), 'utf-8')
	return gist
}

/**
 * 删除 gist。
 * @param {string} username - 用户名。
 * @param {string} id - gist 的 id。
 * @returns {Promise<boolean>} 是否删除成功。
 */
export async function deleteGist(username, id) {
	if (!GIST_ID_RE.test(String(id ?? ''))) return false
	const filepath = path.join(await getGistDir(username), `${id}.json`)
	try {
		await fs.unlink(filepath)
		return true
	}
	catch {
		return false
	}
}
