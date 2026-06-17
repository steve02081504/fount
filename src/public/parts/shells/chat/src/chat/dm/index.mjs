/**
 * 【文件】dm/index.mjs
 * 【职责】ECDH 双人 DM 群生命周期：按 dmSessionTag 查找、创建群、联邦房间与好友绑定。
 * 【原理】labels 派生会话标签；createGroup + group_meta_update；initGroupFileMasterKey 加密成员 fileMasterKey；validateDmIntroLinkProof 入链。
 * 【数据结构】dmKind/dmSessionTag 元数据；createEcdhDmGroup 返回 groupId、defaultChannelId。
 * 【关联】dm/labels、linkValidate、dag/lifecycle、gsh、friendBinding、federation/room。
 */
import { randomUUID } from 'node:crypto'

import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { resolveActiveMemberKeyForLocalUser } from '../../group/access.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { createGroup } from '../dag/lifecycle.mjs'
import { getLocalSignerForNewGroup } from '../dag/localSigner.mjs'
import { getState, rebuildAndSaveCheckpoint } from '../dag/materialize.mjs'
import { setFederationBootstrap } from '../federation/bootstrapStore.mjs'
import { getFederationSettings } from '../federation/config.mjs'
import { catchUpGroupFromPeers } from '../federation/index.mjs'
import { ensureFederationRoom, invalidateFederationRoomCache } from '../federation/room.mjs'
import { buildFileKeyGrant } from '../file_keys/historicalGrant.mjs'
import { initGroupFileMasterKey, getCurrentFileMasterKey } from '../file_keys/store.mjs'
import { buildUserFriendBinding } from '../lib/friendBinding.mjs'
import { consumeGroupInviteTicket } from '../lib/inviteTickets.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'

import { computeDmRoomLabelFromPubKeys } from './labels.mjs'
import { validateDmIntroLinkProof } from './linkValidate.mjs'

/**
 * 按 `group_meta_update` 中的 `dmSessionTag` 查找已有 ECDH DM 群。
 * @param {string} username 用户
 * @param {string} dmSessionTag 会话标签
 * @returns {Promise<{ groupId: string, defaultChannelId: string } | null>} 已有群或 null
 */
export async function findDmGroupBySessionTag(username, dmSessionTag) {
	const tag = dmSessionTag?.trim().toLowerCase()
	if (!tag) return null
	for (const groupId of await listUserGroups(username)) {
		const { state } = await getState(username, groupId)
		const meta = state.groupMeta
		if (meta.dmKind === 'ecdh' && meta.dmSessionTag?.toLowerCase() === tag)
			return {
				groupId,
				defaultChannelId: state.groupSettings?.defaultChannelId || 'default',
			}
	}

	return null
}

/**
 * 创建 ECDH 双人 DM 群并写入元数据（§14）。
 * @param {string} username 当前用户
 * @param {string} myPubKeyHex 本端公钥
 * @param {string} peerPubKeyHex 对端公钥
 * @returns {Promise<{ groupId: string, defaultChannelId: string, dmSessionTag: string }>} 新建或已存在的 DM 群
 */
export async function createEcdhDmGroup(username, myPubKeyHex, peerPubKeyHex) {
	const myPubKey = normalizePubKeyHex(myPubKeyHex)
	const peerPubKey = normalizePubKeyHex(peerPubKeyHex)
	if (!PUB_KEY_HEX_64.test(myPubKey) || !PUB_KEY_HEX_64.test(peerPubKey))
		throw new Error('invalid pub keys for DM')
	if (myPubKey === peerPubKey) throw new Error('peer pub key must differ from mine')

	const { low, high, dmSessionTag, dmRoomLabelPrefix } = computeDmRoomLabelFromPubKeys(myPubKey, peerPubKey)
	const existing = await findDmGroupBySessionTag(username, dmSessionTag)
	if (existing) return { ...existing, dmSessionTag }

	const plannedGroupId = randomUUID()
	const { sender: ownerPubKeyHash, secretKey } = await getLocalSignerForNewGroup(username, plannedGroupId)
	const result = await createGroup(username, {
		groupId: plannedGroupId,
		name: `DM · ${dmRoomLabelPrefix}`,
		description: 'Direct message',
		ownerPubKeyHash,
		secretKey,
		enableGroupFederation: true,
	})
	const {groupId} = result
	await initGroupFileMasterKey(username, groupId)
	// 仿 session/crud.mjs newMetadata：建群后这两条 DAG 事件跳过逐条重型 checkpoint 与联邦发布，
	// 末尾统一做一次 rebuildAndSaveCheckpoint，避免 DM 建群放大成多次 checkpoint 阻塞写路径。
	const batchOpts = { skipCheckpointRebuild: true, skipReleaseQuarantined: true, publishFederation: false }
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_meta_update',
		timestamp: Date.now(),
		content: {
			dmKind: 'ecdh',
			dmSessionTag,
			dmRoomLabelPrefix,
			dmPubKeyLow: low,
			dmPubKeyHigh: high,
			dmPeerPubKeyHex: peerPubKey,
			dmMyPubKeyHex: myPubKey,
			friendBinding: buildUserFriendBinding({
				pubKeyHex: peerPubKey,
				displayName: `DM · ${dmRoomLabelPrefix}`,
			}),
		},
	}, batchOpts)

	const keyEntry = await getCurrentFileMasterKey(username, groupId)
	if (keyEntry?.fileMasterKey) {
		const fileKeyWraps = await buildFileKeyGrant(username, groupId, peerPubKey)
		await appendSignedLocalEvent(username, groupId, {
			type: 'peer_invite',
			timestamp: Date.now(),
			content: {
				from: ownerPubKeyHash,
				to: peerPubKey,
				fileKeyWraps,
			},
		}, batchOpts)
	}

	await rebuildAndSaveCheckpoint(username, groupId, { skipChannelGc: true })

	invalidateFederationRoomCache(username, groupId)
	void ensureFederationRoom(username, groupId).catch(error => console.error('DM federation bind:', error))

	return {
		groupId,
		defaultChannelId: result.defaultChannelId,
		dmSessionTag,
	}
}

/**
 * ECDH 双人 DM：第二成员入群后双方均为 admin。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {object} [state] 已物化 state（省略则重新加载）
 * @returns {Promise<void>}
 */
export async function maybeAssignEcdhDmAdmin(username, groupId, state) {
	const materialized = state ?? (await getState(username, groupId)).state
	if (materialized.groupMeta?.dmKind !== 'ecdh') return
	const activeUsers = Object.values(materialized.members)
		.filter(member => member?.status === 'active' && member.memberKind !== 'agent')
	if (activeUsers.length !== 2) return
	const joinerKey = await resolveActiveMemberKeyForLocalUser(username, groupId, materialized)
	if (!joinerKey) return
	const joiner = materialized.members[joinerKey]
	if ((joiner.roles || []).includes('admin')) return
	await appendSignedLocalEvent(username, groupId, {
		type: 'role_assign',
		timestamp: Date.now(),
		content: { targetMemberKey: joinerKey, roleId: 'admin' },
	})
}

/**
 * §16 First Contact：验签 DM 深链并按字典序发起或加入已有 DM。
 * @param {string} username 当前节点用户
 * @param {string} introPubKeyHex 介绍者公钥 hex
 * @param {string} dmIntroNonce nonce
 * @param {string} dmIntroSignatureHex 签名 hex
 * @returns {Promise<{ groupId: string, defaultChannelId: string, created: boolean }>} 打开/新建的 DM
 */
export async function orchestrateDmFirstContact(username, introPubKeyHex, dmIntroNonce, dmIntroSignatureHex) {
	const introPubKey = normalizePubKeyHex(introPubKeyHex)
	const nonce = dmIntroNonce?.trim()
	const signatureHex = dmIntroSignatureHex?.trim().replace(/^0x/iu, '')
	if (!PUB_KEY_HEX_64.test(introPubKey)) throw new Error('invalid intro pubKeyHex')
	if (nonce.length < 16) throw new Error('invalid dmIntro nonce')
	if (!/^[\da-f]{128}$/iu.test(signatureHex)) throw new Error('invalid dmIntro signature')

	const dmCheck = await validateDmIntroLinkProof(username, { members: {} }, introPubKey, nonce, signatureHex)
	if (!dmCheck.ok) throw new Error(dmCheck.error)

	const { identityPubKeyHex: myPubKey } = await getFederationSettings(username)
	if (!PUB_KEY_HEX_64.test(myPubKey))
		throw new Error('configure identityPubKeyHex in federation settings before opening DM links')

	const myPubKeyNormalized = normalizePubKeyHex(myPubKey)
	const { dmSessionTag } = computeDmRoomLabelFromPubKeys(myPubKeyNormalized, introPubKey)
	const existing = await findDmGroupBySessionTag(username, dmSessionTag)
	if (existing) {
		const { state } = await getState(username, existing.groupId)
		if (!await resolveActiveMemberKeyForLocalUser(username, existing.groupId, state))
			await appendSignedLocalEvent(username, existing.groupId, {
				type: 'member_join',
				timestamp: Date.now(),
				content: {
					dmIntroNonce: nonce,
					dmIntroSignatureHex: signatureHex,
					pubKeyHex: myPubKeyNormalized,
				},
			})
		const { state: afterJoin } = await getState(username, existing.groupId)
		await maybeAssignEcdhDmAdmin(username, existing.groupId, afterJoin)

		return {
			groupId: existing.groupId,
			defaultChannelId: existing.defaultChannelId,
			created: false,
		}
	}

	if (myPubKeyNormalized >= introPubKey)
		throw new Error('DM group not created yet; ask the other party (lower pubKey) to open the link first')

	const created = await createEcdhDmGroup(username, myPubKeyNormalized, introPubKey)
	return {
		groupId: created.groupId,
		defaultChannelId: created.defaultChannelId,
		created: true,
	}
}

/**
 * §16 入群深链：消费邀请码并 `member_join`。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [inviteCode] 邀请码
 * @param {{ mqttAppId?: string, mqttRoomSecret?: string }} [fedBootstrap] 首次联邦 MQTT 口令
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>} 入群后的群信息
 */
export async function orchestrateJoinGroup(username, groupId, inviteCode = '', fedBootstrap = {}) {
	if (!groupId?.trim()) throw new Error('groupId required')

	if (fedBootstrap.mqttRoomSecret)
		setFederationBootstrap(username, groupId, fedBootstrap)

	const inviteCodeTrimmed = inviteCode.trim()
	if (inviteCodeTrimmed && !await consumeGroupInviteTicket(username, groupId, inviteCodeTrimmed))
		throw new Error('invalid or expired inviteCode')

	const { state } = await getState(username, groupId)
	if (await resolveActiveMemberKeyForLocalUser(username, groupId, state)) {
		const defaultChannelId = state.groupSettings?.defaultChannelId || 'default'
		return { groupId, defaultChannelId }
	}

	await appendSignedLocalEvent(username, groupId, {
		type: 'member_join',
		timestamp: Date.now(),
		content: inviteCodeTrimmed ? { inviteCode: inviteCodeTrimmed } : {},
	})
	const { state: afterJoin } = await getState(username, groupId)
	await maybeAssignEcdhDmAdmin(username, groupId, afterJoin)
	const defaultChannelId = afterJoin.groupSettings?.defaultChannelId || 'default'
	void catchUpGroupFromPeers(username, groupId).catch(console.error)
	return { groupId, defaultChannelId }
}
