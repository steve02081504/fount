import { Readable } from 'node:stream'

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { assertSafeEvfsLogicalPath } from 'npm:@steve02081504/fount-p2p/core/evfs_logical_path'
import { canReadManifest, canWriteManifestPath } from 'npm:@steve02081504/fount-p2p/files/acl'
import { loadFileManifest, putFileManifestFromStream, readManifestPlaintextStream } from 'npm:@steve02081504/fount-p2p/files/evfs'

import { applySafeContentHeaders } from '../../../../../../scripts/http_content.mjs'
import { httpError } from '../../../../../../scripts/http_error.mjs'
import { isAllowedImageUpload, pickUploadedFile } from '../../../../../../server/web_server/multipart_upload.mjs'

import { entityFileUrl } from './filesUrl.mjs'
import { isWritableLocalEntityForUser } from './http.mjs'
import { resolveOperatorEntityHashForUser } from './identity.mjs'
import { publishOwnerProfileUpdate } from './ownerProfileUpdate.mjs'
import { getProfile, uploadAvatar, uploadBanner } from './profile.mjs'

const CHAT_PREFIX = '/api/parts/shells:chat'
const MAX_EVFS_UPLOAD_BYTES = 64 * 1024 * 1024

/** profile 媒体：写 EVFS 同时回写 profile 字段 */
const PROFILE_MEDIA = {
	'profile/avatar': { kind: 'avatar', sfw: false },
	'profile/sfw_avatar': { kind: 'avatar', sfw: true },
	'profile/banner': { kind: 'banner', sfw: false },
	'profile/sfw_banner': { kind: 'banner', sfw: true },
}

/**
 * @param {string} rawPath URL 解码后的路径段
 * @returns {string | null} 安全 logicalPath；非法时 null
 */
function parseEvfsLogicalPath(rawPath) {
	try {
		return assertSafeEvfsLogicalPath(decodeURIComponent(String(rawPath || '')))
	}
	catch {
		return null
	}
}

/**
 * @param {unknown} wildcardParam 路由通配参数
 * @returns {string} 原始路径字符串
 */
function readWildcardPath(wildcardParam) {
	if (Array.isArray(wildcardParam))
		return wildcardParam.join('/')
	return String(wildcardParam || '')
}

/**
 * @param {import('npm:express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 认证中间件
 * @param {(req: import('npm:express').Request) => { username: string }} getUserByReq 用户解析
 * @returns {void}
 */
export function registerEntityFileEndpoints(router, authenticate, getUserByReq) {
	const filesPath = `${CHAT_PREFIX}/entities/:entityHash/files/*logicalPath`

	router.get(filesPath, authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const logicalPath = parseEvfsLogicalPath(readWildcardPath(req.params.logicalPath))
		if (!isEntityHash128(entityHash) || !logicalPath)
			throw httpError(400, 'invalid path')

		const { username } = getUserByReq(req)
		const manifest = await loadFileManifest(entityHash, logicalPath)
		if (!manifest)
			throw httpError(404, 'not found')
		if (!await canReadManifest(username, entityHash, manifest))
			throw httpError(403, 'Permission denied')

		if (String(req.query?.manifest || '') === '1')
			return res.status(200).json({ manifest })

		const plain = await readManifestPlaintextStream(username, manifest, { username })
		if (!plain) throw httpError(404, 'chunk unavailable')
		applySafeContentHeaders(res, {
			mimeType: manifest.mimeType,
			filename: logicalPath.split('/').pop() || 'file',
		})
		res.setHeader('Content-Length', String(manifest.size || 0))
		plain.pipe(res.status(200))
	})

	router.head(filesPath, authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const logicalPath = parseEvfsLogicalPath(readWildcardPath(req.params.logicalPath))
		if (!isEntityHash128(entityHash) || !logicalPath)
			throw httpError(400, 'invalid path')
		const { username } = getUserByReq(req)
		const manifest = await loadFileManifest(entityHash, logicalPath)
		if (!manifest || !await canReadManifest(username, entityHash, manifest))
			throw httpError(404, 'not found')
		applySafeContentHeaders(res, {
			mimeType: manifest.mimeType,
			filename: logicalPath.split('/').pop() || 'file',
		})
		res.setHeader('Content-Length', String(manifest.size || 0))
		return res.status(200).end()
	})

	router.put(filesPath, authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const logicalPath = parseEvfsLogicalPath(readWildcardPath(req.params.logicalPath))
		if (!isEntityHash128(entityHash) || !logicalPath)
			throw httpError(400, 'invalid path')

		const { username } = getUserByReq(req)
		if (!await canWriteManifestPath(username, entityHash, logicalPath))
			throw httpError(403, 'Permission denied')

		const contentType = String(req.headers['content-type'] || '').toLowerCase()
		if (!contentType.startsWith('application/octet-stream'))
			throw httpError(415, 'require application/octet-stream')
		const contentLength = Number(req.headers['content-length'] || 0)
		if (!Number.isFinite(contentLength) || contentLength <= 0)
			throw httpError(400, 'content-length required')
		if (contentLength > MAX_EVFS_UPLOAD_BYTES)
			throw httpError(413, 'file too large')

		const manifest = await putFileManifestFromStream({
			ownerEntityHash: entityHash,
			logicalPath,
			readable: req,
			plainSize: contentLength,
			name: logicalPath.split('/').pop(),
			mimeType: 'application/octet-stream',
			ceMode: 'convergent',
		})
		res.status(200).json({
			manifest,
			url: entityFileUrl(entityHash, logicalPath),
		})
	})

	/** multipart 写任意 EVFS 路径；`profile/{sfw_,}avatar|banner` 额外回写 profile 字段 */
	router.post(filesPath, authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const logicalPath = parseEvfsLogicalPath(readWildcardPath(req.params.logicalPath))
		if (!isEntityHash128(entityHash) || !logicalPath)
			throw httpError(400, 'invalid path')

		const { username } = getUserByReq(req)
		const file = pickUploadedFile(req, 'file')
		if (!file) throw httpError(400, 'No file uploaded')
		if (file.buffer.length > MAX_EVFS_UPLOAD_BYTES)
			throw httpError(413, 'file too large')

		const profileMedia = PROFILE_MEDIA[logicalPath]
		if (profileMedia)
			return handleProfileMediaUpload(res, username, entityHash, logicalPath, file, profileMedia)

		if (!await canWriteManifestPath(username, entityHash, logicalPath))
			throw httpError(403, 'Permission denied')

		const mimeType = file.mimetype || 'application/octet-stream'
		const filename = file.originalname || logicalPath.split('/').pop() || 'file'
		const manifest = await putFileManifestFromStream({
			ownerEntityHash: entityHash,
			logicalPath,
			readable: Readable.from(file.buffer),
			plainSize: file.buffer.length,
			name: filename,
			mimeType,
			ceMode: 'convergent',
		})
		res.status(200).json({
			manifest,
			url: entityFileUrl(entityHash, logicalPath),
		})
	})
}

/**
 * @param {import('npm:express').Response} res 响应
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} logicalPath EVFS 路径
 * @param {{ buffer: Buffer, originalname?: string, mimetype?: string }} file 上传文件
 * @param {{ kind: 'avatar' | 'banner', sfw: boolean }} media 媒体种类
 * @returns {Promise<void>}
 */
async function handleProfileMediaUpload(res, username, entityHash, logicalPath, file, media) {
	if (!await isAllowedImageUpload(file))
		throw httpError(400, 'Only image files are allowed')

	const defaultName = logicalPath.split('/').pop() || media.kind
	const filename = file.originalname || defaultName
	const mimeType = file.mimetype || 'image/png'

	if (await isWritableLocalEntityForUser(username, entityHash)) {
		if (!await canWriteManifestPath(username, entityHash, logicalPath))
			throw httpError(403, 'Permission denied')
		const url = media.kind === 'avatar'
			? await uploadAvatar(username, entityHash, file.buffer, filename, mimeType, { sfw: media.sfw })
			: await uploadBanner(username, entityHash, file.buffer, filename, mimeType, { sfw: media.sfw })
		res.status(200).json({ url })
		return
	}

	const operatorHash = await resolveOperatorEntityHashForUser(username)
	if (!operatorHash) throw httpError(400, 'operator identity not configured')
	const profile = await getProfile(entityHash, username, { skipPresentation: true, fetchRemote: true })
	if (String(profile?.ownerEntityHash || '').toLowerCase() !== operatorHash)
		throw httpError(403, 'Permission denied')

	const payload = {
		buffer: file.buffer,
		filename,
		mimeType,
		sfw: media.sfw,
	}
	const queued = await publishOwnerProfileUpdate(username, operatorHash, entityHash, {}, media.kind === 'avatar'
		? { avatar: payload }
		: { banner: payload })
	res.status(202).json({ ...queued, url: null })
}
