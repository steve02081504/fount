/**
 * 【文件】public/src/deepLinkConsume.mjs
 * 【职责】消费 fount://run 与 ?invite= 深链：入群、建 DM、跳转 Social 资料、暂存待处理邀请。
 */

import { formatSocialProfileHref, parseSocialRunUri } from '/parts/shells:chat/shared/socialRunUri.mjs'


import { isHex64 } from '../shared/pubKeyHex.mjs'
import { parseDmRunUri, parseJoinRunUri } from '../shared/runUri.mjs'

import { createDirectMessageByPubKeys, getFederationSettings, getGroupState, joinGroup } from './api/groupApi.mjs'
import { notifyHubGroupJoined } from './hubBroadcast.mjs'
import { PENDING_INVITE_STORAGE_KEY } from './pendingInviteStorage.mjs'
import { resolvePowForJoin } from './powJoin.mjs'

/**
 * 从当前页 query 解析 `fount://run/…` 深链（`run` 参数）。
 * @returns {string | null} 规范化后的 run URI，无则 `null`
 */
export function runUriFromPageLocation() {
	const runUri = new URLSearchParams(window.location.search).get('run')?.trim()
	return runUri?.startsWith('fount://') ? runUri : null
}

/**
 * 解析并执行 run 深链：Chat DM/join 或跳转 Social 资料页。
 * @param {string} raw `fount://run/…` 完整 URI
 * @returns {Promise<{ kind: 'dm' | 'join' | 'social-profile', groupId?: string, channelId?: string } | null>} 成功载荷；无法识别为 `null`
 */
export async function applyChatRunUri(raw) {
	const social = parseSocialRunUri(raw)
	if (social?.subcommand === 'profile' && social.entityHash) {
		window.location.href = formatSocialProfileHref(social.entityHash, social.postId)
		return { kind: 'social-profile' }
	}

	const dm = parseDmRunUri(raw)
	if (dm) {
		const { activePubKeyHex } = await getFederationSettings()
		if (!isHex64(activePubKeyHex))
			throw new Error('configure activePubKeyHex in federation settings first')
		const data = await createDirectMessageByPubKeys(activePubKeyHex, dm.pubKeyHex, {
			dmIntroNonce: dm.nonce,
			dmIntroSignatureHex: dm.introSignatureHex,
		})
		return {
			kind: 'dm',
			groupId: data.groupId,
			channelId: data.defaultChannelId || 'default',
		}
	}

	const join = parseJoinRunUri(raw)
	if (join) {
		const groupState = await getGroupState(join.groupId).catch(() => null)
		const viewerResp = await fetch('/api/p2p/viewer', { credentials: 'include' }).catch(() => null)
		const viewer = viewerResp?.ok ? await viewerResp.json() : {}
		const pow = await resolvePowForJoin(join.groupId, groupState, viewer.nodeHash || '')
		await joinGroup(join.groupId, join.inviteCode, null, pow,
			join.roomSecret || join.introducerPubKeyHash || join.introducerNodeHash
				? {
					...join.roomSecret && { roomSecret: join.roomSecret },
					...join.introducerPubKeyHash && { introducerPubKeyHash: join.introducerPubKeyHash },
					...join.introducerNodeHash && { introducerNodeHash: join.introducerNodeHash },
				}
				: null)
		sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY)
		notifyHubGroupJoined(join.groupId)
		return { kind: 'join', groupId: join.groupId, channelId: 'default' }
	}

	return null
}
