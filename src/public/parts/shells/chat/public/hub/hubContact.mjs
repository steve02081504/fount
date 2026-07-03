/**
 * Hub 落地页 `?contact=<entityHash>`（Social「私信」等入口）。
 */
import { entityHashLabel, isEntityHash128 } from '../shared/entityHash.mjs'
import { buildCharFriendBinding, buildUserFriendBinding } from '../shared/friendBinding.mjs'

import { hubStore } from './core/state.mjs'
import { charAgentEntityHash } from './entityResolve.mjs'
import { enterFriendChat } from './friendChat.mjs'
import { loadFriendsList } from './friendsList.mjs'
import { setMode } from './mode.mjs'
import { showProfilePopup } from './profilePopup.mjs'
import { loadGroups } from './serverBar.mjs'

/**
 * @param {string} contactRaw 查询参数 `contact`
 * @returns {Promise<boolean>} 是否已处理（含打开资料卡）
 */
export async function applyHubContactQuery(contactRaw) {
	const entityHash = String(contactRaw || '').trim().toLowerCase()
	if (!isEntityHash128(entityHash)) return false

	await loadGroups()
	const bound = hubStore.sidebar.groups.find(g => g.friendBinding?.entityHash === entityHash)?.friendBinding
	if (bound) {
		await setMode('friends')
		await enterFriendChat({ binding: bound })
		return true
	}

	const { nodeHash } = hubStore
	if (nodeHash) {
		const friends = await loadFriendsList()
		for (const friend of friends) {
			if (!friend.charname) continue
			const hash = await charAgentEntityHash(friend.charname)
			if (hash !== entityHash) continue
			await setMode('friends')
			await enterFriendChat({
				binding: await buildCharFriendBinding(nodeHash, friend.charname, friend.displayName),
			})
			return true
		}
	}

	try {
		const binding = await buildUserFriendBinding({ entityHash })
		const existing = hubStore.sidebar.groups.find(g => g.friendBinding?.entityHash === binding.entityHash)
		if (existing?.groupId) {
			await setMode('friends')
			await enterFriendChat({ groupId: existing.groupId, binding: existing.friendBinding || binding })
			return true
		}
	}
	catch { /* 无已有群则展示资料卡 */ }

	await setMode('friends')
	void showProfilePopup({
		entityHash,
		charname: null,
		pubKeyHex: null,
		pubKeyHash: null,
		displayName: entityHashLabel(entityHash),
	})
	return true
}
