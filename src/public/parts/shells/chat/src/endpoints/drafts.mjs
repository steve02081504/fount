import { ms } from 'fount/scripts/ms.mjs'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

import { chatClientFromReq } from './shared.mjs'

/** 草稿保留时长：群退出 / 频道不可见后最多保留 7 年。 */
const DRAFT_RETENTION_MS = 7 * ms('365d')

/**
 * 注册频道草稿路由。草稿按 `key = groupId:channelId` 存于用户数据层：
 * 元数据 + 附件缩略图在 `drafts`，附件完整内容（base64）在 `draftContents`（点击时懒拉取）。
 * 频道被删除 → 调用方立即清理；群退出 / 频道不可见 → 由 lastModified 超过保留期后懒回收。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDraftRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/drafts/:key`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		const key = String(req.params.key || '')
		const { channels } = await client.drafts.list()
		const channel = channels[key] || null
		if (channel && typeof channel.lastModified === 'number'
			&& Date.now() - channel.lastModified > DRAFT_RETENTION_MS) {
			const { removedFileIds } = await client.drafts.remove(key)
			if (removedFileIds.length) await client.draftContents.removeMany(removedFileIds)
			res.status(200).json({ channel: null })
			return
		}
		res.status(200).json({ channel })
	})
	router.put(`${CHAT_API_PREFIX}/drafts/:key`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		const key = String(req.params.key || '')
		const body = req.body || {}
		const filesIn = Array.isArray(body.files) ? body.files : []

		/** @type {object[]} 落盘的附件元数据（含缩略图，不含内容） */
		const files = filesIn
			.map(file => ({
				fileId: String(file?.fileId || ''),
				name: String(file?.name || 'file'),
				mime_type: String(file?.mime_type || 'application/octet-stream'),
				size: Number(file?.size) || 0,
				...file?.description ? { description: String(file.description) } : {},
				...file?.thumbnail ? { thumbnail: String(file.thumbnail) } : {},
			}))
			.filter(file => file.fileId)

		const prev = (await client.drafts.list()).channels[key] || { files: [] }
		const prevIds = new Set((prev.files || []).map(file => file.fileId))
		const nextIds = new Set(files.map(file => file.fileId))
		const removedIds = [...prevIds].filter(fileId => !nextIds.has(fileId))
		if (removedIds.length) await client.draftContents.removeMany(removedIds)

		for (const file of filesIn) 
			if (typeof file?.buffer === 'string' && file.fileId)
				await client.draftContents.put(String(file.fileId), file.buffer)
		

		const record = {
			text: String(body.text || ''),
			...body.content_warning ? { content_warning: String(body.content_warning) } : {},
			...body.sensitive_media ? { sensitive_media: true } : {},
			files,
			lastModified: Date.now(),
		}
		const isEmpty = !record.text && !record.content_warning && !record.sensitive_media && !record.files.length
		await client.drafts.save(key, isEmpty ? null : record)
		res.status(200).json({ channel: isEmpty ? null : record })
	})

	router.delete(`${CHAT_API_PREFIX}/drafts/:key`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		const key = String(req.params.key || '')
		const { channels } = await client.drafts.list()
		const prev = channels[key]
		if (prev) {
			const fileIds = (prev.files || []).map(file => file.fileId).filter(Boolean)
			if (fileIds.length) await client.draftContents.removeMany(fileIds)
		}
		await client.drafts.save(key, null)
		res.status(200).json({ ok: true })
	})

	router.get(`${CHAT_API_PREFIX}/drafts/:key/files/:fileId`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		const key = String(req.params.key || '')
		const fileId = String(req.params.fileId || '')
		const { channels } = await client.drafts.list()
		const draft = channels[key]
		if (!draft || !(draft.files || []).some(file => file.fileId === fileId))
			throw httpError(404, 'draft file not found')
		const { files } = await client.draftContents.list()
		const buffer = files[fileId]
		if (buffer == null) throw httpError(404, 'draft file content not found')
		res.status(200).json({ buffer })
	})
}
