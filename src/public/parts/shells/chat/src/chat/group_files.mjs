import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { b64ToU8, u8ToB64 } from '../../../../../../scripts/p2p/bytes_codec.mjs'
import { decryptFile, encryptFile } from '../../../../../../scripts/p2p/gsh.mjs'

import { appendFileUploadEvent } from './dag.mjs'
import { getCurrentH, getHByGeneration } from './gsh_store.mjs'
import { getStorage } from './storage.mjs'

/**
 * 将 GSH 加密包序列化为存储用字节。
 * @param {{ iv: string, ciphertext: string, authTag: string }} enc `encryptFile` 输出
 * @returns {Uint8Array} JSON UTF-8
 */
function packEncrypted(enc) {
	return new TextEncoder().encode(JSON.stringify(enc))
}

/**
 * @param {Uint8Array} bytes 磁盘读取字节
 * @returns {{ iv: string, ciphertext: string, authTag: string }} 加密包
 */
function unpackEncrypted(bytes) {
	const o = JSON.parse(new TextDecoder().decode(bytes))
	if (!o || typeof o !== 'object' || typeof o.iv !== 'string' || typeof o.ciphertext !== 'string' || typeof o.authTag !== 'string')
		throw new Error('invalid encrypted chunk package')
	return o
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
 * @param {unknown} body 请求体
 * @returns {{ fileId: string, data: Uint8Array }} fileId 与明文
 */
function parseChunkBody(body) {
	if (!body || typeof body !== 'object') throw new Error('body required')
	const o = /** @type {Record<string, unknown>} */ body
	const fileId = typeof o.fileId === 'string' ? o.fileId.trim() : ''
	if (!fileId) throw new Error('fileId required')
	let data
	if (typeof o.data === 'string' && o.data.trim())
		data = b64ToU8(o.data)
	else if (o.plainBase64 && typeof o.plainBase64 === 'string')
		data = b64ToU8(o.plainBase64)
	else
		throw new Error('data (base64) required')
	return { fileId, data }
}

/**
 * 上传并 GSH 加密存储单个分块（§10.3）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ fileId: string, data: Uint8Array, keyGeneration?: number }} opts 明文与可选代数
 * @returns {Promise<{ storageLocator: string, chunkHash: string, ivHex: string, key_generation: number }>} 存储定位符与 manifest 字段
 */
export async function putEncryptedChunk(username, groupId, opts) {
	const { fileId, data } = opts
	const hEntry = await getCurrentH(username, groupId)
	if (!hEntry) throw new Error('group GSH not initialized')
	const enc = encryptFile(data, hEntry.h, fileId)
	const packed = packEncrypted(enc)
	const chunkHash = hashBytes(packed)
	const plugin = getStorage(username)
	const { storageLocator } = await plugin.putChunk(groupId, chunkHash, packed)
	return {
		storageLocator,
		chunkHash,
		ivHex: Buffer.from(enc.iv, 'base64').toString('hex'),
		key_generation: typeof opts.keyGeneration === 'number' ? opts.keyGeneration : hEntry.generation,
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
	const plugin = getStorage(username)
	const packed = await plugin.getChunk(storageLocator)
	const enc = unpackEncrypted(packed)
	const gen = typeof keyGeneration === 'number' && Number.isFinite(keyGeneration)
		? Math.floor(keyGeneration)
		: (await getCurrentH(username, groupId))?.generation
	const h = gen != null ? await getHByGeneration(username, groupId, gen) : null
	if (!h) throw new Error('GSH generation not available for file decrypt')
	const plain = decryptFile(enc, h, fileId)
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
	const idx = state.messageOverlay?.fileIndex
	if (!idx) return null
	if (idx instanceof Map) return idx.get(fileId) || null
	if (typeof idx === 'object') return idx[fileId] || null
	return null
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
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			const ch = state.groupSettings?.defaultChannelId || 'default'
			if (!canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, ch))
				return res.status(403).json({ success: false, error: 'No permission to upload files' })

			const out = await putEncryptedChunk(username, groupId, { fileId, data })
			res.status(200).json({ success: true, ...out })
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
			const locator = typeof req.query.locator === 'string' ? req.query.locator : ''
			const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : ''
			const keyGenRaw = req.query.key_generation ?? req.query.keyGeneration
			const key_generation = keyGenRaw != null ? Number(keyGenRaw) : undefined
			if (!locator || !fileId)
				return res.status(400).json({ success: false, error: 'locator and fileId required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const plain = await getDecryptedChunk(username, groupId, fileId, locator, key_generation)
			res.status(200).json({ success: true, data: u8ToB64(plain) })
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
			const body = req.body && typeof req.body === 'object' ? req.body : {}
			const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : ''
			if (!fileId) return res.status(400).json({ success: false, error: 'fileId required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			const ch = state.groupSettings?.defaultChannelId || 'default'
			if (!canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, ch))
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
			const member = state.members[username]
			if (!member || member.status !== 'active')
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
