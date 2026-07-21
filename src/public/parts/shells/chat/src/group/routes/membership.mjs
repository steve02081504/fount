/**
 * 【文件】group/routes/membership.mjs
 * 【职责】成员分页、入群/退群、邀请票等成员关系 HTTP 路由。
 * 【原理】成员页从物化 state.members 切片；join 消费 inviteCode 或 DM intro 证明后 append member_join；leave 追加 member_leave 并 removeLocalGroupReplica；邀请票需 INVITE_MEMBERS。
 * 【数据结构】成员页 {members,membersPagesCount}、invite ticket、powSolution、join content（introducerPubKeyHash/reputationEdge）。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/dag、chat/lib/inviteTickets、access.mjs、groupSync 无关。
 */
import { calculateMemberPermissions, PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { geti18nForUser } from '../../../../../../../scripts/i18n/index.mjs'
import { getUserByReq } from '../../../../../../../server/auth/index.mjs'
import { formatJoinRunUri, wrapProtocolHttpsUrl } from '../../../public/shared/runUri.mjs'
import { leaveManyGroupsForUser } from '../../chat/dag/leaveMany.mjs'
import { resolveLocalEventSigner } from '../../chat/dag/localSigner.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { computeDmRoomLabelFromPubKeys } from '../../chat/dm/labels.mjs'
import { validateDmIntroLinkProof } from '../../chat/dm/linkValidate.mjs'
import { getFederationSettings } from '../../chat/federation/config.mjs'
import { activateGroupFederation, isGroupFederationActive } from '../../chat/federation/groupFederation.mjs'
import { roomCredentialsFromGroupSettings } from '../../chat/federation/roomCredentials.mjs'
import { collectJoinPowAnchors } from '../../chat/governance/joinPowAnchors.mjs'
import { mintGroupInviteTicket } from '../../chat/lib/inviteTickets.mjs'
import { getLocalNodeHash } from '../../chat/lib/replica.mjs'
import { chatClientFromReq } from '../../endpoints/shared.mjs'
import { memberEntityHash } from '../../entity/member.mjs'
import { governanceChannelId } from '../access.mjs'
import { suggestGroupMentions } from '../lib/mentionSuggest.mjs'

import { requireGroupMember, resolveGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

const MEMBERS_PAGE_SIZE = 500

/**
 * 本地 replica 是否已有创世/bootstrap 事件物化结果（频道、群名或角色）。
 * @param {object} state 物化群状态
 * @returns {boolean} 是否已有 bootstrap 物化结果
 */
function groupHasBootstrapGenesis(state) {
	if (Object.keys(state.channels || {}).length > 0) return true
	if (String(state.groupMeta?.name || '').trim()) return true
	if (Object.keys(state.roles || {}).length > 0) return true
	return false
}

/**
 * 按用户 locale 生成群邀请剪贴板全文（含 protocol 包装深链）。
 * @param {string} username 签发者
 * @param {string} groupId 群 ID
 * @param {string} code 邀请码
 * @param {string} roomSecret 群房间传输密钥（写入 join 深链）
 * @param {string} introducerPubKeyHash 邀请人成员 pubKeyHash
 * @param {string | null} [powAnchorRef] PoW anchor 提示（写入 join 深链）
 * @param {string | null} [introducerNodeHash] 邀请人 nodeHash（写入 join 深链）
 * @returns {Promise<string>} 本地化剪贴板文本
 */
async function buildInviteClipboardText(username, groupId, code, roomSecret, introducerPubKeyHash, powAnchorRef, introducerNodeHash) {
	const url = wrapProtocolHttpsUrl(formatJoinRunUri(groupId, code, roomSecret, introducerPubKeyHash, powAnchorRef, introducerNodeHash))
	return geti18nForUser(username, 'chat.group.settingsPage.inviteClipboard', {
		groupId,
		code,
		url,
	})
}

/**
 * 注册成员分页、入群、邀请路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerMembershipRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/members/page/:pageIdx`, authenticate, requireGroupMember(), async (req, res) => {
		const { groupId, state } = req.groupContext
		const pageIndex = Math.max(0, Number(req.params.pageIdx) || 0)

		const activeMembers = Object.entries(state.members).filter(([, member]) => member?.status === 'active')
		const pageCount = Math.max(1, Math.ceil(activeMembers.length / MEMBERS_PAGE_SIZE))
		const pageSlice = activeMembers.slice(pageIndex * MEMBERS_PAGE_SIZE, (pageIndex + 1) * MEMBERS_PAGE_SIZE)
		const members = pageSlice.map(([memberKey, member]) => {
			const entityHash = memberEntityHash(member) || null
			const isAgent = member.memberKind === 'agent'
			return {
				memberKey,
				kind: isAgent ? 'agent' : 'user',
				ownerEntityHash: member.ownerEntityHash || undefined,
				nodeHash: member.homeNodeHash,
				entityHash,
				roles: member.roles || [],
				joinedAt: member.joinedAt,
				profile: { name: member.displayName || `${memberKey.slice(0, 8)}…${memberKey.slice(-4)}` },
			}
		})
		res.status(200).json({
			members,
			membersPagesCount: pageCount,
			membersRoot: state.membersRoot ?? null,
		})
	})

	router.get(`${GROUPS_PREFIX}/:groupId/mentions/suggest`, authenticate, requireGroupMember(), async (req, res) => {
		const { username } = getUserByReq(req)
		const { groupId } = req.groupContext
		res.status(200).json(await suggestGroupMentions(username, groupId, String(req.query.q || ''), Number(req.query.limit) || 20))
	})

	router.post(`${GROUPS_PREFIX}/:groupId/invite-ticket`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		const permissionsChannelId = governanceChannelId(state)
		const perms = calculateMemberPermissions(member, state.roles, permissionsChannelId, state.channelPermissions)
		if (!perms[PERMISSIONS.INVITE_MEMBERS] && !perms[PERMISSIONS.ADMIN] && !perms[PERMISSIONS.MANAGE_ADMINS])
			throw httpError(403, 'INVITE_MEMBERS denied')
		const ttlMs = Number(req.body?.ttlMs)
		const ticket = await mintGroupInviteTicket(username, groupId, {
			ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
		})
		const roomCreds = isGroupFederationActive(state.groupSettings)
			? roomCredentialsFromGroupSettings(state.groupSettings)
			: await activateGroupFederation(username, groupId)
		const { sender: introducerPubKeyHash } = await resolveLocalEventSigner(username, groupId)
		const powAnchors = collectJoinPowAnchors(state)
		const powAnchorRef = powAnchors[0] ?? null
		const clipboardText = await buildInviteClipboardText(
			username,
			groupId,
			ticket.code,
			roomCreds.roomSecret,
			introducerPubKeyHash,
			powAnchorRef,
			getLocalNodeHash(),
		)
		res.status(201).json({
			...ticket,
			clipboardText,
			signalingAppId: roomCreds.signalingAppId,
			roomSecret: roomCreds.roomSecret,
			introducerPubKeyHash,
			introducerNodeHash: getLocalNodeHash(),
			powAnchors,
			powAnchorRef,
			dmSessionTag: state.groupMeta?.dmKind === 'ecdh'
				? String(state.groupMeta.dmSessionTag || '').trim().toLowerCase() || null
				: null,
		})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/join`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { groupId } = req.params
		const { inviteCode, pow, introducerPubKeyHash, introducerNodeHash, reputationEdge, dmIntroNonce, dmIntroSignatureHex, roomSecret, signalingAppId, dmSessionTag, powAnchorRef, powAnchors } = req.body
		const dmNonce = dmIntroNonce?.trim()
		const dmSignatureHex = dmIntroSignatureHex?.trim().replace(/^0x/iu, '')
		if (!!dmNonce !== !!dmSignatureHex)
			throw httpError(400, 'provide both dmIntroNonce and dmIntroSignatureHex for DM link proof or omit both')
		const { state } = await getState(username, groupId)
		if (dmNonce) {
			const dmCheck = await validateDmIntroLinkProof(username, state, normalizePubKeyHex(introducerPubKeyHash), dmNonce, dmSignatureHex)
			if (!dmCheck.ok)
				throw httpError(400, dmCheck.error)
		}
		const hasJoinAuthorization = Boolean(inviteCode) || Boolean(dmNonce) || Boolean(String(roomSecret || '').trim())
		if (!groupHasBootstrapGenesis(state) && !hasJoinAuthorization)
			throw httpError(404, 'Group not found; join with invite or federation bootstrap')

		let bootstrap
		if (roomSecret) {
			bootstrap = { signalingAppId, roomSecret }
			const hintedNodeHash = normalizePubKeyHex(introducerNodeHash)
			if (PUB_KEY_HEX_64.test(hintedNodeHash))
				bootstrap.fromNodeId = hintedNodeHash
			if (powAnchorRef?.trim()) bootstrap.powAnchorRef = String(powAnchorRef).trim()
			if (Array.isArray(powAnchors) && powAnchors.length) bootstrap.powAnchors = powAnchors.map(String)
			const hintedSessionTag = String(dmSessionTag || '').trim().toLowerCase()
			if (PUB_KEY_HEX_64.test(hintedSessionTag))
				bootstrap.dmSessionTag = hintedSessionTag
			else if (dmNonce) {
				const introPubKeyHex = normalizePubKeyHex(introducerPubKeyHash)
				const myPubKeyHex = normalizePubKeyHex((await getFederationSettings(username)).activePubKeyHex)
				if (PUB_KEY_HEX_64.test(introPubKeyHex) && PUB_KEY_HEX_64.test(myPubKeyHex) && introPubKeyHex !== myPubKeyHex)
					bootstrap.dmSessionTag = computeDmRoomLabelFromPubKeys(introPubKeyHex, myPubKeyHex).dmSessionTag
			}
		}

		const { client } = await chatClientFromReq(req)
		const group = await client.join(groupId, {
			inviteCode,
			powSolution: pow,
			introducerPubKeyHash,
			dmIntroNonce: dmNonce,
			dmIntroSignatureHex: dmSignatureHex,
			reputationEdge,
			bootstrap,
		})
		const { loadGroupState } = await import('../../api/internal.mjs')
		const joinedState = await loadGroupState({ username, entityHash: client.entityHash }, group.id)
		res.status(200).json({
			groupId,
			defaultChannelId: joinedState.groupSettings?.defaultChannelId || 'default',
		})
	})

	router.post(`${GROUPS_PREFIX}/leave`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { groupIds } = req.body
		if (!Array.isArray(groupIds) || !groupIds.length)
			throw httpError(400, 'groupIds array required')
		try {
			const result = await leaveManyGroupsForUser(username, groupIds)
			res.status(200).json(result)
		}
		catch (err) {
			if (err?.code === 'BATCH_LIMIT')
				throw httpError(400, err.message)
			throw err
		}
	})
}
