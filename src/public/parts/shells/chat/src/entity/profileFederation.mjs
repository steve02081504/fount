/**
 * 【文件】src/entity/profileFederation.mjs
 * 【职责】跨节点 profile 更新传播：node-scope `profile_update` 接收端。
 * 收到广播后强制 revalidate 拉取该实体 profile 落盘，并刷新本地已缓存的头像/背景 manifest，
 * 再向本机包含该实体的群 WS 广播 `profile_update` 事件，触发前端重绘（头像/背景/资料卡）。
 * 【原理】发送端见 `profile.mjs` 的 `notifyProfileUpdated`；接收端复用
 * `fetchAndCacheRemoteProfile({ revalidate: true })`（fount-p2p 0.0.40 起阻塞等 fanout 取新）。
 */
import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getEntityStore } from 'npm:@steve02081504/fount-p2p/node/instance'
import { registerNodeScopeWireHook } from 'npm:@steve02081504/fount-p2p/transport/node_scope/wire'

import { fetchAndCacheRemoteProfile } from './profile.mjs'

/** profile 媒体 EVFS 逻辑路径（头像/背景，含 SFW 变体）。 */
const PROFILE_MEDIA_PATHS = ['profile/avatar', 'profile/banner', 'profile/sfw_avatar', 'profile/sfw_banner']

/** @type {(() => void) | null} */
let unregisterHook = null

/**
 * 对已缓存过旧 manifest 的 profile 媒体文件做 revalidate（有旧缓存才需要；冷路径由前端按需拉最新）。
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
async function revalidateProfileMedia(username, entityHash) {
	const { readPublicFile } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	const store = getEntityStore()
	const ownerNode = parseEntityHash(entityHash)?.nodeHash
	await Promise.all(PROFILE_MEDIA_PATHS.map(async (logicalPath) => {
		if (!await store.statManifest(entityHash, logicalPath)) return
		await readPublicFile(username, entityHash, logicalPath, {
			revalidate: true,
			...ownerNode ? { fanoutTargets: [ownerNode] } : {},
		}).catch(() => { })
	}))
}

/**
 * 向本机已加入群中、成员含该实体的群 WS 房间广播 profile_update（供前端即时刷新）。
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
async function broadcastProfileUpdateToMemberGroups(username, entityHash) {
	const { listUserGroups } = await import('../chat/lib/userGroups.mjs')
	const { getState } = await import('../chat/dag/materialize.mjs')
	const { broadcastEvent } = await import('../chat/ws/groupWsBroadcast.mjs')
	for (const groupId of await listUserGroups(username)) 
		try {
			const { state } = await getState(username, groupId, { skipLeftPurge: true })
			const inGroup = Object.values(state?.members || {})
				.some(member => String(member?.entityHash || '') === entityHash)
			if (inGroup) broadcastEvent(groupId, { type: 'profile_update', entityHash })
		}
		catch { /* 非成员 / 物化失败跳过 */ }
	
}

/**
 * 处理入站 profile_update：校验 → 强刷 profile.json 落盘 → 刷新媒体 manifest → 群 WS 广播。
 * @param {string} username replica
 * @param {unknown} payload node-scope 载荷
 * @returns {Promise<void>}
 */
async function handleProfileUpdate(username, payload) {
	const entityHash = String(payload?.entityHash || '')
	if (!isEntityHash128(entityHash)) return
	// 每实体限速：防恶意节点高频触发 revalidate fanout（60s 令牌桶，与 fed_emoji_want 同线）。
	const { consumeWireRateBucket } = await import('npm:@steve02081504/fount-p2p/wire/rate_bucket')
	if (!consumeWireRateBucket(`profile_update:${entityHash}`, { maxCount: 6 })) return
	await fetchAndCacheRemoteProfile(username, entityHash, { revalidate: true }).catch(() => { })
	await revalidateProfileMedia(username, entityHash).catch(() => { })
	await broadcastProfileUpdateToMemberGroups(username, entityHash).catch(() => { })
}

/**
 * 在 node scope wire 上注册 `profile_update` 接收端（chat part Load 时调用）。
 * @returns {void}
 */
export function registerChatProfileUpdateHandler() {
	if (unregisterHook) return
	unregisterHook = registerNodeScopeWireHook((context, wire) => {
		wire.on('profile_update', (payload) => {
			void handleProfileUpdate(context.replicaUsername, payload).catch(error => {
				console.warn('profile federation: profile_update handling failed', error)
			})
		})
	})
}

/**
 * 注销 `profile_update` 接收端（chat part Unload 时调用）。
 * @returns {void}
 */
export function unregisterChatProfileUpdateHandler() {
	unregisterHook?.()
	unregisterHook = null
}
