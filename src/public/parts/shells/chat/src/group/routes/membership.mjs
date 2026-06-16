/**
 * 【文件】group/routes/membership.mjs
 * 【职责】成员分页、入群/退群、邀请票、PoW challenge 等成员关系 HTTP 路由。
 * 【原理】成员页从物化 state.members 切片；join 消费 inviteCode 或 DM intro 证明后 append member_join；leave 追加 member_leave 并 removeLocalGroupReplica；邀请票需 INVITE_MEMBERS。
 * 【数据结构】成员页 {members,membersPagesCount}、invite ticket、pow challenge、join content（introducerPubKeyHash/reputationEdge）。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/dag、chat/lib/inviteTickets、access.mjs、groupSync 无关。
 */
import { randomUUID } from 'node:crypto'

import { geti18nForUser } from '../../../../../../../scripts/i18n.mjs'
import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { calculateMemberPermissions, PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { getUserByReq } from '../../../../../../../server/auth.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { leaveManyGroupsForUser } from '../../chat/dag/leaveMany.mjs'
import { resolveLocalEventSigner } from '../../chat/dag/localSigner.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { validateDmIntroLinkProof } from '../../chat/dm/linkValidate.mjs'
import { setFederationBootstrap } from '../../chat/federation/bootstrapStore.mjs'
import { activateGroupFederation, isGroupFederationActive } from '../../chat/federation/groupFederation.mjs'
import { mqttCredentialsFromGroupSettings } from '../../chat/federation/mqttCredentials.mjs'
import { memberEntityHash } from '../../chat/lib/entityId.mjs'
import { consumeGroupInviteTicket, mintGroupInviteTicket } from '../../chat/lib/inviteTickets.mjs'
import { getLocalNodeHash } from '../../chat/lib/replica.mjs'
import { formatJoinRunUri, wrapProtocolHttpsUrl } from '../../chat/lib/runUri.mjs'
import { setPowChallenge } from '../../chat/stream/groupWsHub.mjs'
import { governanceChannelId } from '../access.mjs'

import { requireGroupMember, resolveGroupMember } from './middleware.mjs'

const MEMBERS_PAGE_SIZE = 500

/**
 * 按用户 locale 生成群邀请剪贴板全文（含 protocol 包装深链）。
 * @param {string} username 签发者
 * @param {string} groupId 群 ID
 * @param {string} code 邀请码
 * @param {string} mqttRoomSecret 群 MQTT 传输密钥（写入 join 深链）
 * @param {string} introducerPubKeyHash 邀请人成员 pubKeyHash
 * @returns {Promise<string>} 本地化剪贴板文本
 */
async function buildInviteClipboardText(username, groupId, code, mqttRoomSecret, introducerPubKeyHash) {
	const url = wrapProtocolHttpsUrl(formatJoinRunUri(groupId, code, mqttRoomSecret, introducerPubKeyHash))
	return geti18nForUser(username, 'chat.group.settingsPage.inviteClipboard', {
		groupId,
		code,
		url,
	})
}

/**
 * 注册成员分页、入群、邀请与 PoW 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerMembershipRoutes(router, authenticate) {
	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/members\/page\/(\d+)$/, authenticate, requireGroupMember(), async (req, res) => {
		const { groupId, state } = req.groupContext
		const pageIndex = Math.max(0, Number(req.params[1]) || 0)

		const activeMembers = Object.entries(state.members).filter(([, member]) => member?.status === 'active')
		const pageCount = Math.max(1, Math.ceil(activeMembers.length / MEMBERS_PAGE_SIZE))
		const pageSlice = activeMembers.slice(pageIndex * MEMBERS_PAGE_SIZE, (pageIndex + 1) * MEMBERS_PAGE_SIZE)
		const members = pageSlice.map(([memberKey, member]) => {
			const pubKeyHash = memberKey
			const entityHash = memberEntityHash(member) || null
			return {
				pubKeyHash,
				nodeHash: member.homeNodeHash,
				subjectHash: pubKeyHash,
				entityHash,
				memberId: pubKeyHash,
				roles: member.roles || [],
				joinedAt: member.joinedAt,
				profile: { name: member.displayName || `${pubKeyHash.slice(0, 8)}…${pubKeyHash.slice(-4)}` },
			}
		})
		res.status(200).json({
			members,
			membersPagesCount: pageCount,
			membersRoot: state.membersRoot ?? null,
		})
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/pow-challenge$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params[0]
		const { state } = await getState(username, groupId)
		const difficulty = state.groupSettings?.powDifficulty || 4
		const challenge = randomUUID()
		setPowChallenge(username, groupId, challenge)
		res.status(200).json({ challenge: { challenge, difficulty } })
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/invite-ticket$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		const permissionsChannelId = governanceChannelId(state)
		const perms = calculateMemberPermissions(member, state.roles, permissionsChannelId, state.channelPermissions)
		if (!perms[PERMISSIONS.INVITE_MEMBERS] && !perms[PERMISSIONS.ADMIN] && !perms[PERMISSIONS.MANAGE_ADMINS])
			return res.status(403).json({ error: 'INVITE_MEMBERS denied' })
		const ttlMs = Number(req.body?.ttlMs)
		const ticket = await mintGroupInviteTicket(username, groupId, {
			ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
		})
		const mqttCreds = isGroupFederationActive(state.groupSettings)
			? mqttCredentialsFromGroupSettings(state.groupSettings)
			: await activateGroupFederation(username, groupId)
		const { sender: introducerPubKeyHash } = await resolveLocalEventSigner(username, groupId)
		const clipboardText = await buildInviteClipboardText(
			username,
			groupId,
			ticket.code,
			mqttCreds.mqttRoomSecret,
			introducerPubKeyHash,
		)
		res.status(201).json({
			...ticket,
			clipboardText,
			mqttAppId: mqttCreds.mqttAppId,
			mqttRoomSecret: mqttCreds.mqttRoomSecret,
			introducerPubKeyHash,
		})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/join$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params[0]
		const { inviteCode, pow, introducerPubKeyHash, reputationEdge, dmIntroNonce, dmIntroSignatureHex, mqttRoomSecret, mqttAppId } = req.body
		const dmNonce = dmIntroNonce?.trim()
		const dmSignatureHex = dmIntroSignatureHex?.trim().replace(/^0x/iu, '')
		if (!!dmNonce !== !!dmSignatureHex)
			return res.status(400).json({ error: 'provide both dmIntroNonce and dmIntroSignatureHex for DM link proof or omit both' })
		const { state } = await getState(username, groupId)
		if (dmNonce) {
			const dmCheck = await validateDmIntroLinkProof(
				username,
				state,
				normalizePubKeyHex(introducerPubKeyHash),
				dmNonce,
				dmSignatureHex,
			)
			if (!dmCheck.ok)
				return res.status(400).json({ error: dmCheck.error })
		}
		if (inviteCode) {
			const accepted = await consumeGroupInviteTicket(username, groupId, inviteCode)
			if (!accepted)
				return res.status(400).json({ error: 'invalid or expired inviteCode' })
		}
		const content = { inviteCode, powSolution: pow, homeNodeHash: getLocalNodeHash(username) }
		if (introducerPubKeyHash) {
			const normalizedIntroducer = normalizePubKeyHex(introducerPubKeyHash)
			if (PUB_KEY_HEX_64.test(normalizedIntroducer)) content.introducerPubKeyHash = normalizedIntroducer
		}
		if (Number.isFinite(reputationEdge))
			content.reputationEdge = Math.max(-1, Math.min(1, reputationEdge))

		if (mqttRoomSecret)
			setFederationBootstrap(username, groupId, { mqttAppId, mqttRoomSecret })

		const { ensureFederationRoom } = await import('../../chat/federation/room.mjs')
		const slot = await ensureFederationRoom(username, groupId)

		await appendSignedLocalEvent(username, groupId, {
			type: 'member_join',
			timestamp: Date.now(),
			content,
		})
		const { state: stateAfterJoin } = await getState(username, groupId)
		const { maybeAssignEcdhDmAdmin } = await import('../../chat/dm/index.mjs')
		await maybeAssignEcdhDmAdmin(username, groupId, stateAfterJoin)
		void (async () => {
			if (!slot) return
			const { requestJoinSnapshotFromPeers } = await import('../../chat/federation/joinSnapshot.mjs')
			const { catchUpGroupFromPeers } = await import('../../chat/federation/index.mjs')
			const { syncMissingArchiveMonths } = await import('../../chat/archive/syncMonths.mjs')
			await requestJoinSnapshotFromPeers(username, groupId, slot)
			void catchUpGroupFromPeers(username, groupId).catch(console.error)
			void syncMissingArchiveMonths(username, groupId, slot).catch(console.error)
		})().catch(console.error)
		res.status(200).json({
			groupId,
			defaultChannelId: stateAfterJoin.groupSettings?.defaultChannelId ?? null,
		})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/leave$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupIds = req.body?.groupIds
		if (!Array.isArray(groupIds) || !groupIds.length)
			return res.status(400).json({ error: 'groupIds array required' })
		try {
			const result = await leaveManyGroupsForUser(username, groupIds)
			res.status(200).json(result)
		}
		catch (err) {
			if (err?.code === 'BATCH_LIMIT')
				return res.status(400).json({ error: err.message })
			throw err
		}
	})
}
