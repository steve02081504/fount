/**
 * 【文件】public/src/deepLinkConsume.mjs
 * 【职责】消费 fount://run 与 ?invite= 深链：入群、建 DM、跳转 Social 资料、暂存待处理邀请。
 */

import { formatSocialPostHref, formatSocialProfileHref, parseSocialRunUri } from '/parts/shells:social/shared/runUri.mjs'


import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { parseDmRunUri, parseJoinRunUri, parseMessageRunUri } from '../shared/runUri.mjs'

import { getFederationSettings } from './api/federationSettings.mjs'
import { getGroupState, joinGroup } from './api/groupCore.mjs'
import { createDirectMessageByPubKeys } from './api/groupDm.mjs'
import { broadcastHubGroupJoined } from './hubBroadcast.mjs'
import { PENDING_INVITE_STORAGE_KEY } from './pendingInviteStorage.mjs'
import { resolvePowForJoin } from './powJoin.mjs'

/**
 * 从当前页 query 解析 `fount://run/…` 深链（`run` 参数）。
 * @param {string} [search] 可选 search 串；默认当前页
 * @returns {string | null} 规范化后的 run URI，无则 `null`
 */
export function runUriFromPageLocation(search = window.location.search) {
	const runUri = new URLSearchParams(search).get('run')?.trim()
		|| new URLSearchParams(search).get('url')?.trim()
	return runUri?.startsWith('fount://') ? runUri : null
}

/**
 * 解析并执行 run 深链：Chat DM/join/message 或跳转 Social 资料/帖子页。
 * @param {string} raw `fount://run/…` 完整 URI
 * @returns {Promise<{ kind: 'dm' | 'join' | 'social-profile' | 'social-post' | 'message', groupId?: string, channelId?: string, eventId?: string } | null>} 成功载荷；无法识别为 `null`
 */
export async function applyChatRunUri(raw) {
	const social = parseSocialRunUri(raw)
	if (social?.subcommand === 'post' && social.entityHash && social.postId) {
		window.location.href = formatSocialPostHref(social.entityHash, social.postId, social.sharerNodeHash)
		return { kind: 'social-post' }
	}
	if (social?.subcommand === 'profile' && social.entityHash) {
		window.location.href = formatSocialProfileHref(social.entityHash, social.postId)
		return { kind: 'social-profile' }
	}

	const message = parseMessageRunUri(raw)
	if (message) 
		return {
			kind: 'message',
			groupId: message.groupId,
			channelId: message.channelId,
			eventId: message.eventId,
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
		const viewerResp = await fetch('/api/parts/shells:chat/viewer', { credentials: 'include' }).catch(() => null)
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
		broadcastHubGroupJoined(join.groupId)
		return { kind: 'join', groupId: join.groupId, channelId: 'default' }
	}

	return null
}
