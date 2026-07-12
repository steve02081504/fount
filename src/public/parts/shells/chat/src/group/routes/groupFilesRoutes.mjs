/**
 * 【文件】group/routes/groupFilesRoutes.mjs
 * 【职责】群文件 HTTP 路由（chunks/files CRUD、下载状态）。
 * 【关联】chat/files/groupFiles.mjs；由 governance.mjs mount。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { appendFileDeleteEvent, appendFileSystemUpdateEvent, appendFileUploadEvent } from '../../chat/dag/channelOps.mjs'
import { getCurrentFileMasterKey } from '../../chat/file_keys/store.mjs'
import { hasCiphertextBlob, getCiphertextBlob } from '../../chat/files/blobStore.mjs'
import { loadDownloadTask, summarizeDownloadTask } from '../../chat/files/downloadTasks.mjs'
import {
	assertFileUploadBody,
	fileMetaFromState,
	getDecryptedFile,
	normalizeCeMode,
	parseChunkBody,
	putEncryptedChunk,
	registerEncryptedChunkIfPresent,
	syncGroupFileManifest,
	uploadPermissionChannelId,
} from '../../chat/files/groupFiles.mjs'
import { resolveActiveMemberKeyForLocalUser } from '../access.mjs'

import { GROUPS_PREFIX } from './path.mjs'

/**
 * 注册群文件 HTTP 路由（§10.3 收敛加密）。
 * @param {import('npm:express').Router} router 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @param {(req: import('npm:express').Request) => Promise<{ username: string }>} getUserByReq 解析用户
 * @param {(username: string, groupId: string) => Promise<{ state: object }>} getState 物化状态
 * @param {(state: object, member: object, permission: string, channelId: string) => boolean} canInChannel 权限检查
 * @param {typeof import('../../../../../../../permissions/chat.mjs').PERMISSIONS} PERMISSIONS 权限常量
 * @returns {void}
 */
export function registerGroupFileRoutes(router, authenticate, getUserByReq, getState, canInChannel, PERMISSIONS) {
	router.post(`${GROUPS_PREFIX}/:groupId/chunks/have`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const { state } = await getState(username, groupId)
		if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state))
			return res.status(403).json({ error: 'Not a member' })

		const ceMode = normalizeCeMode(req.body?.ceMode)
		if (ceMode === 'random')
			return res.status(200).json({ ciphertextHash: null, have: false, storageLocator: null })

		const ciphertextHash = String(req.body?.ciphertextHash || '').trim().toLowerCase()
		if (!isHex64(ciphertextHash))
			return res.status(400).json({ error: 'ciphertextHash required' })

		const have = await hasCiphertextBlob(username, ciphertextHash)
		const sizeHint = Number(req.body?.size)
		let sizeOk = true
		if (have && Number.isFinite(sizeHint) && sizeHint >= 0)
			try {
				const raw = await getCiphertextBlob(username, `blob:${ciphertextHash}`)
				sizeOk = raw.length === Math.floor(sizeHint)
			}
			catch {
				sizeOk = false
			}

		res.status(200).json({
			ciphertextHash,
			have: have && sizeOk,
			storageLocator: have && sizeOk ? `blob:${ciphertextHash}` : null,
		})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/chunks`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const { fileId, data } = parseChunkBody(req.body)
		const { state } = await getState(username, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
		if (!memberKey)
			return res.status(403).json({ error: 'Not a member' })
		const member = state.members[memberKey]
		const permChannelId = uploadPermissionChannelId(state, req.body?.channelId)
		if (!canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, permChannelId))
			return res.status(403).json({ error: 'No permission to upload files' })

		const ceMode = normalizeCeMode(req.body?.ceMode)
		if (req.body?.registerOnly) {
			if (ceMode === 'random')
				return res.status(400).json({ error: 'registerOnly not supported for random ceMode' })
			const registered = await registerEncryptedChunkIfPresent(username, groupId, { fileId, data, ceMode })
			if (!registered)
				return res.status(404).json({ error: 'ciphertext not on this node' })
			return res.status(200).json({ ...registered })
		}

		res.status(200).json({
			...await putEncryptedChunk(username, groupId, {
				fileId,
				data,
				channelId: String(req.body?.channelId || '').trim() || undefined,
				ceMode,
			})
		})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/files`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const { body } = req
		const fileId = body.fileId?.trim()
		if (!fileId) return res.status(400).json({ error: 'fileId required' })
		assertFileUploadBody(body)

		const { state } = await getState(username, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
		if (!memberKey)
			return res.status(403).json({ error: 'Not a member' })
		const member = state.members[memberKey]
		const permChannelId = uploadPermissionChannelId(state, body.channelId)
		if (!canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, permChannelId))
			return res.status(403).json({ error: 'No permission to upload files' })

		const keyEntry = await getCurrentFileMasterKey(username, groupId)
		/** @type {object} */
		const uploadMeta = {
			fileId,
			name: body.name,
			size: body.size,
			mimeType: body.mimeType,
			folderId: body.folderId,
			ceMode: normalizeCeMode(body.ceMode),
			contentHash: body.contentHash,
			key_generation: body.key_generation ?? keyEntry?.generation,
		}
		if (Array.isArray(body.parts) && body.parts.length)
			uploadMeta.parts = body.parts
		else {
			uploadMeta.ciphertextHash = body.ciphertextHash
			uploadMeta.wrappedKey = body.wrappedKey
			uploadMeta.storageLocator = body.storageLocator
		}
		const event = await appendFileUploadEvent(username, groupId, uploadMeta)
		await syncGroupFileManifest(username, groupId, uploadMeta).catch(error => {
			console.error('[evfs] syncGroupFileManifest failed', error)
		})
		res.status(201).json({ event })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/file-system`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const body = req.body || {}
		const { operation } = body
		const folderId = body.folderId?.trim()
		if (!folderId) return res.status(400).json({ error: 'folderId required' })
		if (!['create', 'rename', 'move', 'delete'].includes(operation))
			return res.status(400).json({ error: 'operation must be create|rename|move|delete' })

		const { state } = await getState(username, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
		if (!memberKey)
			return res.status(403).json({ error: 'Not a member' })
		const member = state.members[memberKey]
		const defaultChannelId = state.groupSettings?.defaultChannelId || 'default'
		if (!canInChannel(state, member, PERMISSIONS.MANAGE_FILES, defaultChannelId)
			&& !canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, defaultChannelId))
			return res.status(403).json({ error: 'No permission to manage file folders' })

		const event = await appendFileSystemUpdateEvent(username, groupId, {
			operation,
			folderId,
			name: body.name,
			parentFolderId: body.parentFolderId,
		}, username)
		res.status(201).json({ event })
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/files/:fileId`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const fileId = decodeURIComponent(req.params.fileId)
		const { state } = await getState(username, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
		if (!memberKey)
			return res.status(403).json({ error: 'Not a member' })
		const defaultChannelId = state.groupSettings?.defaultChannelId || 'default'
		const member = state.members[memberKey]
		if (!canInChannel(state, member, PERMISSIONS.MANAGE_FILES, defaultChannelId)
			&& !canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, defaultChannelId))
			return res.status(403).json({ error: 'No permission to delete files' })
		const meta = fileMetaFromState(state, fileId)
		if (!meta || meta.deleted)
			return res.status(404).json({ error: 'File not found' })
		const event = await appendFileDeleteEvent(username, groupId, fileId)
		res.status(200).json({ event })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/files/:fileId/meta`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const fileId = decodeURIComponent(req.params.fileId)
		const { state } = await getState(username, groupId)
		if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state))
			return res.status(403).json({ error: 'Not a member' })

		const meta = fileMetaFromState(state, fileId)
		if (!meta || meta.deleted)
			return res.status(404).json({ error: 'File not found' })
		const hasParts = Array.isArray(meta.parts) && meta.parts.length
		if (!meta.contentHash || (!hasParts && !meta.storageLocator))
			return res.status(404).json({ error: 'File metadata incomplete' })

		res.status(200).json({
			fileId,
			name: meta.name,
			size: meta.size,
			mimeType: meta.mimeType,
			contentHash: meta.contentHash,
			ceMode: meta.ceMode || 'convergent',
			ciphertextHash: meta.ciphertextHash,
			storageLocator: meta.storageLocator,
			wrappedKey: meta.wrappedKey,
			key_generation: meta.key_generation,
			parts: hasParts ? meta.parts : undefined,
			totalSize: meta.size,
			uploaderPubKeyHash: meta.uploaderPubKeyHash || null,
		})
	})

	router.get(`${GROUPS_PREFIX}/:groupId/files/:fileId/download-status`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const fileId = decodeURIComponent(req.params.fileId)
		const { state } = await getState(username, groupId)
		if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state))
			return res.status(403).json({ error: 'Not a member' })
		const meta = fileMetaFromState(state, fileId)
		if (!meta || meta.deleted)
			return res.status(404).json({ error: 'File not found' })
		const task = await loadDownloadTask(username, groupId, fileId)
		res.status(200).json({
			fileId,
			status: summarizeDownloadTask(task),
		})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/files/:fileId/download-resume`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params.groupId
		const fileId = decodeURIComponent(req.params.fileId)
		const { state } = await getState(username, groupId)
		if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state))
			return res.status(403).json({ error: 'Not a member' })
		const meta = fileMetaFromState(state, fileId)
		if (!meta || meta.deleted)
			return res.status(404).json({ error: 'File not found' })
		// 单块与 multipart 统一走 getDecryptedFile：真正触发内容获取（本地 CAS 命中即完成，
		// 本地缺失则经 resolveCiphertextRaw 的联邦 fetch 路径）并由侧车维护 download task。
		try {
			await getDecryptedFile(username, groupId, { ...meta, fileId }, undefined)
		}
		catch {
			// 下载状态已由任务侧车记录
		}
		const task = await loadDownloadTask(username, groupId, fileId)
		res.status(200).json({
			ok: true,
			fileId,
			status: summarizeDownloadTask(task),
		})
	})
}
