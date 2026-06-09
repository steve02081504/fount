import {
	addBlocklistEntry,
	loadBlocklist,
} from '../../scripts/p2p/blocklist.mjs'
import { localesFromRequest } from '../../scripts/p2p/entity/localized.mjs'
import {
	computeEffectiveStatus,
	ensureLocalEntityProfile,
	getProfile,
	getStats,
	recordHeartbeat,
	updateProfile,
	updateStatus,
} from '../../scripts/p2p/entity/profile.mjs'
import {
	getReplicaFromReq,
	isWritableLocalEntity,
	resolveOperatorEntityHash,
} from '../../scripts/p2p/entity/replica.mjs'
import { isEntityHash128 } from '../../scripts/p2p/entity_id.mjs'
import { ensureFederationDefaults, saveFederationSettings } from '../../scripts/p2p/federation/identity.mjs'
import { isHex64 } from '../../scripts/p2p/hexIds.mjs'
import { loadNetwork, saveNetwork } from '../../scripts/p2p/network.mjs'
import { resolveGroupMemberEntityHash } from '../../scripts/p2p/p2p_viewer_registry.mjs'
import '../../scripts/p2p/trust_graph.mjs'
import { authenticate, getUserByReq } from '../auth.mjs'

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
		res.status(200).json(ensureFederationDefaults(username))
	})

	router.put('/api/p2p/federation', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body || {}
		const patch = {}
		if (body.batterySaver != null) patch.batterySaver = !!body.batterySaver
		if (Array.isArray(body.relayUrls)) patch.relayUrls = body.relayUrls
		const identityPubKeyHex = String(body.identityPubKeyHex || '').trim().toLowerCase().replace(/^0x/iu, '')
		if (isHex64(identityPubKeyHex)) patch.identityPubKeyHex = identityPubKeyHex
		const dmIntroNonce = String(body.dmIntroNonce || '').trim()
		if (dmIntroNonce.length >= 16) patch.dmIntroNonce = dmIntroNonce
		res.status(200).json(saveFederationSettings(username, patch))
	})

	router.get('/api/p2p/network', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(loadNetwork(username))
	})

	router.put('/api/p2p/network', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body || {}
		const net = loadNetwork(username)
		if (Array.isArray(body.trustedPeers)) net.trustedPeers = body.trustedPeers
		if (Array.isArray(body.explorePeers)) net.explorePeers = body.explorePeers
		saveNetwork(username, net)
		res.status(200).json(loadNetwork(username))
	})

	router.get('/api/p2p/blocklist', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(loadBlocklist(username))
	})

	router.post('/api/p2p/blocklist', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body || {}
		const scope = String(body.scope || '').trim().toLowerCase()
		const value = String(body.value || '').trim()
		if (!scope || !value)
			return res.status(400).json({ error: 'scope and value required' })
		await addBlocklistEntry(username, {
			scope,
			value,
			groupId: body.groupId,
		})
		res.status(200).json(loadBlocklist(username))
	})

	router.get('/api/p2p/viewer', authenticate, async (req, res) => {
		const { replicaUsername, nodeHash } = await getReplicaFromReq(req)
		ensureFederationDefaults(replicaUsername)
		const operatorEntityHash = resolveOperatorEntityHash(replicaUsername)
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
		const { username } = getUserByReq(req)
		const { countMailboxPending } = await import('../../scripts/p2p/mailbox/store.mjs')
		res.status(200).json({ pending: await countMailboxPending(username) })
	})

	registerP2pFileEndpoints(router, authenticate, getUserByReq)

	router.get(entityPathRegex('/stats$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		if (!isEntityHash128(entityHash))
			return res.status(400).json({ error: 'invalid entityHash' })
		res.status(200).json({ stats: await getStats(entityHash) })
	})

	router.post(entityPathRegex('/heartbeat$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername } = await getReplicaFromReq(req)
		if (!isWritableLocalEntity(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		await recordHeartbeat(replicaUsername, entityHash)
		res.status(200).json({})
	})

	router.post(entityPathRegex('/status$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername } = await getReplicaFromReq(req)
		if (!isWritableLocalEntity(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		await updateStatus(replicaUsername, entityHash, req.body.status, req.body.customStatus)
		res.status(200).json({})
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
		if (!isWritableLocalEntity(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		const groupId = String(req.body?.groupId || req.query?.groupId || '').trim() || undefined
		const locales = localesFromRequest(req, replicaUsername)
		res.status(200).json({
			profile: await updateProfile(replicaUsername, entityHash, req.body, { groupId, locales }),
		})
	})
}
