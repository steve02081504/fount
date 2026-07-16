import { Buffer } from 'node:buffer'

import { loadFileManifest, readManifestPlaintext } from 'npm:@steve02081504/fount-p2p/files/evfs'

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
import { ensureDefaultCabinet } from './defaultCabinet.mjs'
import {
	copyEntries,
	deleteEntries,
	listEntries,
	registerEntry,
	unlockFolder,
	updateEntry,
	uploadAndRegister,
	uploadPreview,
} from './entries.mjs'
import { runCabinetSync, setSyncBinding } from './folderSync.mjs'
import { listJoinedGroupCabinets } from './groupCabinet.mjs'
import { resolveLink } from './links.mjs'
import { fetchRemoteCabinetIndex, fetchRemoteCabinets } from './remote.mjs'
import { zipCabinetFolder } from './zip.mjs'

const PREFIX = '/api/parts/shells\\:cabinet'

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
		await ensureDefaultCabinet(username, entityHash)
		const personal = await loadCabinets(username, entityHash)
		const groups = await listJoinedGroupCabinets(username, entityHash).catch(() => [])
		const byId = new Map()
		for (const row of [...personal, ...groups]) byId.set(row.cabinet_id, row)
		res.status(200).json({ cabinets: [...byId.values()] })
	})

	router.post(`${PREFIX}/cabinets`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		if (req.body?.type === 'group') {
			if (!req.body.group_id) throw httpError(400, 'group_id required')
			const cabinet = await createCabinet(username, entityHash, {
				cabinet_id: `group:${req.body.group_id}`,
				name: req.body.name || String(req.body.group_id).slice(0, 8),
				type: 'group',
				group_id: req.body.group_id,
			})
			return res.status(200).json({ cabinet })
		}
		const cabinet = await createCabinet(username, entityHash, req.body || {})
		res.status(200).json({ cabinet })
	})

	router.patch(`${PREFIX}/cabinets/:cabinetId`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const cabinet = await updateCabinet(username, entityHash, req.params.cabinetId, req.body || {})
		res.status(200).json({ cabinet })
	})

	router.delete(`${PREFIX}/cabinets/:cabinetId`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		await deleteCabinet(username, entityHash, req.params.cabinetId)
		res.status(200).json({ ok: true })
	})

	router.get(`${PREFIX}/cabinets/:cabinetId/index`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const cabinetId = req.params.cabinetId
		if (cabinetId.startsWith('group:') && !await getCabinet(username, entityHash, cabinetId)) 
			await createCabinet(username, entityHash, {
				cabinet_id: cabinetId,
				name: cabinetId.slice(6, 14),
				type: 'group',
				group_id: cabinetId.slice(6),
			}).catch(() => { })
		
		const result = await listEntries(username, entityHash, cabinetId, {
			parent_id: req.query.parent_id,
			show_hidden: req.query.show_hidden === '1' || req.query.show_hidden === 'true',
			unlock_token: req.get('X-Cabinet-Unlock') || undefined,
		})
		res.status(200).json(result)
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/unlock`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const folderId = String(req.body?.folder_id || '')
		const password = String(req.body?.password || '')
		if (!folderId || !password) throw httpError(400, 'folder_id and password required')
		const result = await unlockFolder(username, entityHash, req.params.cabinetId, folderId, password)
		res.status(200).json(result)
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/entries`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const body = req.body || {}
		if (body.plaintext_base64) {
			const entry = await uploadAndRegister(username, entityHash, req.params.cabinetId, {
				plaintext: Buffer.from(body.plaintext_base64, 'base64'),
				name: body.name,
				mime_type: body.mime_type,
				parent_id: body.parent_id,
				attrs: body.attrs,
				preview: body.preview,
				description: body.description,
				unlock_token: req.get('X-Cabinet-Unlock') || body.unlock_token,
			})
			return res.status(200).json({ entry })
		}
		const entry = await registerEntry(username, entityHash, req.params.cabinetId, {
			...body,
			unlock_token: req.get('X-Cabinet-Unlock') || body.unlock_token,
		})
		res.status(200).json({ entry })
	})

	router.patch(`${PREFIX}/cabinets/:cabinetId/entries/:entryId`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const entry = await updateEntry(username, entityHash, req.params.cabinetId, req.params.entryId, req.body || {})
		res.status(200).json({ entry })
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/entries/copy`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const entries = await copyEntries(username, entityHash, req.params.cabinetId, req.body || {})
		res.status(200).json({ entries })
	})

	router.delete(`${PREFIX}/cabinets/:cabinetId/entries`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const ids = Array.isArray(req.body?.entry_ids) ? req.body.entry_ids : []
		const result = await deleteEntries(username, entityHash, req.params.cabinetId, ids)
		res.status(200).json(result)
	})

	router.get(`${PREFIX}/cabinets/:cabinetId/entries/:entryId/resolve`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await resolveLink(username, entityHash, req.params.cabinetId, req.params.entryId))
	})

	router.get(`${PREFIX}/cabinets/:cabinetId/zip`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const result = await zipCabinetFolder(username, entityHash, req.params.cabinetId, {
			folder_id: req.query.parent_id || req.query.folder_id,
			unlock_token: req.get('X-Cabinet-Unlock') || undefined,
			/**
			 * @param {string} evfsPath EVFS 路径
			 * @returns {Promise<Uint8Array>} 明文
			 */
			async readFile(evfsPath) {
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
		const cabinet = await setSyncBinding(username, entityHash, req.params.cabinetId, req.body || {})
		res.status(200).json({ cabinet })
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/sync`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		res.status(200).json(await runCabinetSync(username, entityHash, req.params.cabinetId))
	})

	router.post(`${PREFIX}/cabinets/:cabinetId/preview`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const plaintext = Buffer.from(String(req.body?.plaintext_base64 || ''), 'base64')
		if (!plaintext.length) throw httpError(400, 'plaintext_base64 required')
		const result = await uploadPreview(username, entityHash, req.params.cabinetId, {
			plaintext,
			name: req.body?.name,
			mime_type: req.body?.mime_type,
		})
		res.status(200).json(result)
	})

	router.get(`${PREFIX}/remote/:entityHash/cabinets`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const owner = String(req.params.entityHash).toLowerCase()
		const cabinets = await fetchRemoteCabinets(username, owner, {
			viewerEntityHash: entityHash,
			following: new Set(),
			followSince: new Map(),
			at: Date.now(),
		})
		res.status(200).json({ cabinets })
	})

	router.get(`${PREFIX}/remote/:entityHash/cabinets/:cabinetId/index`, authenticate, async (req, res) => {
		const { username, entityHash } = await ctxFromReq(req)
		const owner = String(req.params.entityHash).toLowerCase()
		const cabinets = await fetchRemoteCabinets(username, owner, {
			viewerEntityHash: entityHash,
			following: new Set(),
			followSince: new Map(),
			at: Date.now(),
		})
		const meta = cabinets.find(row => row.cabinet_id === req.params.cabinetId) || {
			visibility: { visibility: 'public' },
		}
		const index = await fetchRemoteCabinetIndex(username, owner, req.params.cabinetId, {
			viewerEntityHash: entityHash,
			following: new Set(),
			followSince: new Map(),
			at: Date.now(),
		}, meta)
		res.status(200).json({ cabinet: meta, ...index })
	})
}
