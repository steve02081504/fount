/**
 * 非成员群预览：本地 state → discovery 索引 → 联邦 fed_group_card_want。
 */
import { resolveActiveMemberKeyForLocalUser } from '../access.mjs'
import { getState } from '../chat/dag/materialize.mjs'
import { loadDiscoveryIndex } from '../chat/discovery/index.mjs'
import { requestGroupCardFromPeers } from '../chat/federation/groupCardFederation.mjs'
import { ensureFederationRoom } from '../chat/federation/room.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 群预览卡片
 */
export async function buildGroupPreview(username, groupId) {
	let state = null
	try {
		const materialized = await getState(username, groupId)
		state = materialized.state
	}
	catch { /* 无本地 replica */ }

	const memberKey = state
		? await resolveActiveMemberKeyForLocalUser(username, groupId, state).catch(() => null)
		: null
	const isMember = Boolean(memberKey)
	const joinPolicy = state?.groupSettings?.joinPolicy || 'invite-only'
	const discoveryPublic = Boolean(state?.groupSettings?.discoveryPublic)

	let title = state?.groupMeta?.name || state?.groupSettings?.discoveryTitle || ''
	let blurb = state?.groupMeta?.description || state?.groupSettings?.discoveryBlurb || ''
	let found = Boolean(title || blurb)

	if (!found) {
		const index = await loadDiscoveryIndex(username)
		const entry = index.entries.find(e => e.groupId === groupId)
		if (entry) {
			title = entry.title || title
			blurb = entry.blurb || blurb
			found = true
		}
	}

	if (!found) {
		const slot = await ensureFederationRoom(username, groupId).catch(() => null)
		const remote = slot ? await requestGroupCardFromPeers(username, groupId, slot) : null
		if (remote) {
			title = remote.title || title
			blurb = remote.blurb || blurb
			found = true
		}
	}

	const canJoin = !isMember && (discoveryPublic || joinPolicy === 'open' || joinPolicy === 'pow')

	return {
		groupId,
		title: title || groupId,
		blurb: blurb || '',
		icon: null,
		joinPolicy,
		isMember,
		canJoin,
		hubUrl: `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:default`,
		found,
	}
}
