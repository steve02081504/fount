import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { ensureRemoteUserRoom } from 'npm:@steve02081504/fount-p2p/transport/remote_user_room'

import { acceptInvitation, invitationStatus } from '../../../../../server/invitation.mjs'
import { config, save_config } from '../../../../../server/server.mjs'
import { getState } from '../../chat/src/chat/dag/materialize.mjs'
import { createEcdhDmGroup } from '../../chat/src/chat/dm/index.mjs'
import { validateDmIntroLinkProof } from '../../chat/src/chat/dm/linkValidate.mjs'
import { getFederationViewForUser } from '../../chat/src/entity/identity.mjs'
import { getProfile } from '../../chat/src/entity/profile.mjs'
import { parseInvitationLink } from '../public/shared/invitationLink.mjs'

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
 * 建立私聊并等待邀请者实际加入。
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
		const profile = await getProfile(dm.entityHash, username, { fetchRemote: true, forceRemote: true, skipPresentation: true })
		dm.pubKeyHex = isHex64(profile?.activePubKeyHex)
		if (!dm.pubKeyHex) throw new Error('Inviter profile did not provide its active public key')
	}
	const group = await createEcdhDmGroup(username, self.activePubKeyHex, dm.pubKeyHex)
	config.pendingInvitations ??= {}
	config.pendingInvitations[username] = {
		groupId: group.groupId,
		peerPubKeyHex: dm.pubKeyHex,
		nodeHash,
		...dm.entityHash && { peerEntityHash: dm.entityHash },
	}
	save_config()
	return { invited: false, pending: true, nodeHash }
}

/**
 * 查询远端成员是否已经加入私聊。
 * @param {string} username 本地用户
 * @returns {Promise<object>} 当前邀请进度
 */
export async function getInvitationProgress(username) {
	const status = invitationStatus()
	if (status.invited) return status
	const pending = config.pendingInvitations?.[username]
	if (!pending) return { ...status, pending: false }
	const { state } = await getState(username, pending.groupId)
	const joined = Object.values(state.members || {}).find(member =>
		member?.status === 'active' && (pending.peerEntityHash
			? member.entityHash === pending.peerEntityHash
			: member?.entityHash?.startsWith(pending.nodeHash)))
	if (!joined) return { ...status, pending: true, nodeHash: pending.nodeHash }
	const profile = await getProfile(joined.entityHash, username, { fetchRemote: true, skipPresentation: true }).catch(() => null)
	if (profile?.activePubKeyHex !== pending.peerPubKeyHex)
		return { ...status, pending: true, nodeHash: pending.nodeHash }
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
