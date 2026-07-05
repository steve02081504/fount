import { Readable } from 'node:stream'

import { canReadManifest, canWriteManifestPath } from '../../scripts/p2p/entity/files/acl.mjs'
import { loadFileManifest, putFileManifestFromStream, readManifestPlaintextStream } from '../../scripts/p2p/entity/files/evfs.mjs'
import { entityFileUrl, profileAvatarFileUrl } from '../../scripts/p2p/entity/files/url.mjs'
import { getProfile, updateProfile } from '../../scripts/p2p/entity/profile.mjs'
import { isEntityHash128 } from '../../scripts/p2p/entity_id.mjs'
import { assertSafeEvfsLogicalPath } from '../../scripts/p2p/evfs_logical_path.mjs'
import { applyAvatarToAllLocales } from '../../server/p2p_server/localized.mjs'

import { isAllowedImageUpload, pickUploadedFile } from './multipart_upload.mjs'

const MAX_EVFS_UPLOAD_BYTES = 64 * 1024 * 1024

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
export function registerP2pFileEndpoints(router, authenticate, getUserByReq) {
	router.get('/api/p2p/entities/:entityHash/files/*logicalPath', authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const logicalPath = parseEvfsLogicalPath(readWildcardPath(req.params.logicalPath))
		if (!isEntityHash128(entityHash) || !logicalPath)
			return res.status(400).json({ error: 'invalid path' })

		const { username } = getUserByReq(req)
		const manifest = await loadFileManifest(entityHash, logicalPath)
		if (!manifest)
			return res.status(404).json({ error: 'not found' })
		if (!await canReadManifest(username, entityHash, manifest))
			return res.status(403).json({ error: 'Permission denied' })

		if (String(req.query?.manifest || '') === '1')
			return res.status(200).json({ manifest })

		const plain = await readManifestPlaintextStream(username, manifest, { username })
		if (!plain) return res.status(404).json({ error: 'chunk unavailable' })
		res.setHeader('Content-Type', manifest.mimeType || 'application/octet-stream')
		res.setHeader('Content-Length', String(manifest.size || 0))
		plain.pipe(res.status(200))
	})

	router.head('/api/p2p/entities/:entityHash/files/*logicalPath', authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const logicalPath = parseEvfsLogicalPath(readWildcardPath(req.params.logicalPath))
		if (!isEntityHash128(entityHash) || !logicalPath)
			return res.status(400).end()
		const { username } = getUserByReq(req)
		const manifest = await loadFileManifest(entityHash, logicalPath)
		if (!manifest || !await canReadManifest(username, entityHash, manifest))
			return res.status(404).end()
		res.setHeader('Content-Length', String(manifest.size || 0))
		return res.status(200).end()
	})

	router.put('/api/p2p/entities/:entityHash/files/*logicalPath', authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const logicalPath = parseEvfsLogicalPath(readWildcardPath(req.params.logicalPath))
		if (!isEntityHash128(entityHash) || !logicalPath)
			return res.status(400).json({ error: 'invalid path' })

		const { username } = getUserByReq(req)
		if (!await canWriteManifestPath(username, entityHash, logicalPath))
			return res.status(403).json({ error: 'Permission denied' })

		const contentType = String(req.headers['content-type'] || '').toLowerCase()
		if (!contentType.startsWith('application/octet-stream'))
			return res.status(415).json({ error: 'require application/octet-stream' })
		const contentLength = Number(req.headers['content-length'] || 0)
		if (!Number.isFinite(contentLength) || contentLength <= 0)
			return res.status(400).json({ error: 'content-length required' })
		if (contentLength > MAX_EVFS_UPLOAD_BYTES)
			return res.status(413).json({ error: 'file too large' })

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

	router.post('/api/p2p/entities/:entityHash/files/profile/avatar', authenticate, async (req, res) => {
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const { username } = getUserByReq(req)
		if (!isEntityHash128(entityHash))
			return res.status(400).json({ error: 'invalid entityHash' })
		if (!await canWriteManifestPath(username, entityHash, 'profile/avatar'))
			return res.status(403).json({ error: 'Permission denied' })

		const file = pickUploadedFile(req, 'avatar') || pickUploadedFile(req, 'file')
		if (!file) return res.status(400).json({ error: 'No file uploaded' })
		if (!await isAllowedImageUpload(file))
			return res.status(400).json({ error: 'Only image files are allowed' })
		if (file.buffer.length > MAX_EVFS_UPLOAD_BYTES)
			return res.status(413).json({ error: 'file too large' })

		await putFileManifestFromStream({
			ownerEntityHash: entityHash,
			logicalPath: 'profile/avatar',
			readable: Readable.from(file.buffer),
			plainSize: file.buffer.length,
			name: file.originalname || 'avatar',
			mimeType: file.mimetype || 'image/png',
			ceMode: 'convergent',
		})

		const avatarUrl = profileAvatarFileUrl(entityHash)
		const profile = await getProfile(entityHash, username, { skipPresentation: true })
		await updateProfile(username, entityHash, {
			localized: applyAvatarToAllLocales(profile.localized, avatarUrl),
		}, { skipPresentation: true })

		res.status(200).json({ avatarUrl })
	})
}
