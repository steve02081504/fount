import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { ensureRemoteUserRoom } from 'npm:@steve02081504/fount-p2p/transport/remote_user_room'

import { sleep } from '../../../../../scripts/sleep.mjs'
import { acceptInvitation, invitationStatus } from '../../../../../server/invitation.mjs'
import { config, save_config } from '../../../../../server/server.mjs'
import { getState } from '../../chat/src/chat/dag/materialize.mjs'
import { createEcdhDmGroup } from '../../chat/src/chat/dm/index.mjs'
import { buildDmInvitation, sendDmInvitation } from '../../chat/src/chat/dm/invitation.mjs'
import { validateDmIntroLinkProof } from '../../chat/src/chat/dm/linkValidate.mjs'
import { getFederationViewForUser } from '../../chat/src/entity/identity.mjs'
import { getProfile } from '../../chat/src/entity/profile.mjs'
import { parseInvitationLink } from '../public/shared/invitationLink.mjs'

/** 仍待确认时重新投递邀请的间隔（毫秒）；单条 node 消息丢失不至于让邀请永久卡住。 */
const INVITATION_RETRY_INTERVAL_MS = 30_000
/** 一次自动重投的轮数上限；达到上限后由 `getInvitationProgress`（有人看进度时）重新起轮。 */
const INVITATION_RETRY_ROUNDS = 20

/** 邀请者资料的重试次数（链路刚建立时 EVFS 首次 manifest 拉取可能超时）与退避基数（毫秒）。 */
const PROFILE_FETCH_ATTEMPTS = 3
const PROFILE_FETCH_BACKOFF_MS = 1_200

/** @type {Map<string, ReturnType<typeof setTimeout>>} 各用户的自动重投定时器 */
const invitationTimers = new Map()

/**
 * 停止某用户的自动重投。
 * @param {string} username 本地用户
 * @returns {void}
 */
function stopInvitationRetry(username) {
	const timer = invitationTimers.get(username)
	if (!timer) return
	clearTimeout(timer)
	invitationTimers.delete(username)
}

/**
 * 起一轮后台自动重投：邀请不依赖"有人打开页面轮询"持续推进。
 * `unref()` 让它不拖住进程退出；邀请被接受或 pending 行被替换时由 `stopInvitationRetry` 收掉。
 * @param {string} username 本地用户
 * @param {object} pending `config.pendingInvitations[username]` 行
 * @param {number} [roundsLeft] 剩余轮数
 * @returns {void}
 */
function scheduleInvitationRetry(username, pending, roundsLeft = INVITATION_RETRY_ROUNDS) {
	stopInvitationRetry(username)
	if (roundsLeft <= 0) return
	const timer = setTimeout(async () => {
		invitationTimers.delete(username)
		const current = config.pendingInvitations?.[username]
		if (!current || current.groupId !== pending.groupId || invitationStatus().invited) return
		await deliverInvitation(username, current)
		scheduleInvitationRetry(username, current, roundsLeft - 1)
	}, INVITATION_RETRY_INTERVAL_MS)
	timer.unref?.()
	invitationTimers.set(username, timer)
}

/**
 * 读邀请者的活跃公钥：链路刚建立时远端资料读取可能首次超时，故有界重试后再判失败。
 * @param {string} username 本地用户
 * @param {string} entityHash 邀请者实体
 * @returns {Promise<string | null>} 64 hex 活跃公钥
 */
async function resolveInviterPubKeyHex(username, entityHash) {
	for (let attempt = 1; attempt <= PROFILE_FETCH_ATTEMPTS; attempt++) {
		const profile = await getProfile(entityHash, username, { fetchRemote: true, forceRemote: true, skipPresentation: true }).catch(() => null)
		const pubKeyHex = isHex64(profile?.activePubKeyHex)
		if (pubKeyHex) return pubKeyHex
		if (attempt < PROFILE_FETCH_ATTEMPTS) await sleep(PROFILE_FETCH_BACKOFF_MS * attempt)
	}
	return null
}

/**
 * 解析邀请节点身份并核对可选的 HTTP 地址。
 * @param {object} dm 私聊载荷
 * @returns {Promise<string>} 邀请节点哈希
 */
async function resolveInviterNodeHash(dm) {
	let fromUrl = null
	if (dm.nodeUrl) {
		const url = new URL('/api/ping', dm.nodeUrl)
		if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid inviter node URL')
		const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
		if (!response.ok) throw new Error('Inviter node is unreachable')
		const data = await response.json()
		fromUrl = isHex64(data.nodeHash)
		if (!fromUrl) throw new Error('Inviter node did not provide its node hash')
	}
	const fromLink = isHex64(dm.nodeHash)
	if (fromUrl && fromLink && fromUrl !== fromLink) throw new Error('Inviter node identity mismatch')
	const nodeHash = fromUrl || fromLink
	if (!nodeHash) throw new Error('This older invitation link needs an inviter node URL')
	return nodeHash
}

/**
 * 把待确认的邀请投递给邀请节点：没有这条投递，邀请方永远不会入群，进度也就永远停在 pending。
 * 失败不抛错——轮询会按 `INVITATION_RESEND_INTERVAL_MS` 重发。
 * @param {string} username 本地用户
 * @param {object} pending `config.pendingInvitations[username]` 行
 * @returns {Promise<boolean>} 本次是否已发出
 */
async function deliverInvitation(username, pending) {
	pending.lastInvitationSentAt = Date.now()
	try {
		const invitation = await buildDmInvitation(username, pending.groupId, {
			inviterEntityHash: pending.peerEntityHash,
			inviterPubKeyHex: pending.peerPubKeyHex,
		})
		pending.invitationSent = await sendDmInvitation(pending.nodeHash, invitation)
	}
	catch (error) {
		pending.invitationSent = false
		console.warn('home: DM invitation delivery failed', error)
	}
	save_config()
	return pending.invitationSent === true
}

/**
 * 建立私聊、把邀请投递给邀请节点并等待其入群。
 * @param {string} username 本地用户
 * @param {string} input 邀请链接
 * @returns {Promise<object>} 当前邀请进度
 */
export async function startInvitation(username, input) {
	if (invitationStatus().invited) return invitationStatus()
	const dm = parseInvitationLink(input)
	if (!dm.entityHash) {
		const proof = await validateDmIntroLinkProof(username, { members: {} }, dm.pubKeyHex, dm.nonce, dm.introSignatureHex)
		if (!proof.ok) throw new Error(proof.error)
	}
	const nodeHash = await resolveInviterNodeHash(dm)
	const self = await getFederationViewForUser(username)
	if (self.nodeHash === nodeHash) throw new Error('Use the keyboard sequence to invite this node itself')
	const slot = await ensureRemoteUserRoom(nodeHash)
	if (!slot) throw new Error('Could not connect to inviter node')
	if (dm.entityHash) {
		dm.pubKeyHex = await resolveInviterPubKeyHex(username, dm.entityHash)
		if (!dm.pubKeyHex) throw new Error('Inviter profile did not provide its active public key')
	}
	const group = await createEcdhDmGroup(username, self.activePubKeyHex, dm.pubKeyHex)
	config.pendingInvitations ??= {}
	const pending = {
		groupId: group.groupId,
		peerPubKeyHex: dm.pubKeyHex,
		nodeHash,
		...dm.entityHash && { peerEntityHash: dm.entityHash },
	}
	config.pendingInvitations[username] = pending
	save_config()
	await deliverInvitation(username, pending)
	scheduleInvitationRetry(username, pending)
	return { invited: false, pending: true, nodeHash }
}

/**
 * 查询远端成员是否已经加入私聊。
 * @param {string} username 本地用户
 * @returns {Promise<object>} 当前邀请进度
 */
export async function getInvitationProgress(username) {
	const status = invitationStatus()
	if (status.invited) {
		stopInvitationRetry(username)
		return status
	}
	const pending = config.pendingInvitations?.[username]
	if (!pending) {
		stopInvitationRetry(username)
		return { ...status, pending: false }
	}
	// 重启后（或上一轮重投用尽后）由进度查询补起一轮：自动重投不依赖前端轮询，但轮询会重新武装它。
	if (!invitationTimers.has(username)) {
		if (!pending.lastInvitationSentAt || Date.now() - pending.lastInvitationSentAt >= INVITATION_RETRY_INTERVAL_MS)
			await deliverInvitation(username, pending)
		scheduleInvitationRetry(username, pending)
	}
	const { state } = await getState(username, pending.groupId)
	const joined = Object.values(state.members || {}).find(member =>
		member?.status === 'active' && (pending.peerEntityHash
			? member.entityHash === pending.peerEntityHash
			: member?.entityHash?.startsWith(pending.nodeHash)))
	if (!joined) return { ...status, pending: true, nodeHash: pending.nodeHash }
	const profile = await getProfile(joined.entityHash, username, { fetchRemote: true, skipPresentation: true }).catch(() => null)
	if (profile?.activePubKeyHex !== pending.peerPubKeyHex)
		return { ...status, pending: true, nodeHash: pending.nodeHash }
	stopInvitationRetry(username)
	delete config.pendingInvitations[username]
	save_config()
	return acceptInvitation(pending.nodeHash)
}

/**
 * 将本节点登记为自己的邀请节点。
 * @returns {ReturnType<typeof invitationStatus>} 更新后的状态
 */
export function inviteSelf() {
	return acceptInvitation(invitationStatus().nodeHash)
}
