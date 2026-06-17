import {
	addBlocklistEntry,
	loadBlocklist,
} from '../../scripts/p2p/blocklist.mjs'
import {
	computeEffectiveStatus,
	ensureLocalEntityProfile,
	getProfile,
	getStats,
	recordHeartbeat,
	updateProfile,
	updateStatus,
} from '../../scripts/p2p/entity/profile.mjs'
import { isEntityHash128 } from '../../scripts/p2p/entity_id.mjs'
import { isHex64 } from '../../scripts/p2p/hexIds.mjs'
import { loadNetwork, saveNetwork } from '../../scripts/p2p/network.mjs'
import { resolveGroupMemberEntityHash } from '../../scripts/p2p/p2p_viewer_registry.mjs'
import '../../scripts/p2p/trust_graph.mjs'
import { authenticate, getUserByReq } from '../auth.mjs'
import { getReplicaFromReq, isWritableLocalEntityForUser } from '../p2p_server/http_glue.mjs'
import { localesFromRequest } from '../../scripts/p2p/entity/presentation_registry.mjs'
import {
	getFederationViewForUser,
	resolveOperatorEntityHashForUser,
	saveFederationViewForUser,
} from '../p2p_server/operator_identity.mjs'

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
		const identityPubKeyHex = String(body.identityPubKeyHex || '').trim().toLowerCase().replace(/^0x/iu, '')
		if (isHex64(identityPubKeyHex)) patch.identityPubKeyHex = identityPubKeyHex
		const dmIntroNonce = String(body.dmIntroNonce || '').trim()
		if (dmIntroNonce.length >= 16) patch.dmIntroNonce = dmIntroNonce
		res.status(200).json(await saveFederationViewForUser(username, patch))
	})

	router.get('/api/p2p/network', authenticate, async (req, res) => {
		void getUserByReq(req)
		res.status(200).json(loadNetwork())
	})

	router.put('/api/p2p/network', authenticate, async (req, res) => {
		void getUserByReq(req)
		const body = req.body || {}
		const net = loadNetwork()
		if (Array.isArray(body.trustedPeers)) net.trustedPeers = body.trustedPeers
		if (Array.isArray(body.explorePeers)) net.explorePeers = body.explorePeers
		saveNetwork(net)
		res.status(200).json(loadNetwork())
	})

	router.get('/api/p2p/blocklist', authenticate, async (req, res) => {
		void getUserByReq(req)
		res.status(200).json(loadBlocklist())
	})

	router.post('/api/p2p/blocklist', authenticate, async (req, res) => {
		void getUserByReq(req)
		const body = req.body || {}
		const scope = String(body.scope || '').trim().toLowerCase()
		const value = String(body.value || '').trim()
		if (!scope || !value)
			return res.status(400).json({ error: 'scope and value required' })
		await addBlocklistEntry({
			scope,
			value,
			groupId: body.groupId,
		})
		res.status(200).json(loadBlocklist())
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
		const { countMailboxPending } = await import('../../scripts/p2p/mailbox/store.mjs')
		res.status(200).json({ pending: await countMailboxPending() })
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
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		await recordHeartbeat(replicaUsername, entityHash)
		res.status(200).json({})
	})

	router.post(entityPathRegex('/status$'), authenticate, async (req, res) => {
		const entityHash = req.params[0].toLowerCase()
		const { replicaUsername } = await getReplicaFromReq(req)
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
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
		if (!await isWritableLocalEntityForUser(replicaUsername, entityHash))
			return res.status(403).json({ error: 'Permission denied' })
		const groupId = String(req.body?.groupId || req.query?.groupId || '').trim() || undefined
		const locales = localesFromRequest(req, replicaUsername)
		res.status(200).json({
			profile: await updateProfile(replicaUsername, entityHash, req.body, { groupId, locales }),
		})
	})
}
