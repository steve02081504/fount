/**
 * 【文件】group/routes/groupSync.mjs
 * 【职责】群状态快照、声誉、联邦 peers、GSH 缓冲、compact/catchup 与成员 entity 资料的同步 HTTP。
 * 【原理】GET state 按 VIEW_CHANNEL 过滤可见频道；reputation slash/reset 写 DAG 或 volatile alert；catchup 调 federation；compact 压缩本地 DAG；成员资料嵌 profile 解析。
 * 【数据结构】物化 state 子集、reputation 表、peers roster、snapshot/checkpoint、GSH buffer stats。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/federation、chat/governance、profile/*、access.mjs。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'
import { buildAndApplyUnverifiedSlashAlert } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { getUserByReq } from '../../../../../../../server/auth/index.mjs'
import {
	deleteArchivesBeforeMonth,
	isArchiveCoverageComplete,
	loadArchiveManifest,
	summarizeArchiveStorage,
} from '../../chat/archive/index.mjs'
import { syncMissingArchiveMonths } from '../../chat/archive/syncMonths.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { resolveLocalEventSigner } from '../../chat/dag/localSigner.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { compactGroup } from '../../chat/dag/queries.mjs'
import { readQuarantineRows } from '../../chat/events/quarantine.mjs'
import { pullOfflineStartUtcMonthArchives } from '../../chat/federation/archiveMonthPull.mjs'
import { isGroupFederationActive } from '../../chat/federation/groupFederation.mjs'
import {
	catchUpGroupFromPeers,
	listFederationPeersForGroup,
	publishVolatileToFederation,
	requestJoinSnapshotFromPeers,
} from '../../chat/federation/index.mjs'
import { ensureFederationRoom, invalidateFederationRoomCache, isFederationRoomAlreadyBound } from '../../chat/federation/room.mjs'
import { mintRoomSecret } from '../../chat/federation/roomCredentials.mjs'
import { markGroupOfflineStarted } from '../../chat/federation/syncState.mjs'
import { getPendingDecryptBufferStats } from '../../chat/file_keys/buffer.mjs'
import { listActiveFilesFromState } from '../../chat/files/groupFiles.mjs'
import { userHasLocalGroupReplica } from '../../chat/lib/paths.mjs'
import { getGroupMemberEntityHash } from '../../chat/lib/replica.mjs'
import { getMaterializedSession } from '../../chat/session/dagSession.mjs'
import { broadcastEvent } from '../../chat/ws/groupWsBroadcast.mjs'
import { groupWsRoomKeyForReplica } from '../../chat/ws/groupWsRooms.mjs'
import { memberEntityHash } from '../../entity/member.mjs'
import { localesFromRequest } from '../../entity/presentation.mjs'
import { getProfile } from '../../entity/profile.mjs'
import { canGovSlash, canInChannel, governanceChannelId, resolveActiveMemberKeyForLocalUser } from '../access.mjs'
import { loadGroupShunState, saveGroupShunState } from '../groupShunState.mjs'

import { requireGroupMember, resolveGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/**
 * 注册群状态、快照、压缩与联邦 catchup 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerGroupSyncRoutes(router, authenticate) {
	router.post(`${GROUPS_PREFIX}/:groupId/reputation/slash`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const content = {
			targetPubKeyHash: String(req.body?.targetPubKeyHash || '').trim().toLowerCase(),
			claim: Number(req.body.claim ?? 0.25),
		}
		if (req.body.verified) {
			content.verified = true
			if (req.body.proof?.eventId) content.proof = { eventId: String(req.body.proof.eventId).trim().toLowerCase() }
		}
		if (!content.targetPubKeyHash)
			throw httpError(400, 'targetPubKeyHash required')

		const { state: slashState } = await getState(username, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, slashState)
		if (!memberKey)
			throw httpError(403, 'Not a member')
		const member = slashState.members[memberKey]

		if (!content.verified && !content.proof) {
			if (!canGovSlash(slashState, member))
				throw httpError(403, 'ADMIN or MANAGE_ROLES required')
			const { sender } = await resolveLocalEventSigner(username, groupId)
			const alert = buildAndApplyUnverifiedSlashAlert(
				sender,
				content,
				slashState.groupSettings || {},
			)
			broadcastEvent(groupWsRoomKeyForReplica(groupId), alert)
			await publishVolatileToFederation(groupId, alert)
			return res.status(200).json({ applied: 1 })
		}

		await appendSignedLocalEvent(username, groupId, {
			type: 'reputation_slash',
			timestamp: Date.now(),
			content,
		})
		res.status(200).json({ applied: 1 })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/reputation/reset`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const targetPubKeyHash = String(req.body?.targetPubKeyHash || '').trim().toLowerCase()
		if (!targetPubKeyHash)
			throw httpError(400, 'targetPubKeyHash required')
		await appendSignedLocalEvent(username, groupId, {
			type: 'reputation_reset',
			timestamp: Date.now(),
			content: { targetPubKeyHash },
		})
		res.status(200).json({ applied: 1 })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/peers`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext

		const roster = await listFederationPeersForGroup(username, groupId)
		const stored = loadPeerPoolView( groupId)
		res.status(200).json({
			selfNodeHash: roster.selfNodeHash,
			federationEnabled: roster.federationEnabled,
			peers: roster.peers,
			trustedPeers: stored.trustedPeers,
			explorePeers: stored.explorePeers,
			blockedPeers: stored.deniedNodes,
			deniedNodes: stored.deniedNodes,
			deniedSubjects: stored.deniedSubjects,
			deniedEntities: stored.deniedEntities,
		})
	})

	router.get(`${GROUPS_PREFIX}/:groupId/state`, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { state, checkpoint } = await getState(username, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
		const active = memberKey != null
		const member = memberKey ? state.members[memberKey] : undefined

		let { channels } = state
		let channelPermissions = state.channelPermissions
		const groupSettings = { ...state.groupSettings }

		if (active) {
			channels = {}
			for (const [channelId, channel] of Object.entries(state.channels)) {
				const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
				const canManage = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
				if (canView || canManage) channels[channelId] = channel
			}

			channelPermissions = Object.fromEntries(
				Object.entries(state.channelPermissions).filter(([channelId]) => channelId in channels),
			)

			if (groupSettings.defaultChannelId && !(groupSettings.defaultChannelId in channels))
				groupSettings.defaultChannelId = Object.keys(channels)[0] || null
		}

		const activeMemberRows = Object.entries(state.members)
			.filter(([, memberRow]) => memberRow.status === 'active')
		const profileLocales = localesFromRequest(req, username)
		const activeMembers = await Promise.all(activeMemberRows.map(async ([memberKey, memberRow]) => {
			const isAgent = memberRow.memberKind === 'agent'
			const entityHash = memberEntityHash(memberRow)
			let displayName = ''
			if (isAgent)
				displayName = String(memberRow.charname || '').trim()
			if (entityHash && !displayName)
				try {
					const profile = await getProfile(entityHash, username, { groupId, locales: profileLocales })
					displayName = String(profile.name || '').trim()
				}
				catch {
					// 远端或未托管资料时忽略
				}
			if (isAgent && !displayName)
				displayName = memberRow.charname || ''

			return {
				memberKey,
				kind: isAgent ? 'agent' : 'user',
				ownerEntityHash: memberRow.ownerEntityHash || undefined,
				charname: isAgent ? memberRow.charname : null,
				nodeHash: memberRow.homeNodeHash,
				entityHash,
				pubKeyHex: memberRow.pubKeyHex || null,
				roles: memberRow.roles || ['@everyone'],
				joinedAt: memberRow.joinedAt,
				displayName,
			}
		}))

		const bannedMembersList = Array.from(state.bannedMembers)
			.map(memberKey => ({ memberKey: String(memberKey) }))

		const pinsByChannel = checkpoint?.overlay?.pins || {}

		const quarantineRows = active ? await readQuarantineRows(username, groupId) : []

		const hasLocalReplica = await userHasLocalGroupReplica(username, groupId)
		const shunState = await loadGroupShunState(username, groupId)

		/** @type {Record<string, object>} */
		const channelCaps = {}
		if (active) 
			for (const channelId of Object.keys(channels))
				channelCaps[channelId] = {
					canEditList: canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId),
					canCreateThreads: canInChannel(state, member, PERMISSIONS.CREATE_THREADS, channelId)
						|| canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, channelId),
					canStream: canInChannel(state, member, PERMISSIONS.STREAM, channelId),
					canManageMessages: canInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId),
				}
		

		/** @type {object} */
		const meta = {
			groupId: state.groupId,
			hasLocalReplica,
			federationActive: isGroupFederationActive(state.groupSettings),
			groupMeta: state.groupMeta,
			delegatedOwnerPubKeyHash: state.delegatedOwnerPubKeyHash ?? null,
			groupSettings,
			channels,
			roles: state.roles,
			channelPermissions,
			members: activeMembers,
			bannedMembers: bannedMembersList,
			memberCount: activeMembers.length,
			membersRoot: state.membersRoot ?? null,
			membersPagesCount: state.membersPagesCount ?? null,
			pinsByChannel,
			consensusBranchTip: state.consensusBranchTip ?? null,
			localViewBranchTip: state.localViewBranchTip ?? null,
			governanceFork: !!state.governanceFork,
			dagTips: state.dagTips,
			cabinets: state.cabinets || {},
			files: listActiveFilesFromState(state),
			channelCaps,
		}

		if (active) {
			const session = await getMaterializedSession(username, groupId)
			meta.charPartNames = Object.keys(session.chars || {})
		}
		if (active && canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, null)) {
			meta.reputationLedger = state.reputationLedger.slice(-50)
			meta.inviteEdges = state.inviteEdges.slice(0, 200)
		}
		if (active) {
			const manifest = await loadArchiveManifest(username, groupId)
			meta.archiveCoverage = {
				complete: isArchiveCoverageComplete(manifest),
				channels: manifest.coverage || {},
			}
		}

		const viewer = {
			isMember: active,
			memberKey: active ? memberKey : null,
			entityHash: active
				? await getGroupMemberEntityHash(username, groupId).catch(() => null)
				: null,
			roles: member?.roles || [],
			suspectedRemoved: shunState.suspectedRemoved,
			shunnedBy: shunState.shunnedBy,
			shunBannerDismissed: shunState.bannerDismissed,
		}

		const federation = {
			pendingDecryptBuffer: getPendingDecryptBufferStats(username, groupId),
			quarantineCount: quarantineRows.length,
		}

		res.status(200).json({ meta, viewer, federation })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/snapshot`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const { checkpoint } = await getState(username, groupId)
		res.status(200).json({ snapshot: checkpoint })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/compact`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext
		if (!canInChannel(state, member, PERMISSIONS.ADMIN, governanceChannelId(state)))
			throw httpError(403, 'ADMIN required')
		res.status(200).json(await compactGroup(username, groupId))
	})

	router.post(`${GROUPS_PREFIX}/:groupId/federation/rotate-room-secret`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		const channelId = governanceChannelId(state)
		if (!canInChannel(state, member, PERMISSIONS.ADMIN, channelId)
			&& !canInChannel(state, member, PERMISSIONS.MANAGE_ADMINS, channelId))
			throw httpError(403, 'ADMIN or MANAGE_ADMINS required')
		if (!isGroupFederationActive(state.groupSettings))
			throw httpError(409, 'federation not active; invite a member first')

		const roomSecret = mintRoomSecret()
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { roomSecret },
		})
		invalidateFederationRoomCache(username, groupId)
		void catchUpGroupFromPeers(username, groupId).catch(console.error)
		res.status(200).json({ roomSecret })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/federation/tuning`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		const channelId = governanceChannelId(state)
		if (!canInChannel(state, member, PERMISSIONS.ADMIN, channelId)
			&& !canInChannel(state, member, PERMISSIONS.MANAGE_ADMINS, channelId))
			throw httpError(403, 'ADMIN or MANAGE_ADMINS required')
		const { setFederationTuning } = await import('../../chat/federation/tuning.mjs')
		const patch = await setFederationTuning(username, groupId, req.body || {})
		res.status(200).json({ ok: true, patch })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/federation/catchup`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId, { allowSuspectedRemoved: true })
		const { username } = membership
		const stats = await catchUpGroupFromPeers(username, groupId, {
			waitMs: req.body.waitMs,
			extraWantIds: Array.isArray(req.body.extraWantIds) ? req.body.extraWantIds : undefined,
		})
		const shunState = await loadGroupShunState(username, groupId)
		res.status(200).json({ ...stats, suspectedRemoved: shunState.suspectedRemoved, shunnedBy: shunState.shunnedBy })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/federation/shun-dismiss`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = await getUserByReq(req)
		const shunState = await loadGroupShunState(username, groupId)
		if (!shunState.suspectedRemoved)
			throw httpError(409, 'Not suspected removed')
		const next = await saveGroupShunState(username, groupId, { bannerDismissed: true })
		res.status(200).json({ bannerDismissed: next.bannerDismissed })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/federation/offline-mark`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username } = membership
		const wallMs = Number(req.body?.wallMs) || Date.now()
		res.status(200).json(await markGroupOfflineStarted(username, groupId, wallMs))
	})

	router.post(`${GROUPS_PREFIX}/:groupId/federation/join-snapshot`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId, { allowSuspectedRemoved: true })
		const { username } = membership
		const slot = await ensureFederationRoom(username, groupId)
		if (!slot)
			return res.status(200).json({ ok: true, skipped: true, reason: 'federation_inactive' })
		res.status(200).json(await requestJoinSnapshotFromPeers(username, groupId, slot))
	})

	router.get(`${GROUPS_PREFIX}/:groupId/archive/summary`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = await getUserByReq(req)
		if (!await userHasLocalGroupReplica(username, groupId))
			throw httpError(404, 'No local group replica')
		res.status(200).json({ files: await summarizeArchiveStorage(username, groupId) })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/archive/sync`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username } = membership
		const slot = await ensureFederationRoom(username, groupId)
		if (!slot)
			throw httpError(503, 'federation room unavailable')
		const offline = await pullOfflineStartUtcMonthArchives(username, groupId, slot)
		const missing = await syncMissingArchiveMonths(username, groupId, slot)
		res.status(200).json({
			pulled: offline.pulled + missing.pulled,
			incomplete: offline.incomplete + missing.incomplete,
		})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/archive`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = await getUserByReq(req)
		if (!await userHasLocalGroupReplica(username, groupId))
			throw httpError(404, 'No local group replica')
		const beforeMonth = String(req.query.before || '').trim()
		if (!/^\d{4}-\d{2}$/.test(beforeMonth))
			throw httpError(400, 'before must be YYYY-MM')
		res.status(200).json(await deleteArchivesBeforeMonth(username, groupId, beforeMonth))
	})

	router.post(`${GROUPS_PREFIX}/:groupId/federation/rebind`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username } = membership
		const channelId = String(req.body?.channelId || '').trim() || null
		if (await isFederationRoomAlreadyBound(username, groupId, { channelId: channelId || undefined }))
			return res.status(200).json({ ok: true, skipped: true, channelId })
		const slot = await ensureFederationRoom(username, groupId, { channelId: channelId || undefined })
		if (!slot)
			return res.status(200).json({ ok: true, skipped: true, reason: 'federation_inactive', channelId })
		res.status(200).json({ ok: true, channelId })
	})
}
