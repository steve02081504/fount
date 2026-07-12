import { resolveActingEntity } from '../../public/parts/shells/social/src/lib/resolveActingEntity.mjs'
import {
	addDenylistEntry,
	loadDenylist,
} from 'npm:@steve02081504/fount-p2p/node/denylist'
import { localesFromRequest } from 'npm:@steve02081504/fount-p2p/entity/presentation_registry'
import {
	computeEffectiveStatus,
	ensureLocalEntityProfile,
	getProfile,
	getStats,
	recordHeartbeat,
	updateProfile,
	updateStatus,
} from 'npm:@steve02081504/fount-p2p/entity/profile'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { loadNetwork } from 'npm:@steve02081504/fount-p2p/node/network'
import { resolveGroupMemberEntityHash } from 'npm:@steve02081504/fount-p2p/registries/p2p_viewer'
import {
	loadPersonalBlockEntries,
	loadPersonalHideEntries,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'
import { authenticate, getUserByReq } from '../auth/index.mjs'
import { canReadEntityStats, getReplicaFromReq, isWritableLocalEntityForUser } from '../p2p_server/http_glue.mjs'
import {
	getFederationViewForUser,
	resolveOperatorEntityHashForUser,
	saveFederationViewForUser,
} from '../p2p_server/operator_identity.mjs'
import { revokeOperatorActiveKey, rotateOperatorActiveKey } from '../p2p_server/operator_key_admin.mjs'

import { registerP2pFileEndpoints } from './p2p_file_endpoints.mjs'

const ENTITY_HASH_SEGMENT = '[\\da-f]{128}'

/**
 * @param {string} tail 路径尾部
 * @returns {RegExp} entity 路径正则
 */
function entityPathRegex(tail) {
	return new RegExp(`^/api/p2p/entities/(${ENTITY_HASH_SEGMENT})${tail}`, 'i')
}

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerP2pEndpoints(router) {
	router.get('/api/p2p/federation', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await getFederationViewForUser(username))
	})

	router.put('/api/p2p/federation', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body || {}
		const patch = {}
		if (body.batterySaver != null) patch.batterySaver = !!body.batterySaver
		if (Array.isArray(body.relayUrls)) patch.relayUrls = body.relayUrls
		if (body.mailbox) patch.mailbox = body.mailbox
		const dmIntroNonce = String(body.dmIntroNonce || '').trim()
		if (dmIntroNonce.length >= 16) patch.dmIntroNonce = dmIntroNonce
		res.status(200).json(await saveFederationViewForUser(username, patch))
	})

	router.post('/api/p2p/federation/connect-node', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const targetNodeHash = String(req.body?.targetNodeHash || '').trim().toLowerCase()
		if (!isHex64(targetNodeHash))
			return res.status(400).json({ error: 'invalid targetNodeHash' })
		const { ensureRemoteUserRoom } = await import('npm:@steve02081504/fount-p2p/transport/remote_user_room')
		const slot = await ensureRemoteUserRoom(username, targetNodeHash)
		res.status(200).json({ targetNodeHash, connected: !!slot })
	})

	router.post('/api/p2p/federation/rotate', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await rotateOperatorActiveKey(username))
	})

	router.post('/api/p2p/federation/revoke', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await revokeOperatorActiveKey(username, req.body || {}))
	})

	router.get('/api/p2p/network', authenticate, async (req, res) => {
		void getUserByReq(req)
		res.status(200).json(loadNetwork())
	})

	router.get('/api/p2p/personal-lists', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const acting = await resolveActingEntity(username, req.query?.actingEntityHash, { requireEntity: false })
		if (acting.error)
			return res.status(acting.status).json({ error: acting.error })
		if (!acting.actingEntity)
			return res.status(200).json({ entries: [] })
		const [blockedEntries, hiddenEntries] = await Promise.all([
			loadPersonalBlockEntries(acting.actingEntity),
			loadPersonalHideEntries(acting.actingEntity),
		])
		const entries = [
			...blockedEntries.map(entry => ({ ...entry, kind: 'block' })),
			...hiddenEntries.map(entry => ({ ...entry, kind: 'hide' })),
		]
		res.status(200).json({ entries })
	})

	router.get('/api/p2p/denylist', authenticate, async (req, res) => {
		void getUserByReq(req)
		res.status(200).json(loadDenylist())
	})

	router.post('/api/p2p/denylist', authenticate, async (req, res) => {
		void getUserByReq(req)
		const body = req.body || {}
		const scope = String(body.scope || '').trim().toLowerCase()
		const value = String(body.value || '').trim()
		if (!scope || !value)
			return res.status(400).json({ error: 'scope and value required' })
		await addDenylistEntry({
			scope,
			value,
			groupId: body.groupId,
		})
		res.status(200).json(loadDenylist())
	})

	router.get('/api/p2p/viewer', authenticate, async (req, res) => {
		const { replicaUsername, nodeHash } = await getReplicaFromReq(req)
		const operatorEntityHash = await resolveOperatorEntityHashForUser(replicaUsername)
		if (!operatorEntityHash)
			return res.status(200).json({
				nodeHash,
				viewerEntityHash: null,
				profile: null,
				identityRequired: true,
			})

		const groupId = String(req.query?.groupId || '').trim() || undefined
		const locales = localesFromRequest(req, replicaUsername)
		let viewerEntityHash = operatorEntityHash
		if (groupId)
			try {
				viewerEntityHash = await resolveGroupMemberEntityHash(replicaUsername, groupId) || operatorEntityHash
			}
			catch {
				viewerEntityHash = operatorEntityHash
			}

		await ensureLocalEntityProfile(replicaUsername, viewerEntityHash)
		const profile = await getProfile(viewerEntityHash, replicaUsername, { groupId, locales })
		res.status(200).json({ nodeHash, viewerEntityHash, profile })
	})

	router.get('/api/p2p/mailbox/summary', authenticate, async (req, res) => {
		void getUserByReq(req)
		const { countMailboxPending } = await import('npm:@steve02081504/fount-p2p/mailbox/store')
		const pendingCount = await countMailboxPending()
		res.status(200).json({ pendingCount })
	})

	registerP2pFileEndpoints(router, authenticate, getUserByReq)

	router.get(entityPathRegex('/stats$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		if (!isEntityHash128(entityHash))
			return res.status(400).json({ error: 'invalid entityHash' })
		const groupId = String(req.query?.groupId || '').trim() || undefined
		if (!await canReadEntityStats(replicaUsername, operatorEntityHash, entityHash, groupId))
			return res.status(403).json({ error: 'Permission denied' })
		res.status(200).json({ stats: await getStats(entityHash) })
	})

	router.post(entityPathRegex('/heartbeat$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		const { lastSeenAt } = await recordHeartbeat(replicaUsername, entityHash)
		const profile = await getProfile(entityHash, replicaUsername, { skipPresentation: true })
		res.status(200).json({
			lastSeenAt,
			effectiveStatus: computeEffectiveStatus(profile, operatorEntityHash, { isSelf: entityHash === operatorEntityHash }),
		})
	})

	router.post(entityPathRegex('/status$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		const updated = await updateStatus(replicaUsername, entityHash, req.body.status, req.body.customStatus)
		res.status(200).json({
			status: updated.status,
			customStatus: updated.customStatus,
			lastSeenAt: updated.lastSeenAt,
			effectiveStatus: computeEffectiveStatus(updated, operatorEntityHash, { isSelf: entityHash === operatorEntityHash }),
		})
	})

	router.get(entityPathRegex('$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		const groupId = String(req.query?.groupId || '').trim() || undefined
		const locales = localesFromRequest(req, replicaUsername)
		const profile = await getProfile(entityHash, replicaUsername, { groupId, locales })
		let groupMemberEntityHash = null
		if (groupId)
			try {
				groupMemberEntityHash = await resolveGroupMemberEntityHash(replicaUsername, groupId)
			}
			catch { /* 非成员或未物化 */ }

		const isSelf = entityHash === operatorEntityHash
			|| (groupMemberEntityHash && entityHash === groupMemberEntityHash)
		profile.effectiveStatus = computeEffectiveStatus(profile, operatorEntityHash, { isSelf })
		res.status(200).json({ profile })
	})

	router.put(entityPathRegex('$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername } = await getReplicaFromReq(req)
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		const groupId = String(req.body?.groupId || req.query?.groupId || '').trim() || undefined
		const locales = localesFromRequest(req, replicaUsername)
		res.status(200).json({
			profile: await updateProfile(replicaUsername, entityHash, req.body, { groupId, locales }),
		})
	})
}
