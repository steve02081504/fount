/**
 * Hub 落地页 `?contact=<entityHash>`（Social「私信」等入口）。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { entityHashLabel, isEntityHash128 } from '../shared/entityHash.mjs'
import { charFriendBindingInput, buildUserFriendBinding } from '../shared/friendBinding.mjs'
import { cachedProfileFromApi, getEntityProfile } from '../src/endpoints/entities.mjs'

import { store } from './core/state.mjs'
import { charAgentEntityHash } from './entityResolve.mjs'
import { dispatchFriendChat, enterFriendChat } from './friendChat.mjs'
import { loadFriendsList } from './friendsList.mjs'
import { setMode } from './mode.mjs'
import { showProfilePopup } from './profilePopup.mjs'
import { loadGroups } from './serverBar.mjs'

/**
 * @param {string} contactRaw 查询参数 `contact`
 * @returns {Promise<boolean>} 是否已处理（含打开资料卡）
 */
export async function applyHubContactQuery(contactRaw) {
	if (!isEntityHash128(contactRaw)) return false

	await loadGroups()
	// 只有自己一人的 DM（对端还没入群）不在这里短路：交给下面的 dispatchFriendChat 复用同一个群
	// 并重新投递邀请，否则重新打开链接永远补不上那一侧。
	const boundGroup = store.sidebar.groups.find(g => g.friendBinding?.entityHash === contactRaw)
	if (boundGroup?.friendBinding && boundGroup.memberCount !== 1) {
		await setMode('friends')
		await enterFriendChat({ groupId: boundGroup.groupId, binding: boundGroup.friendBinding })
		return true
	}

	if (store.viewer.nodeHash) {
		const friends = await loadFriendsList()
		for (const friend of friends) {
			if (!friend.charname) continue
			const hash = await charAgentEntityHash(friend.charname)
			if (hash !== contactRaw) continue
			await setMode('friends')
			await enterFriendChat({
				binding: charFriendBindingInput(friend.charname, friend.displayName),
			})
			return true
		}
	}

	try {
		const binding = await buildUserFriendBinding({ entityHash: contactRaw })
		const existing = store.sidebar.groups.find(g => g.friendBinding?.entityHash === binding.entityHash)
		if (existing?.groupId && existing.memberCount !== 1) {
			await setMode('friends')
			await enterFriendChat({ groupId: existing.groupId, binding: existing.friendBinding || binding })
			return true
		}
	}
	catch { /* 无已有群则继续 */ }

	await setMode('friends')
	const profile = await getEntityProfile(contactRaw)
		.then(data => data?.profile ? cachedProfileFromApi(data.profile, contactRaw) : null)
		.catch(() => null)
	const pubKeyHex = profile?.activePubKeyHex || ''
	const displayName = profile?.name || entityHashLabel(contactRaw)

	// 已能解析对端活跃钥时直接进私信（对齐 Social「私信」语义）
	if (isHex64(pubKeyHex)) {
		await dispatchFriendChat({
			type: 'user',
			entityHash: contactRaw,
			pubKeyHex,
			displayName,
		})
		return true
	}

	await showProfilePopup({
		entityHash: contactRaw,
		charname: null,
		pubKeyHex: isHex64(pubKeyHex),
		pubKeyHash: null,
		displayName,
	})
	return true
}
