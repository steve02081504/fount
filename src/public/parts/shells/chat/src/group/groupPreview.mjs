/**
 * 非成员群预览：本地 state → discovery 索引 → 联邦 fed_group_card_want。
 */
import { getState } from '../chat/dag/materialize.mjs'
import { loadDiscoveryIndex } from '../chat/discovery/index.mjs'
import { requestGroupCardFromPeers } from '../chat/federation/groupCardFederation.mjs'
import { ensureFederationRoom } from '../chat/federation/room.mjs'

import { resolveActiveMemberKeyForLocalUser } from './access.mjs'
import { assembleGroupPreviewCard } from './groupPreviewCard.mjs'

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

	const hasLocalText = Boolean(
		state?.groupMeta?.name || state?.groupSettings?.discoveryTitle
		|| state?.groupMeta?.description || state?.groupSettings?.discoveryBlurb,
	)

	let discoveryEntry = null
	if (!hasLocalText) {
		const index = await loadDiscoveryIndex(username)
		discoveryEntry = index.entries.find(e => e.groupId === groupId) || null
	}

	let remote = null
	if (!hasLocalText && !discoveryEntry) {
		const slot = await ensureFederationRoom(username, groupId).catch(() => null)
		remote = slot ? await requestGroupCardFromPeers(username, groupId, slot) : null
	}

	return assembleGroupPreviewCard({ groupId, state, discoveryEntry, remote, memberKey })
}
