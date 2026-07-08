/**
 * 【文件】group/routes/dag.mjs
 * 【职责】DAG 同步、tip 查询、治理分支、分叉、merge-tips 与联邦/本地 events 推送的 HTTP 入口。
 * 【原理】tips 从 events.jsonl 计算并附带 reputation 计分；fork/block-opposing 委托 governance；POST events/signed 与 events/local 分离契约。
 * 【数据结构】DAG tips/tipScores、events 数组、governance-branch tipId、applied/skipped 计数。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/dag/*、chat/governance、localAuthz.mjs、access.mjs。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { computeDagTipIdsFromEvents } from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { HEX_ID_64 as PUB_KEY_HEX_64, isHex64, normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { loadReputation, buildAndApplyUnverifiedSlashAlert } from '../../../../../../../scripts/p2p/reputation_store.mjs'
import { isSignedDagEventRow } from '../../../../../../../scripts/p2p/wire_ingress.mjs'
import { getUserByReq } from '../../../../../../../server/auth/index.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { mergeDagTips } from '../../chat/dag/lifecycle.mjs'
import { resolveLocalEventSigner } from '../../chat/dag/localSigner.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { syncEvents } from '../../chat/dag/queries.mjs'
import { appendValidatedRemoteEvent } from '../../chat/dag/remoteIngest.mjs'
import { isGroupFederationActive } from '../../chat/federation/groupFederation.mjs'
import { ensureFederationRoom, invalidateFederationRoomCache } from '../../chat/federation/room.mjs'
import { buildFileKeyGrant } from '../../chat/file_keys/historicalGrant.mjs'
import { getCurrentFileMasterKey } from '../../chat/file_keys/store.mjs'
import { saveGovernanceBranchTip } from '../../chat/governance/branchStore.mjs'
import { forkGroupFromBranch } from '../../chat/governance/fork.mjs'
import { blockOpposingForkBranch } from '../../chat/governance/forkBlockOpposing.mjs'
import { eventsPath } from '../../chat/lib/paths.mjs'
import { canGovSlash, resolveActiveMemberKeyForLocalUser } from '../access.mjs'
import { validateLocalAuthzBatch } from '../localAuthz.mjs'

import { requireGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/**
 * 摄入已签名联邦 DAG 事件行。
 * @param {string} username 副本用户
 * @param {string} groupId 群 ID
 * @param {object[]} events 签名事件行
 * @returns {Promise<{ applied: number, skipped: number }>} 成功与跳过计数
 */
async function ingestSignedEvents(username, groupId, events) {
	let applied = 0
	let skipped = 0
	for (const event of events) {
		if (event?.groupId && event.groupId !== groupId) {
			skipped++
			continue
		}
		if (!isSignedDagEventRow(event)) {
			skipped++
			continue
		}
		if ((await appendValidatedRemoteEvent(username, groupId, event, { logFailures: false })).status === 'applied')
			applied++
	}
	return { applied, skipped }
}

/**
 * 追加本地未签名授权类 DAG 事件。
 * @param {string} username 副本用户
 * @param {string} groupId 群 ID
 * @param {object[]} events 本地简体形
 * @returns {Promise<{ applied: number, skipped: number }>} 成功与跳过计数
 */
async function appendLocalEvents(username, groupId, events) {
	let applied = 0
	let skipped = 0
	for (const event of events) {
		if (event?.groupId && event.groupId !== groupId) {
			skipped++
			continue
		}
		const content = { ...event.content }

		if (event.type === 'reputation_slash' && !content.verified && !content.proof) {
			const { state: slashState } = await getState(username, groupId)
			const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, slashState)
			if (!memberKey) throw httpError(403, 'Not a member')
			if (!canGovSlash(slashState, slashState.members[memberKey]))
				throw httpError(403, 'ADMIN or MANAGE_ROLES required')
			const { sender } = await resolveLocalEventSigner(username, groupId)
			const { publishVolatileToFederation } = await import('../../chat/federation/index.mjs')
			const { broadcastEvent } = await import('../../chat/ws/groupWsBroadcast.mjs')
			const { groupWsRoomKeyForReplica } = await import('../../chat/ws/groupWsRooms.mjs')
			const alert = buildAndApplyUnverifiedSlashAlert(
				sender,
				content,
				slashState.groupSettings || {},
			)
			broadcastEvent(groupWsRoomKeyForReplica(groupId), alert)
			await publishVolatileToFederation(groupId, alert)
			applied++
			continue
		}

		if (event.type === 'peer_invite' && !content.fileKeyWraps) {
			const peerPubKeyHex = normalizePubKeyHex(content.to || '')
			if (PUB_KEY_HEX_64.test(peerPubKeyHex)) {
				const keyEntry = await getCurrentFileMasterKey(username, groupId)
				if (keyEntry)
					content.fileKeyWraps = await buildFileKeyGrant(username, groupId, peerPubKeyHex)
			}
		}

		await appendSignedLocalEvent(username, groupId, {
			type: event.type,
			timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Date.now(),
			content,
		})
		applied++
	}
	return { applied, skipped }
}

/**
 * 注册 DAG 同步、分叉与事件推送路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerDagRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/dag/tips`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, groupId } = req.groupContext

		const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
		const tips = computeDagTipIdsFromEvents(events)
		const { checkpoint } = await getState(username, groupId)
		const { computeLocalTipsHash } = await import('../../../../../../../scripts/p2p/dag/index.mjs')
		const { computeTipAuthzScores, computeTipConsensusScores } = await import('../../../../../../../scripts/p2p/governance_branch.mjs')
		const eventsById = new Map()
		for (const event of events)
			if (event?.id) eventsById.set(String(event.id), event)
		const reputation = loadReputation()
		const reputationBySender = {}
		for (const [nodeId, row] of Object.entries(reputation?.byNodeHash || {}))
			reputationBySender[String(nodeId).toLowerCase()] = Number(row?.score ?? 0)
		const tipScores = computeTipAuthzScores(tips, eventsById, reputationBySender)
		const tipConsensusScores = computeTipConsensusScores(tips, eventsById)
		res.status(200).json({
			tips,
			tipScores,
			tipConsensusScores,
			local_tips_hash: checkpoint?.local_tips_hash ?? computeLocalTipsHash(tips),
			consensusBranchTip: state.consensusBranchTip ?? null,
			localViewBranchTip: state.localViewBranchTip ?? null,
			governanceFork: !!state.governanceFork,
			walOk: state.walOk !== false,
		})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/fork`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const body = req.body || {}
		const result = await forkGroupFromBranch(username, groupId, {
			tipId: body.tipId ? String(body.tipId) : undefined,
			name: body.name ? String(body.name) : undefined,
		})
		invalidateFederationRoomCache(username, result.groupId)
		const { state: forkState } = await getState(username, result.groupId)
		if (isGroupFederationActive(forkState.groupSettings))
			void ensureFederationRoom(username, result.groupId).catch(error => console.error('Federation after fork:', error))
		res.status(201).json({ ...result })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/fork/block-opposing`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const acceptedTipId = String(req.body?.acceptedTipId || '')
		const { sender: selfPubKeyHash } = await resolveLocalEventSigner(username, groupId)
		const result = await blockOpposingForkBranch(username, groupId, acceptedTipId, selfPubKeyHash)
		res.status(200).json({ ...result })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/governance-branch`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, groupId } = req.groupContext
		const tipId = req.body?.tipId != null ? String(req.body.tipId).trim().toLowerCase() : null
		if (tipId && !isHex64(tipId))
			throw httpError(400, 'invalid tipId')
		const tips = state.dagTips || computeDagTipIdsFromEvents(await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions }))
		if (tipId && !tips.includes(tipId))
			throw httpError(400, 'tipId is not a current DAG tip')
		await saveGovernanceBranchTip(username, groupId, tipId)
		const refreshed = await getState(username, groupId, { forceFullReplay: false })
		res.status(200).json({
			consensusBranchTip: refreshed.state.consensusBranchTip ?? null,
			localViewBranchTip: refreshed.state.localViewBranchTip ?? null,
			governanceFork: refreshed.state.governanceFork,
		})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/dag/merge-tips`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		try {
			const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
			const event = await mergeDagTips(username, groupId, sender, secretKey)
			res.status(200).json({ event })
		}
		catch (error) {
			if (Number.isInteger(error?.http_code))
				throw error
			console.error('POST /dag/merge-tips failed:', error)
			throw httpError(500, 'Failed to merge DAG tips')
		}
	})

	router.get(`${GROUPS_PREFIX}/:groupId/events`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const channelId = String(req.query.channelId || '').trim() || undefined
		const { events, truncated } = await syncEvents(username, groupId, {
			since: req.query.since ? String(req.query.since) : undefined,
			limit: req.query.limit,
			channelId,
		})
		res.status(200).json({ events, truncated })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/events/signed`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const events = req.body?.events
		if (!Array.isArray(events))
			throw httpError(400, 'events array required')
		res.status(200).json(await ingestSignedEvents(username, groupId, events))
	})

	router.post(`${GROUPS_PREFIX}/:groupId/events/local`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const events = req.body?.events
		if (!Array.isArray(events))
			throw httpError(400, 'events array required')

		try {
			await validateLocalAuthzBatch(username, groupId, events)
		}
		catch (error) {
			throw httpError(400, error.message)
		}

		res.status(200).json(await appendLocalEvents(username, groupId, events))
	})
}
