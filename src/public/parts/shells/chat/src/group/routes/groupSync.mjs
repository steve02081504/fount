/**
 * 【文件】group/routes/groupSync.mjs
 * 【职责】群状态快照、声誉、联邦 peers、GSH 缓冲、compact/catchup 与成员 entity 资料的同步 HTTP。
 * 【原理】GET state 按 VIEW_CHANNEL 过滤可见频道；reputation slash/reset 写 DAG 或 volatile alert；catchup 调 federation；compact 压缩本地 DAG；成员资料嵌 profile 解析。
 * 【数据结构】物化 state 子集、reputation 表、peers roster、snapshot/checkpoint、GSH buffer stats。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/federation、chat/governance、profile/*、access.mjs。
 */
import { localesFromRequest } from '../../../../../../../scripts/p2p/entity/localized.mjs'
import { getProfile } from '../../../../../../../scripts/p2p/entity/profile.mjs'
import { loadPeerPoolView } from '../../../../../../../scripts/p2p/network.mjs'
import { PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { loadReputation, buildAndApplyUnverifiedSlashAlert } from '../../../../../../../scripts/p2p/reputation_user.mjs'
import { getUserByReq } from '../../../../../../../server/auth.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { resolveLocalEventSigner } from '../../chat/dag/localSigner.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { compactGroup } from '../../chat/dag/queries.mjs'
import { isGroupFederationActive } from '../../chat/federation/groupFederation.mjs'
import { catchUpGroupFromPeers, listFederationPeersForGroup, requestJoinSnapshotFromPeers } from '../../chat/federation/index.mjs'
import { mintMqttRoomSecret } from '../../chat/federation/mqttCredentials.mjs'
import { ensureFederationRoom, invalidateFederationRoomCache } from '../../chat/federation/room.mjs'
import { markGroupOfflineStarted } from '../../chat/federation/syncState.mjs'
import { getPendingDecryptBufferStats } from '../../chat/file_keys/buffer.mjs'
import { listActiveFilesFromState } from '../../chat/files/groupFiles.mjs'
import { memberEntityHash } from '../../chat/lib/entityId.mjs'
import { userHasLocalGroupReplica } from '../../chat/lib/paths.mjs'
import { getGroupMemberEntityHash } from '../../chat/lib/replica.mjs'
import { getMaterializedSession } from '../../chat/session/dagSession.mjs'
import { canGovSlash, canInChannel, governanceChannelId, resolveActiveMemberKeyForLocalUser } from '../access.mjs'

import { requireGroupMember, resolveGroupMember } from './middleware.mjs'

/**
 * 注册群状态、快照、压缩与联邦 catchup 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerGroupSyncRoutes(router, authenticate) {
	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/reputation\/slash$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params[0]
		const content = {
			targetPubKeyHash: String(req.body?.targetPubKeyHash || '').trim().toLowerCase(),
			claim: Number(req.body.claim ?? 0.25),
		}
		if (req.body.verified) {
			content.verified = true
			if (req.body.proof?.eventId) content.proof = { eventId: String(req.body.proof.eventId).trim().toLowerCase() }
		}
		if (!content.targetPubKeyHash)
			return res.status(400).json({ error: 'targetPubKeyHash required' })

		const { state: slashState } = await getState(username, groupId)
		const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, slashState)
		if (!memberKey)
			return res.status(403).json({ error: 'Not a member' })
		const member = slashState.members[memberKey]

		if (!content.verified && !content.proof) {
			if (!canGovSlash(slashState, member))
				return res.status(403).json({ error: 'ADMIN or MANAGE_ROLES required' })
			const { sender } = await resolveLocalEventSigner(username, groupId)
			const { publishVolatileToFederation } = await import('../../chat/federation/index.mjs')
			const { broadcastEvent } = await import('../../chat/stream/groupWsHub.mjs')
			const { groupWsRoomKeyForReplica } = await import('../../chat/stream/groupWsRooms.mjs')
			const alert = buildAndApplyUnverifiedSlashAlert(
				sender,
				content,
				slashState.groupSettings || {},
			)
			broadcastEvent(groupWsRoomKeyForReplica(username, groupId), alert)
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

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/reputation\/reset$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params[0]
		const targetPubKeyHash = String(req.body?.targetPubKeyHash || '').trim().toLowerCase()
		if (!targetPubKeyHash)
			return res.status(400).json({ error: 'targetPubKeyHash required' })
		await appendSignedLocalEvent(username, groupId, {
			type: 'reputation_reset',
			timestamp: Date.now(),
			content: { targetPubKeyHash },
		})
		res.status(200).json({ applied: 1 })
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/reputation$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const { state } = await getState(username, groupId)

		const reputation = loadReputation(username)
		res.status(200).json({ reputation })
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/peers$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const { state } = await getState(username, groupId)

		const roster = await listFederationPeersForGroup(username, groupId)
		const stored = loadPeerPoolView(username, groupId)
		res.status(200).json({
			selfNodeHash: roster.selfNodeHash,
			federationEnabled: roster.federationEnabled,
			peers: roster.peers,
			trustedPeers: stored.trustedPeers,
			explorePeers: stored.explorePeers,
			blockedPeers: stored.blockedPeers,
		})
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/state$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params[0]
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
				memberKind: isAgent ? 'agent' : 'user',
				pubKeyHash: isAgent ? memberRow.ownerPubKeyHash : memberKey,
				charname: isAgent ? memberRow.charname : null,
				agentEntityHash: isAgent ? memberRow.agentEntityHash : null,
				ownerPubKeyHash: isAgent ? memberRow.ownerPubKeyHash : null,
				nodeHash: memberRow.homeNodeHash,
				subjectHash: isAgent ? null : memberKey,
				entityHash,
				pubKeyHex: memberRow.pubKeyHex || null,
				roles: memberRow.roles || ['@everyone'],
				joinedAt: memberRow.joinedAt,
				displayName,
			}
		}))

		const bannedMembersList = Array.from(state.bannedMembers)
			.map(pubKeyHash => ({ pubKeyHash: String(pubKeyHash) }))

		const pinsByChannel = checkpoint?.overlay?.pins || {}

		const { readQuarantineRows } = await import('../../chat/events/quarantine.mjs')
		const quarantineRows = active ? await readQuarantineRows(username, groupId) : []

		const hasLocalReplica = await userHasLocalGroupReplica(username, groupId)
		const serializableState = {
			groupId: state.groupId,
			hasLocalReplica,
			groupMeta: state.groupMeta,
			groupSettings,
			channels,
			roles: state.roles,
			channelPermissions,
			members: activeMembers,
			bannedMembers: bannedMembersList,
			memberCount: activeMembers.length,
			membersRoot: state.membersRoot ?? null,
			membersPagesCount: state.membersPagesCount ?? null,
			isMember: active,
			myRoles: member?.roles || [],
			viewerMemberPubKeyHash: active ? memberKey : null,
			viewerEntityHash: active
				? await getGroupMemberEntityHash(username, groupId).catch(() => null)
				: null,
			pinsByChannel,
			consensusBranchTip: state.consensusBranchTip ?? null,
			localViewBranchTip: state.localViewBranchTip ?? null,
			governanceFork: !!state.governanceFork,
			dagTips: state.dagTips,
			pendingDecryptBuffer: getPendingDecryptBufferStats(username, groupId),
			quarantineCount: quarantineRows.length,
			fileFolders: state.fileFolders,
			files: listActiveFilesFromState(state),
		}
		if (active) {
			const session = await getMaterializedSession(username, groupId)
			serializableState.charPartNames = Object.keys(session.chars || {})
			const channelCaps = {}
			for (const channelId of Object.keys(channels))
				channelCaps[channelId] = {
					canEditList: canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId),
					canCreateThreads: canInChannel(state, member, PERMISSIONS.CREATE_THREADS, channelId)
						|| canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, channelId),
					canStream: canInChannel(state, member, PERMISSIONS.STREAM, channelId),
					canManageMessages: canInChannel(state, member, PERMISSIONS.MANAGE_MESSAGES, channelId),
				}
			serializableState.channelCaps = channelCaps
		}
		if (active && canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, null)) {
			serializableState.reputationLedger = state.reputationLedger.slice(-50)
			serializableState.inviteEdges = state.inviteEdges.slice(0, 200)
		}
		if (active) {
			const { isArchiveCoverageComplete, loadArchiveManifest } = await import('../../chat/archive/index.mjs')
			const manifest = await loadArchiveManifest(username, groupId)
			serializableState.archiveCoverage = {
				complete: isArchiveCoverageComplete(manifest),
				channels: manifest.coverage || {},
			}
		}
		res.status(200).json({ state: serializableState })
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/snapshot$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		const { checkpoint } = await getState(username, groupId)
		res.status(200).json({ snapshot: checkpoint })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/compact$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext
		if (!canInChannel(state, member, PERMISSIONS.ADMIN, governanceChannelId(state)))
			return res.status(403).json({ error: 'ADMIN required' })
		res.status(200).json(await compactGroup(username, groupId))
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/federation\/rotate-room-secret$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		const channelId = governanceChannelId(state)
		if (!canInChannel(state, member, PERMISSIONS.ADMIN, channelId)
			&& !canInChannel(state, member, PERMISSIONS.MANAGE_ADMINS, channelId))
			return res.status(403).json({ error: 'ADMIN or MANAGE_ADMINS required' })
		if (!isGroupFederationActive(state.groupSettings))
			return res.status(409).json({ error: 'federation not active; invite a member first' })

		const mqttRoomSecret = mintMqttRoomSecret()
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { mqttRoomSecret },
		})
		invalidateFederationRoomCache(username, groupId)
		void catchUpGroupFromPeers(username, groupId).catch(console.error)
		res.status(200).json({ mqttRoomSecret })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/federation\/tuning$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		const channelId = governanceChannelId(state)
		if (!canInChannel(state, member, PERMISSIONS.ADMIN, channelId)
			&& !canInChannel(state, member, PERMISSIONS.MANAGE_ADMINS, channelId))
			return res.status(403).json({ error: 'ADMIN or MANAGE_ADMINS required' })
		const patch = {}
		const partitionCount = Number(req.body?.federationPartitionCount)
		if (Number.isFinite(partitionCount))
			patch.federationPartitionCount = Math.max(2, Math.min(64, Math.floor(partitionCount)))
		const rtcBudget = Number(req.body?.rtcConnectionBudgetMax)
		if (Number.isFinite(rtcBudget))
			patch.rtcConnectionBudgetMax = Math.max(8, Math.min(128, Math.floor(rtcBudget)))
		const rtcJoinRate = Number(req.body?.rtcJoinRatePerMin)
		if (Number.isFinite(rtcJoinRate))
			patch.rtcJoinRatePerMin = Math.max(4, Math.min(60, Math.floor(rtcJoinRate)))
		if (!Object.keys(patch).length)
			return res.status(400).json({ error: 'no valid tuning fields' })
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: patch,
		})
		invalidateFederationRoomCache(username, groupId)
		res.status(200).json({ ok: true, patch })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/federation\/catchup$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username } = membership
		const { state } = await getState(username, groupId)
		res.status(200).json(await catchUpGroupFromPeers(username, groupId, {
			waitMs: req.body.waitMs,
			extraWantIds: Array.isArray(req.body.extraWantIds) ? req.body.extraWantIds : undefined,
		}))
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/federation\/offline-mark$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username } = membership
		const wallMs = Number(req.body?.wallMs) || Date.now()
		res.status(200).json(await markGroupOfflineStarted(username, groupId, wallMs))
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/federation\/join-snapshot$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username } = membership
		const slot = await ensureFederationRoom(username, groupId)
		if (!slot)
			return res.status(200).json({ ok: true, skipped: true, reason: 'federation_inactive' })
		res.status(200).json(await requestJoinSnapshotFromPeers(username, groupId, slot))
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/archive\/summary$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const { username } = await getUserByReq(req)
		if (!await userHasLocalGroupReplica(username, groupId))
			return res.status(404).json({ error: 'No local group replica' })
		const { summarizeArchiveStorage } = await import('../../chat/archive/index.mjs')
		res.status(200).json({ files: await summarizeArchiveStorage(username, groupId) })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/archive\/sync$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username } = membership
		const { ensureFederationRoom } = await import('../../chat/federation/room.mjs')
		const { syncMissingArchiveMonths } = await import('../../chat/archive/syncMonths.mjs')
		const slot = await ensureFederationRoom(username, groupId)
		if (!slot)
			return res.status(503).json({ error: 'federation room unavailable' })
		res.status(200).json(await syncMissingArchiveMonths(username, groupId, slot))
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/archive$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const { username } = await getUserByReq(req)
		if (!await userHasLocalGroupReplica(username, groupId))
			return res.status(404).json({ error: 'No local group replica' })
		const beforeMonth = String(req.query.before || '').trim()
		if (!/^\d{4}-\d{2}$/.test(beforeMonth))
			return res.status(400).json({ error: 'before must be YYYY-MM' })
		const { deleteArchivesBeforeMonth } = await import('../../chat/archive/index.mjs')
		res.status(200).json(await deleteArchivesBeforeMonth(username, groupId, beforeMonth))
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/federation\/rebind$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username } = membership
		const channelId = String(req.body?.channelId || '').trim() || null
		const slot = await ensureFederationRoom(username, groupId, { channelId: channelId || undefined })
		if (!slot)
			return res.status(200).json({ ok: true, skipped: true, reason: 'federation_inactive', channelId })
		res.status(200).json({ ok: true, channelId })
	})
}
