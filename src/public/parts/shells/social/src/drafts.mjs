/**
 * 实体私有发帖草稿箱（本机 JSON，不联邦）。
 */
import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../scripts/http_error.mjs'

import { loadEntityJson, saveEntityJson } from './lib/entityJson.mjs'
import { stripTransientMediaFields } from './lib/mediaRefs.mjs'
import { draftsPath } from './paths.mjs'

const MAX_DRAFTS = 100

/**
 * @returns {{ drafts: object[] }} 空草稿箱（每次新对象）
 */
function emptyDrafts() {
	return { drafts: [] }
}

/**
 * 清洗发帖草稿 body（与 POST /posts 字段对齐）。
 * @param {object} raw 原始 body
 * @returns {object} 可持久化 body
 */
export function sanitizeDraftBody(raw = {}) {
	const body = {}
	const text = String(raw.text ?? '').trim()
	if (text) body.text = text
	const mediaRefs = stripTransientMediaFields(raw.mediaRefs)
	if (mediaRefs.length) body.mediaRefs = mediaRefs
	if (raw.visibility) body.visibility = String(raw.visibility)
	if (Array.isArray(raw.allow) && raw.allow.length)
		body.allow = raw.allow.map(v => String(v).trim().toLowerCase()).filter(Boolean)
	if (Array.isArray(raw.except) && raw.except.length)
		body.except = raw.except.map(v => String(v).trim().toLowerCase()).filter(Boolean)
	if (Array.isArray(raw.albumIds) && raw.albumIds.length)
		body.albumIds = [...new Set(raw.albumIds.map(id => String(id).trim()).filter(Boolean))]
	if (raw.locale) body.locale = String(raw.locale).trim().slice(0, 32)
	if (raw.contentWarning) body.contentWarning = String(raw.contentWarning).trim().slice(0, 200)
	if (raw.sensitiveMedia) body.sensitiveMedia = true
	if (raw.quoteRef?.entityHash && raw.quoteRef?.postId)
		body.quoteRef = {
			entityHash: String(raw.quoteRef.entityHash).toLowerCase(),
			postId: String(raw.quoteRef.postId),
		}
	if (raw.groupRef?.groupId)
		body.groupRef = {
			groupId: String(raw.groupRef.groupId),
			channelId: String(raw.groupRef.channelId || 'default'),
		}
	if (raw.poll && typeof raw.poll === 'object') body.poll = structuredClone(raw.poll)
	if (raw.replyPolicy) body.replyPolicy = String(raw.replyPolicy)
	if (raw.replyDisplay) body.replyDisplay = String(raw.replyDisplay)
	if (raw.publishAt != null) {
		const ms = Number(raw.publishAt)
		if (Number.isFinite(ms) && ms > Date.now()) body.publishAt = ms
	}
	if (Array.isArray(raw.tags) && raw.tags.length) {
		const tags = [...new Set(raw.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 16)
		if (tags.length) body.tags = tags
	}
	return body
}

/**
 * 草稿是否有可发布内容。
 * @param {object} body 草稿 body
 * @returns {boolean} 非空
 */
function isNonEmptyDraft(body) {
	return Boolean(body.text || body.mediaRefs?.length || body.poll)
}

/**
 * 列表预览摘要。
 * @param {object} body 草稿 body
 * @returns {string} 预览
 */
function draftPreview(body) {
	if (body.text) return String(body.text).slice(0, 120)
	if (body.mediaRefs?.length) return '[media]'
	if (body.poll) return '[poll]'
	return ''
}

/**
 * @param {object} row 原始草稿行
 * @returns {object} 带 preview 的行
 */
function withPreview(row) {
	return {
		draftId: row.draftId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		preview: draftPreview(row.body || {}),
		body: row.body || {},
	}
}

/**
 * 读取实体草稿箱。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<{ drafts: object[] }>} 草稿箱
 */
export async function loadDrafts(username, entityHash) {
	try {
		return await loadEntityJson(draftsPath(username, entityHash), emptyDrafts, raw => ({
			drafts: Array.isArray(raw?.drafts) ? raw.drafts.filter(row => row?.draftId && row?.body) : [],
		}))
	}
	catch {
		return emptyDrafts()
	}
}

/**
 * 持久化草稿箱。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {{ drafts: object[] }} data 草稿箱
 * @returns {Promise<{ drafts: object[] }>} 写入后结构
 */
async function saveDrafts(username, entityHash, data) {
	return saveEntityJson(draftsPath(username, entityHash), data)
}

/**
 * 列出草稿（按 updatedAt 降序，含 preview）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<{ drafts: object[] }>} 列表
 */
export async function listDrafts(username, entityHash) {
	const data = await loadDrafts(username, entityHash)
	const drafts = data.drafts
		.map(withPreview)
		.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
	return { drafts }
}

/**
 * 读取单条草稿。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} draftId id
 * @returns {Promise<object>} 草稿行
 */
export async function getDraft(username, entityHash, draftId) {
	const id = String(draftId || '').trim()
	const data = await loadDrafts(username, entityHash)
	const row = data.drafts.find(item => item.draftId === id)
	if (!row) throw httpError(404, 'draft not found')
	return withPreview(row)
}

/**
 * 创建或更新草稿。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} raw body；可选 draftId 表示更新
 * @returns {Promise<object>} 写入后的草稿行
 */
export async function upsertDraft(username, entityHash, raw = {}) {
	const body = sanitizeDraftBody(raw)
	if (!isNonEmptyDraft(body))
		throw httpError(400, 'draft is empty')
	const data = await loadDrafts(username, entityHash)
	const now = Date.now()
	const draftId = String(raw.draftId || '').trim()
	if (draftId) {
		const idx = data.drafts.findIndex(row => row.draftId === draftId)
		if (idx < 0) throw httpError(404, 'draft not found')
		data.drafts[idx] = {
			...data.drafts[idx],
			updatedAt: now,
			body,
		}
		await saveDrafts(username, entityHash, data)
		return withPreview(data.drafts[idx])
	}
	if (data.drafts.length >= MAX_DRAFTS)
		throw httpError(400, `draft limit ${MAX_DRAFTS}`)
	const row = {
		draftId: randomUUID(),
		createdAt: now,
		updatedAt: now,
		body,
	}
	data.drafts.push(row)
	await saveDrafts(username, entityHash, data)
	return withPreview(row)
}

/**
 * 删除草稿。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} draftId id
 * @returns {Promise<{ drafts: object[] }>} 删除后列表
 */
export async function deleteDraft(username, entityHash, draftId) {
	const id = String(draftId || '').trim()
	const data = await loadDrafts(username, entityHash)
	const next = data.drafts.filter(row => row.draftId !== id)
	if (next.length === data.drafts.length)
		throw httpError(404, 'draft not found')
	await saveDrafts(username, entityHash, { drafts: next })
	return listDrafts(username, entityHash)
}
