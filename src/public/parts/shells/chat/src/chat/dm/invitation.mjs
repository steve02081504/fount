/**
 * 【文件】dm/invitation.mjs
 * 【职责】把「邀请者节点加入这个 ECDH DM 群」这件事送到邀请者节点，并在邀请者侧完成入群。
 * 【原理】邀请方（新建节点的 home shell）建群后经 node scope `part_invoke`（partpath `shells/chat`）投递群票据与房间凭证；
 *   入站由 p2p_server 的 part_invoke 处理器**按需 loadPart** chat shell，命中本模块的 `dm_invitation` 分支，
 *   由 `performMemberJoin` 完成入房 + catch-up。没有这条投递，邀请者的 `getInvitationProgress` 永远等不到对方入群。
 *   投递可能重复或丢失，故入站侧先去重（inflight 复用 + 完成窗口），邀请侧另按 30s 节流重投。
 * 【数据结构】载荷 `{ kind, groupId, inviteCode, roomSecret, signalingAppId, dmSessionTag, introducerPubKeyHash,
 *   introducerNodeHash, introducerEntityHash, inviterEntityHash, inviterPubKeyHex }`；`inviter*` 是贴了 contact link、
 *   必须入群的那一侧（产品语义上的邀请者），`introducer*` 是建群并投递邀请的新节点（群 owner）。
 * 【关联】home/src/invitation.mjs、governance/joinPolicy、federation/roomCredentials、lib/inviteTickets、dm/index performMemberJoin。
 */
import { compositeKey } from 'npm:@steve02081504/fount-p2p/core/composite_key'
import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { sendToNodeLink } from 'npm:@steve02081504/fount-p2p/transport/link_registry'

import { getAllUserNames } from '../../../../../../../server/auth/index.mjs'
import { isWritableLocalEntityForUser } from '../../entity/http.mjs'
import { listEntityIdentities } from '../../entity/store.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { DEFAULT_SIGNALING_APP_ID, roomCredentialsFromGroupSettings } from '../federation/roomCredentials.mjs'
import { mintGroupInviteTicket } from '../lib/inviteTickets.mjs'
import { isSafeGroupId } from '../lib/paths.mjs'

/** 入站 part_invoke 的 `kind`。 */
export const DM_INVITATION_KIND = 'dm_invitation'

/** 目标 part：chat shell 的 partpath（与 `registerShellPartpath('chat', 'shells/chat')` 一致）。 */
const CHAT_PART_PATH = 'shells/chat'

/** 同一 (用户, 群) 的入群去重窗口（毫秒）：重复投递不再重复入群。 */
const INVITATION_DEDUPE_MS = 60_000

/** 去重表容量上限（键为 `compositeKey(username, groupId)`）。 */
const DEDUPE_MAX_ENTRIES = 256

/** @type {Map<string, number>} 最近完成的入群时间 */
const recentJoins = new Map()
/** @type {Map<string, Promise<object>>} 进行中的入群 */
const inflightJoins = new Map()

/**
 * 邀请方（被贴 contact link 的一方）为 DM 群组装邀请载荷。
 * @param {string} username 邀请方登录名
 * @param {string} groupId DM 群 ID
 * @param {{ entityHash?: string, inviterEntityHash?: string, inviterPubKeyHex: string }} options 邀请参数
 * @returns {Promise<object>} 可投递的 `dm_invitation` 载荷
 */
export async function buildDmInvitation(username, groupId, options) {
	// 邀请目标以活跃公钥为准（签名 DM 深链只带公钥，不带 entityHash），entityHash 只作为核对提示。
	if (!isHex64(options?.inviterPubKeyHex)) throw new Error('invitation needs the invited entity pub key')
	const inviterEntityHash = String(options.inviterEntityHash || '')
	if (inviterEntityHash && !isEntityHash128(inviterEntityHash)) throw new Error('invitation entity hash is invalid')

	const { state } = await getState(username, groupId)
	const creds = roomCredentialsFromGroupSettings(state.groupSettings)
	if (!creds?.roomSecret) throw new Error('DM group has no federation room credentials')
	const dmSessionTag = String(state.groupMeta?.dmSessionTag || '')
	if (!isHex64(dmSessionTag)) throw new Error('DM group has no session tag')

	// DM 群默认 joinPolicy invite-only，且 dmKnownPeer 比较的是 per-group signer 与实体公钥两个命名空间，
	// 所以对方入群必须带一张本节点签发的邀请码，否则会被 validateJoinPolicy 判为 pendable 而进不了 active。
	const { code } = await mintGroupInviteTicket(username, groupId)
	const { sender: introducerPubKeyHash, entityHash: introducerEntityHash } =
		await resolveLocalEventSigner(username, groupId, options.entityHash)

	return {
		kind: DM_INVITATION_KIND,
		groupId: String(groupId),
		inviteCode: code,
		roomSecret: creds.roomSecret,
		signalingAppId: creds.signalingAppId,
		dmSessionTag,
		introducerPubKeyHash,
		introducerNodeHash: getNodeHash(),
		introducerEntityHash,
		inviterEntityHash,
		inviterPubKeyHex: options.inviterPubKeyHex,
	}
}

/**
 * 把邀请载荷投递给邀请者节点：node scope `part_invoke`，入站方按需加载 chat shell。
 * 返回值只表示帧已交给链路，不代表对方已处理——入群结果一律由 `getInvitationProgress` 轮询确认。
 * @param {string} targetNodeHash 邀请者节点 nodeHash
 * @param {object} invitation `buildDmInvitation` 的产物
 * @returns {Promise<boolean>} 帧是否已发出
 */
export async function sendDmInvitation(targetNodeHash, invitation) {
	if (!isHex64(String(targetNodeHash || ''))) return false
	try {
		return await sendToNodeLink(targetNodeHash, {
			scope: 'node',
			action: 'part_invoke',
			payload: {
				partpath: CHAT_PART_PATH,
				invoke: invitation,
				nodeHash: getNodeHash(),
			},
		})
	}
	catch {
		return false
	}
}

/**
 * 邀请者侧：把邀请载荷解析成本机可写的 `{ username, entityHash }`。
 * 以活跃公钥为准匹配（签名 DM 深链不带 entityHash）；载荷带 entityHash 时要求两者一致。
 * @param {string} inviterEntityHash 被邀请实体 entityHash（可为空串）
 * @param {string} inviterPubKeyHex 邀请载荷里声称的实体活跃公钥
 * @returns {Promise<{ username: string, entityHash: string } | null>} 目标；不属于本机时为 null
 */
async function resolveInvitedEntity(inviterEntityHash, inviterPubKeyHex) {
	if (!isHex64(inviterPubKeyHex)) return null
	for (const username of getAllUserNames()) {
		const identities = await listEntityIdentities(username).catch(() => [])
		for (const row of identities) {
			if (row.activePubKeyHex !== inviterPubKeyHex) continue
			const entityHash = String(row.entityHash)
			if (inviterEntityHash && entityHash !== inviterEntityHash) continue
			if (!await isWritableLocalEntityForUser(username, entityHash).catch(() => false)) continue
			return { username, entityHash }
		}
	}
	return null
}

/**
 * 入站 `dm_invitation`：校验后让本机实体入群（幂等 / 去重）。
 * @param {object} data 邀请载荷
 * @param {{ requesterNodeHash?: string | null }} [ingress] 联邦入站元数据（已认证的发送方节点）
 * @returns {Promise<object | null>} 入群结果；载荷不属于本机时为 null
 */
export async function handleDmInvitation(data, ingress = {}) {
	const requesterNodeHash = String(ingress?.requesterNodeHash || '')
	if (!isHex64(requesterNodeHash)) throw new Error('dm_invitation requires an authenticated sender node')
	// 载荷自称的发送方必须就是链路上已认证的那一方：否则任何连上的节点都能替别人投递邀请。
	if (data?.introducerNodeHash !== requesterNodeHash)
		throw new Error('dm_invitation sender does not match the authenticated link')
	const introducerEntityHash = String(data?.introducerEntityHash || '')
	if (!isEntityHash128(introducerEntityHash) || parseEntityHash(introducerEntityHash).nodeHash !== requesterNodeHash)
		throw new Error('dm_invitation has an invalid sender entity')

	const groupId = String(data?.groupId || '')
	if (!isSafeGroupId(groupId)) throw new Error('dm_invitation has an invalid group id')
	const inviteCode = String(data?.inviteCode || '')
	const roomSecret = String(data?.roomSecret || '')
	const dmSessionTag = String(data?.dmSessionTag || '')
	if (!inviteCode || !roomSecret || !isHex64(dmSessionTag))
		throw new Error('dm_invitation is missing credentials')

	const inviterEntityHash = String(data?.inviterEntityHash || '')
	if (inviterEntityHash && !isEntityHash128(inviterEntityHash)) throw new Error('dm_invitation has an invalid entity hash')
	// 被邀请实体必须是**本机可写实体**（按活跃公钥匹配），否则这不是给本机的邀请。
	const invited = await resolveInvitedEntity(inviterEntityHash, String(data?.inviterPubKeyHex || ''))
	if (!invited) return null
	const { username, entityHash } = invited

	const key = compositeKey(username, groupId)
	// 重发是常态：已经在本群 active 就直接短路，不重复 append member_join。
	const { state } = await getState(username, groupId)
	const alreadyActive = Object.values(state.members || {}).some(member =>
		member?.status === 'active' && member.entityHash === entityHash)
	if (alreadyActive) return { groupId, entityHash, joined: true, alreadyMember: true }
	const recent = recentJoins.get(key)
	if (recent && Date.now() - recent < INVITATION_DEDUPE_MS) return { groupId, entityHash, deduped: true }
	const inflight = inflightJoins.get(key)
	if (inflight) return await inflight

	const task = (async () => {
		const { performMemberJoin } = await import('./index.mjs')
		await performMemberJoin(username, groupId, {
			// 入群是幂等的：同群已有活跃成员时 performMemberJoin 只重灌联邦绑定。
			entityHash,
			inviteCode,
			bootstrap: {
				roomSecret,
				signalingAppId: String(data?.signalingAppId || '') || DEFAULT_SIGNALING_APP_ID,
				dmSessionTag,
				fromNodeId: requesterNodeHash,
			},
		})
		recentJoins.set(key, Date.now())
		if (recentJoins.size > DEDUPE_MAX_ENTRIES) {
			const cutoff = Date.now() - INVITATION_DEDUPE_MS
			for (const [entryKey, at] of recentJoins)
				if (at < cutoff) recentJoins.delete(entryKey)
		}
		return { groupId, entityHash, joined: true }
	})()

	inflightJoins.set(key, task)
	try {
		return await task
	}
	finally {
		inflightJoins.delete(key)
	}
}
