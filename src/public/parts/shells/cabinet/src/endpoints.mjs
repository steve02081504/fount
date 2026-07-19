import { Buffer } from 'node:buffer'

import { loadFileManifest, readManifestPlaintext } from 'npm:@steve02081504/fount-p2p/files/evfs'

import { applySafeContentHeaders } from '../../../../../scripts/http_content.mjs'
import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHashForUser } from '../../chat/src/entity/identity.mjs'

import {
	createCabinet,
	deleteCabinet,
	getCabinet,
	loadCabinets,
	updateCabinet,
} from './cabinets.mjs'
import {
	copyEntries,
	deleteEntries,
	finalizeDelete,
	listEntries,
	readPersonalEntryBytes,
	registerEntry,
	restoreEntries,
	unlockFolder,
	updateEntry,
	uploadAndRegister,
	uploadPreview,
} from './entries.mjs'
import { buildFolderTrail, listChildren } from './entryModel.mjs'
import { runCabinetSync, setSyncBinding } from './folderSync.mjs'
import { resolveLink } from './links.mjs'
import { fetchRemoteCabinetIndex, fetchRemoteCabinets } from './remote.mjs'
import { createSharedCabinet, listLocalSharedCabinets } from './shared/keys.mjs'
import { downloadSharedEntry } from './shared/ops.mjs'
import { zipCabinetFolder } from './zip.mjs'

const PREFIX = '/api/parts/shells\\:cabinet'

/**
 * @param {import('npm:express').Request} req 请求
 * @param {object} [body] 请求体
 * @returns {string | undefined} unlock token
 */
function unlockToken(req, body) {
	return req.get('X-Cabinet-Unlock') || body?.unlock_token
}

/**
 * @param {import('npm:express').Request} req 请求
 * @returns {Promise<{ username: string, entityHash: string }>} 上下文
 */
async function ctxFromReq(req) {
	const { username } = getUserByReq(req)
	const entityHash = await resolveOperatorEntityHashForUser(username)
	if (!entityHash) throw httpError(400, 'operator identity required')
	return { username, entityHash }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<object>} 远端可见性上下文
 */
async function remoteViewerCtx(username, entityHash) {
	/** @type {{ following: Set<string>, followSince: Map<string, number> }} */
	let follow = { following: new Set(), followSince: new Map() }
	try {
		const { loadViewerContext } = await import('../../social/src/feed/home.mjs')
		follow = await loadViewerContext(username, entityHash)
	}
	catch { /* social 可选 */ }
	return {
		viewerEntityHash: entityHash,
		following: follow.following || new Set(),
		followSince: follow.followSince || new Map(),
		at: Date.now(),
	}
}

/**
 * @param {import('npm:express').Response} res 响应
 * @param {Buffer | Uint8Array} bytes 字节
 * @param {string} filename 文件名
 * @returns {void}
 */
function sendAttachment(res, bytes, filename) {
	applySafeContentHeaders(res, { forceAttachment: true, filename })
	res.status(200).send(Buffer.from(bytes))
}

/**
 * @param {import('npm:express').Request} req 请求
 * @returns {string} recovery token
 */
function requireRecoveryToken(req) {
	const recoveryToken = String(req.body?.recovery_token || '')
	if (!recoveryToken) throw httpError(400, 'recovery_token required')
	return recoveryToken
}

/**
 * @param {import('npm:express').Router} router 路由
 * @returns {void}
 */
export function setEndpoints(router) {
	router.get(`${PREFIX}/viewer`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json({ username, viewer_entity_hash: entityHash })
	})

	router.get(`${PREFIX}/cabinets`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const personal = await loadCabinets(username, entityHash)
		const shared = await listLocalSharedCabinets(username).catch(() => [])
		const byId = new Map()
		for (const row of [...personal, ...shared]) byId.set(row.cabinet_id, row)
		res.status(200).json({ cabinets: [...byId.values()] })
	})

	router.post(`${PREFIX}/cabinets`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		if (req.body?.type === 'shared') {
			const { cabinet } = await createSharedCabinet(username, { name: req.body.name })
			return res.status(200).json({ cabinet })
		}
		res.status(200).json({ cabinet: await createCabinet(username, entityHash, req.body || {}) })
	})

	router.patch(`${PREFIX}/cabinets/:cabinetId`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json({ cabinet: await updateCabinet(username, entityHash, req.params.cabinetId, req.body || {}) })
	})

	router.delete(`${PREFIX}/cabinets/:cabinetId`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		await deleteCabinet(username, entityHash, req.params.cabinetId)
		res.status(200).json({ ok: true })
	})

	router.get(`${PREFIX}/cabinets/:cabinetId/index`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await listEntries(username, entityHash, req.params.cabinetId, {
			parent_id: req.query.parent_id,
			show_hidden: req.query.show_hidden === '1' || req.query.show_hidden === 'true',
			unlock_token: unlockToken(req),
		}))
	})

	router.get(`${PREFIX}/cabinets/:cabinetId/entries/:entryId/download`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const { cabinetId, entryId } = req.params
		if (await getCabinet(username, entityHash, cabinetId)) 
			try {
				return sendAttachment(res, await readPersonalEntryBytes(username, entityHash, cabinetId, entryId), entryId)
			}
			catch (error) {
				const msg = String(error?.message || '')
				if (msg === 'file not found' || msg === 'blob missing') throw httpError(404, msg)
				if (msg === 'decrypt failed') throw httpError(500, msg)
				throw error
			}
		
		sendAttachment(res, await downloadSharedEntry(username, cabinetId, entryId), entryId)
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/unlock`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const folderId = String(req.body?.folder_id || '')
		const password = String(req.body?.password || '')
		if (!folderId || !password) throw httpError(400, 'folder_id and password required')
		res.status(200).json(await unlockFolder(username, entityHash, req.params.cabinetId, folderId, password))
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/entries`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const body = req.body || {}
		const unlock = unlockToken(req, body)
		if (body.plaintext_base64) 
			return res.status(200).json({
				entry: await uploadAndRegister(username, entityHash, req.params.cabinetId, {
					plaintext: Buffer.from(body.plaintext_base64, 'base64'),
					name: body.name,
					mime_type: body.mime_type,
					parent_id: body.parent_id,
					attrs: body.attrs,
					preview: body.preview,
					description: body.description,
					unlock_token: unlock,
				}),
			})
		
		res.status(200).json({
			entry: await registerEntry(username, entityHash, req.params.cabinetId, { ...body, unlock_token: unlock }),
		})
	})

	router.patch(`${PREFIX}/cabinets/:cabinetId/entries/:entryId`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json({
			entry: await updateEntry(username, entityHash, req.params.cabinetId, req.params.entryId, {
				...req.body || {},
				unlock_token: unlockToken(req, req.body),
			}),
		})
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/entries/copy`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json({
			entries: await copyEntries(username, entityHash, req.params.cabinetId, {
				...req.body || {},
				unlock_token: unlockToken(req, req.body),
			}),
		})
	})

	router.delete(`${PREFIX}/cabinets/:cabinetId/entries`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await deleteEntries(
			username, entityHash, req.params.cabinetId,
			Array.isArray(req.body?.entry_ids) ? req.body.entry_ids : [],
			{ recoverable: Boolean(req.body?.recoverable), unlock_token: unlockToken(req, req.body) },
		))
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/entries/restore`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await restoreEntries(username, entityHash, req.params.cabinetId, requireRecoveryToken(req), {
			unlock_token: unlockToken(req, req.body),
		}))
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/entries/finalize-delete`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await finalizeDelete(username, entityHash, req.params.cabinetId, requireRecoveryToken(req)))
	})

	router.get(`${PREFIX}/cabinets/:cabinetId/entries/:entryId/resolve`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await resolveLink(username, entityHash, req.params.cabinetId, req.params.entryId))
	})

	router.get(`${PREFIX}/cabinets/:cabinetId/zip`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const cabinetId = req.params.cabinetId
		const result = await zipCabinetFolder(username, entityHash, cabinetId, {
			folder_id: req.query.parent_id || req.query.folder_id,
			unlock_token: unlockToken(req),
			/**
			 * @param {string} evfsPath EVFS 路径
			 * @param {object} [entry] 条目
			 * @returns {Promise<Uint8Array>} 明文
			 */
			async readFile(evfsPath, entry) {
				if (entry?.id && !await getCabinet(username, entityHash, cabinetId))
					return new Uint8Array(await downloadSharedEntry(username, cabinetId, entry.id))
				const manifest = await loadFileManifest(entityHash, evfsPath)
				if (!manifest) throw new Error('missing')
				const plain = await readManifestPlaintext(username, manifest)
				return plain instanceof Uint8Array ? plain : new Uint8Array(plain)
			},
		})
		res.setHeader('Content-Type', 'application/zip')
		res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
		res.status(200).send(Buffer.from(result.bytes))
	})

	router.put(`${PREFIX}/cabinets/:cabinetId/sync-binding`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json({ cabinet: await setSyncBinding(username, entityHash, req.params.cabinetId, req.body || {}) })
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/sync`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await runCabinetSync(username, entityHash, req.params.cabinetId))
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/preview`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const plaintext = Buffer.from(String(req.body?.plaintext_base64 || ''), 'base64')
		if (!plaintext.length) throw httpError(400, 'plaintext_base64 required')
		res.status(200).json(await uploadPreview(username, entityHash, req.params.cabinetId, {
			plaintext,
			name: req.body?.name,
			mime_type: req.body?.mime_type,
		}))
	})

	router.get(`${PREFIX}/remote/:entityHash/cabinets`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const owner = String(req.params.entityHash).toLowerCase()
		res.status(200).json({
			cabinets: await fetchRemoteCabinets(username, owner, await remoteViewerCtx(username, entityHash)),
		})
	})

	router.get(`${PREFIX}/remote/:entityHash/cabinets/:cabinetId/index`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const owner = String(req.params.entityHash).toLowerCase()
		const ctx = await remoteViewerCtx(username, entityHash)
		const cabinets = await fetchRemoteCabinets(username, owner, ctx)
		const meta = cabinets.find(row => row.cabinet_id === req.params.cabinetId) || {
			visibility: { visibility: 'public' },
		}
		const index = await fetchRemoteCabinetIndex(username, owner, req.params.cabinetId, ctx, meta)
		const parentId = req.query.parent_id || null
		res.status(200).json({
			cabinet: meta,
			version: index.version,
			folder_trail: buildFolderTrail(index.entries, parentId),
			entries: listChildren(index.entries, parentId, { show_hidden: req.query.show_hidden === '1' }),
		})
	})
}
