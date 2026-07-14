import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

import { formatHashShort } from 'fount/public/parts/shells/chat/public/shared/entityHash.mjs'

import { httpError } from '../../../../../scripts/http_error.mjs'

import { getEntityProfile } from './lib/entityProfile.mjs'
import { savedPostsPath } from './paths.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'
import { maybeDecryptPostContent } from './vault_crypto/vault.mjs'

const DEFAULT_SAVED = { folders: {}, unfiled: [] }

/**
 * 为收藏引用补充预览文本与作者名。
 * @param {string} username 用户
 * @param {object} ref 帖子引用
 * @returns {Promise<object>} 带 preview / authorName 的引用
 */
async function enrichPostRef(username, ref) {
	const entityHash = ref.entityHash.toLowerCase()
	const postId = ref.postId
	const base = { entityHash, postId }
	const view = await getTimelineMaterialized(username, entityHash)
	const post = view.postById?.[postId]
	if (!post) return base
	const content = await maybeDecryptPostContent(username, entityHash, post.content)
	const profile = await getEntityProfile(username, entityHash)
	let preview = ''
	if (!content) preview = '[unavailable]'
	else if (content?.text) preview = content.text.slice(0, 120)
	else if (content?.mediaRefs?.length) preview = '[media]'
	return {
		...base,
		preview,
		authorName: profile?.name || formatHashShort(entityHash, { headLen: 8, tailLen: 0 }),
		savedAt: ref.savedAt,
	}
}

/**
 * 为收藏夹结构中的帖子引用补充预览信息。
 * @param {string} username 用户
 * @param {object} data 收藏结构
 * @returns {Promise<object>} 带预览的收藏结构
 */
export async function enrichSavedPosts(username, data) {
	const folders = {}
	for (const [folderId, folder] of Object.entries(data.folders)) {
		const posts = []
		for (const ref of folder.posts)
			posts.push(await enrichPostRef(username, ref))
		folders[folderId] = { name: folder.name, posts }
	}
	const unfiled = []
	for (const ref of data.unfiled)
		unfiled.push(await enrichPostRef(username, ref))
	return { folders, unfiled }
}

/**
 * 读取用户收藏帖与文件夹结构。
 * @param {string} username 用户
 * @returns {Promise<{ folders: Record<string, { name: string, posts: object[] }>, unfiled: object[] }>} 收藏结构
 */
export async function loadSavedPosts(username) {
	try {
		return JSON.parse(await readFile(savedPostsPath(username), 'utf8'))
	}
	catch {
		return { ...DEFAULT_SAVED }
	}
}

/**
 * 持久化收藏帖与文件夹结构。
 * @param {string} username 用户
 * @param {object} data 收藏结构
 * @returns {Promise<object>} 写入后的收藏结构
 */
export async function saveSavedPosts(username, data) {
	await mkdir(`${savedPostsPath(username).replace(/[/\\][^/\\]+$/, '')}`, { recursive: true })
	await writeFile(savedPostsPath(username), JSON.stringify(data, null, '\t'), 'utf8')
	return data
}

/**
 * 将帖子引用加入收藏（指定文件夹或未归档）。
 * @param {string} username 用户
 * @param {object} postRef { entityHash, postId }
 * @param {string | null} folderId 文件夹；null=未归档
 * @returns {Promise<object>} 写入后的收藏结构
 */
export async function addSavedPost(username, postRef, folderId = null) {
	const data = await loadSavedPosts(username)
	const ref = {
		entityHash: postRef.entityHash.toLowerCase(),
		postId: postRef.postId,
	}
	if (folderId) {
		data.folders[folderId] ??= { name: folderId, posts: [] }
		if (!data.folders[folderId].posts.some(row =>
			row.entityHash === ref.entityHash && row.postId === ref.postId))
			data.folders[folderId].posts.push(ref)
	}
	else if (!data.unfiled.some(row =>
		row.entityHash === ref.entityHash && row.postId === ref.postId))
		data.unfiled.push(ref)
	return saveSavedPosts(username, data)
}

/**
 * 创建新的收藏文件夹。
 * @param {string} username 用户
 * @param {string} name 文件夹名
 * @returns {Promise<object>} 写入后的收藏结构
 */
export async function createSavedFolder(username, name) {
	const data = await loadSavedPosts(username)
	const folderId = randomUUID()
	data.folders[folderId] = { name: name || 'Folder', posts: [] }
	return saveSavedPosts(username, data)
}

/**
 * 从收藏中移除帖子引用。
 * @param {string} username 用户
 * @param {object} postRef { entityHash, postId }
 * @param {string | null} [folderId] 文件夹 id；省略则从所有文件夹与未归档移除
 * @returns {Promise<object>} 写入后的收藏结构
 */
export async function removeSavedPost(username, postRef, folderId = undefined) {
	const data = await loadSavedPosts(username)
	const entityHash = postRef.entityHash.toLowerCase()
	const postId = postRef.postId

	if (folderId) {
		const folder = data.folders[folderId]
		if (folder) 
			folder.posts = folder.posts.filter(row =>
				!(row.entityHash === entityHash && row.postId === postId))
		
	}
	else {
		data.unfiled = data.unfiled.filter(row =>
			!(row.entityHash === entityHash && row.postId === postId))
		for (const folder of Object.values(data.folders)) 
			folder.posts = folder.posts.filter(row =>
				!(row.entityHash === entityHash && row.postId === postId))
		
	}
	return saveSavedPosts(username, data)
}

/**
 * 重命名收藏文件夹。
 * @param {string} username 用户
 * @param {string} folderId 文件夹 id
 * @param {string} name 新名称
 * @returns {Promise<object>} 写入后的收藏结构
 */
export async function renameSavedFolder(username, folderId, name) {
	const data = await loadSavedPosts(username)
	const folder = data.folders[folderId]
	if (!folder) throw httpError(404, 'folder not found')
	folder.name = (name || folder.name).trim() || folder.name
	return saveSavedPosts(username, data)
}

/**
 * 删除收藏文件夹并将其帖子移至未归档。
 * @param {string} username 用户
 * @param {string} folderId 文件夹 id
 * @returns {Promise<object>} 写入后的收藏结构（帖移至未归档）
 */
export async function deleteSavedFolder(username, folderId) {
	const data = await loadSavedPosts(username)
	const folder = data.folders[folderId]
	if (!folder) return data
	for (const ref of folder.posts) {
		if (data.unfiled.some(row => row.entityHash === ref.entityHash && row.postId === ref.postId))
			continue
		data.unfiled.push(ref)
	}
	delete data.folders[folderId]
	return saveSavedPosts(username, data)
}

/**
 * 在已加载的收藏帖中按正文/作者文本匹配搜索。
 * @param {string} username 用户
 * @param {string} query 搜索串
 * @param {{ limit?: number }} [opts] 选项
 * @returns {Promise<{ posts: object[], query: string }>} 匹配的收藏（含 folderId）
 */
export async function searchSavedPosts(username, query, opts = {}) {
	const q = String(query || '').trim().toLowerCase()
	const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
	const enriched = await enrichSavedPosts(username, await loadSavedPosts(username))
	/** @type {object[]} */
	const posts = []
	/**
	 * @param {object} ref 收藏引用
	 * @param {string | null} folderId 所在文件夹
	 */
	const consider = (ref, folderId) => {
		const haystack = [
			ref.preview,
			ref.authorName,
			ref.entityHash,
		].filter(Boolean).join('\n').toLowerCase()
		if (q && !haystack.includes(q)) return
		posts.push({ ...ref, folderId })
	}
	for (const [folderId, folder] of Object.entries(enriched.folders))
		for (const ref of folder.posts)
			consider(ref, folderId)
	for (const ref of enriched.unfiled)
		consider(ref, null)
	return { query: String(query || '').trim(), posts: posts.slice(0, limit) }
}
