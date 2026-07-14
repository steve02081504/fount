import { resolveActingEntity } from '../../../social/src/lib/resolveActingEntity.mjs'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import {
	loadPersonalBlockEntries,
	loadPersonalHideEntries,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'

import { registerEntityFileEndpoints } from './filesEndpoints.mjs'
import { canReadEntityStats, getReplicaFromReq, isWritableLocalEntityForUser } from './http.mjs'
import {
	listLocalAgentIdentities,
	resolveOperatorEntityHashForUser,
} from './identity.mjs'
import { revokeEntityActiveKey, rotateEntityActiveKey } from './keyAdmin.mjs'
import { localesFromRequest } from './presentation.mjs'
import {
	computeEffectiveStatus,
	ensureLocalEntityProfile,
	getProfile,
	getStats,
	recordHeartbeat,
	updateProfile,
	updateStatus,
} from './profile.mjs'
import { resolveGroupMemberEntityHash } from './viewerResolve.mjs'

const CHAT_PREFIX = '/api/parts/shells:chat'
const ENTITY_HASH_SEGMENT = '[\\da-f]{128}'

/**
 * @param {string} tail 路径尾部
 * @returns {RegExp} entity 路径正则
 */
function entityPathRegex(tail) {
	return new RegExp(`^${CHAT_PREFIX}/entities/(${ENTITY_HASH_SEGMENT})${tail}`, 'i')
}

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerEntityEndpoints(router) {
	router.get(`${CHAT_PREFIX}/viewer`, authenticate, async (req, res) => {
		const { replicaUsername, nodeHash } = await getReplicaFromReq(req)
		const operatorEntityHash = await resolveOperatorEntityHashForUser(replicaUsername)
		if (!operatorEntityHash)
			return res.status(200).json({
				nodeHash,
				viewerEntityHash: null,
				profile: null,
				agents: [],
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
		const agents = await listLocalAgentIdentities(replicaUsername)
		res.status(200).json({ nodeHash, viewerEntityHash, profile, agents })
	})

	router.get(`${CHAT_PREFIX}/personal-lists`, authenticate, async (req, res) => {
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

	router.post(`${CHAT_PREFIX}/federation/rotate`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await rotateEntityActiveKey(username))
	})

	router.post(`${CHAT_PREFIX}/federation/revoke`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await revokeEntityActiveKey(username, req.body || {}))
	})

	registerEntityFileEndpoints(router, authenticate, getUserByReq)

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
