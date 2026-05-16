import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { b64ToU8, u8ToB64 } from '../../../../../../scripts/p2p/bytes_codec.mjs'
import { decryptFile, encryptFile } from '../../../../../../scripts/p2p/gsh.mjs'

import { appendFileUploadEvent } from './dag.mjs'
import { getCurrentH, getHByGeneration } from './gsh_store.mjs'
import { getStorage } from './storage.mjs'

/**
 * 将 GSH 加密包序列化为存储用字节。
 * @param {{ iv: string, ciphertext: string, authTag: string }} encrypted `encryptFile` 输出
 * @returns {Uint8Array} JSON UTF-8
 */
function packEncrypted(encrypted) {
	return new TextEncoder().encode(JSON.stringify(encrypted))
}

/**
 * @param {Uint8Array} bytes 磁盘读取字节
 * @returns {{ iv: string, ciphertext: string, authTag: string }} 加密包
 */
function unpackEncrypted(bytes) {
	const packet = JSON.parse(new TextDecoder().decode(bytes))
	return packet
}

/**
 * @param {Uint8Array} data 密文字节
 * @returns {string} SHA-256 hex（chunkHash / manifest）
 */
function hashBytes(data) {
	return createHash('sha256').update(data).digest('hex')
}

/**
 * 解析上传用 fileId 与分块明文。
 * @param {{ fileId?: string, data?: string }} body 请求体
 * @returns {{ fileId: string, data: Uint8Array }} fileId 与明文
 */
function parseChunkBody(body) {
	const fileId = body.fileId?.trim()
	if (!fileId) throw new Error('fileId required')
	if (!body.data?.trim()) throw new Error('data (base64) required')
	return { fileId, data: b64ToU8(body.data) }
}

/**
 * 上传并 GSH 加密存储单个分块（§10.3）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ fileId: string, data: Uint8Array, keyGeneration?: number }} opts 明文与可选代数
 * @returns {Promise<{ storageLocator: string, chunkHash: string, ivHex: string, key_generation: number }>} 存储定位符与 manifest 字段
 */
export async function putEncryptedChunk(username, groupId, opts) {
	const hEntry = await getCurrentH(username, groupId)
	if (!hEntry) throw new Error('group GSH not initialized')
	const encrypted = encryptFile(opts.data, hEntry.h, opts.fileId)
	const packed = packEncrypted(encrypted)
	const chunkHash = hashBytes(packed)
	const { storageLocator } = await getStorage(username).putChunk(groupId, chunkHash, packed)
	return {
		storageLocator,
		chunkHash,
		ivHex: Buffer.from(encrypted.iv, 'base64').toString('hex'),
		key_generation: opts.keyGeneration ?? hEntry.generation,
	}
}

/**
 * 读取分块并解密为明文。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} fileId 文件 ID
 * @param {string} storageLocator 存储定位符
 * @param {number} [keyGeneration] 上传时记录的 H 代数
 * @returns {Promise<Uint8Array>} 明文
 */
export async function getDecryptedChunk(username, groupId, fileId, storageLocator, keyGeneration) {
	const packed = await getStorage(username).getChunk(storageLocator)
	const generation = keyGeneration ?? (await getCurrentH(username, groupId))?.generation
	const groupSecret = generation != null ? await getHByGeneration(username, groupId, Math.floor(generation)) : null
	if (!groupSecret) throw new Error('GSH generation not available for file decrypt')
	const plain = decryptFile(unpackEncrypted(packed), groupSecret, fileId)
	if (!plain) throw new Error('file chunk decrypt failed')
	return plain
}

/**
 * 从物化状态 fileIndex 取文件元数据。
 * @param {object} state 群状态
 * @param {string} fileId 文件 ID
 * @returns {object | null} 索引项
 */
export function fileMetaFromState(state, fileId) {
	const fileIndex = state.messageOverlay?.fileIndex
	if (!fileIndex) return null
	if (fileIndex instanceof Map) return fileIndex.get(fileId) || null
	return fileIndex[fileId] || null
}

/**
 * 注册群文件 HTTP 路由（GSH 加解密在服务端；§10.3）。
 * @param {import('npm:express').Router} router 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @param {(req: import('npm:express').Request) => Promise<{ username: string }>} getUserByReq 解析用户
 * @param {(username: string, groupId: string) => Promise<{ state: object }>} getState 物化状态
 * @param {(state: object, member: object, permission: string, channelId: string) => boolean} canInChannel 权限检查
 * @param {typeof import('../../../../../scripts/p2p/permissions.mjs').PERMISSIONS} PERMISSIONS 权限常量
 * @returns {void}
 */
export function registerGroupFileRoutes(router, authenticate, getUserByReq, getState, canInChannel, PERMISSIONS) {
	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/chunks$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { fileId, data } = parseChunkBody(req.body)
			const { state } = await getState(username, groupId)
			if (state.members[username]?.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			const defaultChannelId = state.groupSettings?.defaultChannelId || 'default'
			if (!canInChannel(state, state.members[username], PERMISSIONS.UPLOAD_FILES, defaultChannelId))
				return res.status(403).json({ success: false, error: 'No permission to upload files' })

			res.status(200).json({ success: true, ...await putEncryptedChunk(username, groupId, { fileId, data }) })
		}
		catch (error) {
			console.error('Put chunk error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/chunks$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const storageLocator = String(req.query.locator || '')
			const fileId = String(req.query.fileId || '')
			const keyGeneration = req.query.key_generation != null ? Number(req.query.key_generation) : undefined
			if (!storageLocator || !fileId)
				return res.status(400).json({ success: false, error: 'locator and fileId required' })

			const { state } = await getState(username, groupId)
			if (state.members[username]?.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			res.status(200).json({
				success: true,
				data: u8ToB64(await getDecryptedChunk(username, groupId, fileId, storageLocator, keyGeneration)),
			})
		}
		catch (error) {
			console.error('Get chunk error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/files$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const body = req.body
			const fileId = body.fileId?.trim()
			if (!fileId) return res.status(400).json({ success: false, error: 'fileId required' })

			const { state } = await getState(username, groupId)
			if (state.members[username]?.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			const defaultChannelId = state.groupSettings?.defaultChannelId || 'default'
			if (!canInChannel(state, state.members[username], PERMISSIONS.UPLOAD_FILES, defaultChannelId))
				return res.status(403).json({ success: false, error: 'No permission to upload files' })

			const hEntry = await getCurrentH(username, groupId)
			const event = await appendFileUploadEvent(username, groupId, {
				fileId,
				name: body.name,
				size: body.size,
				mimeType: body.mimeType,
				folderId: body.folderId,
				chunkManifest: body.chunkManifest,
				sender: username,
				key_generation: hEntry?.generation,
			})
			res.status(201).json({ success: true, event })
		}
		catch (error) {
			console.error('File upload DAG error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/files\/([^/]+)\/meta$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const fileId = decodeURIComponent(req.params[1])
			const { state } = await getState(username, groupId)
			if (state.members[username]?.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const meta = fileMetaFromState(state, fileId)
			if (!meta || meta.deleted)
				return res.status(404).json({ success: false, error: 'File not found' })

			res.status(200).json({
				success: true,
				fileId,
				name: meta.name,
				size: meta.size,
				mimeType: meta.mimeType,
				chunkManifest: meta.chunkManifest || [],
				key_generation: meta.key_generation,
				totalSize: meta.size,
			})
		}
		catch (error) {
			console.error('File meta error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})
}
