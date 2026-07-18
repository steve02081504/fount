import { buildConversationContext } from '../chat/lib/conversationContext.mjs'
import { enumerateJoinedFederatedGroups } from '../group/queries.mjs'

import { createGroup as hydrateGroup } from './group.mjs'
import { peerPubKeyFromEntityHash } from './internal.mjs'
import { createMessage } from './message.mjs'

/**
 * 实体 shell JSON 私有态命名空间（load/assign 样板）。
 * @param {import('./internal.mjs').ChatApiContext} apiContext API 上下文
 * @param {string} dataName setting 名
 * @param {(stored: object) => object} shape 读出规范化；set 时写入该对象
 * @returns {{ list: Function, set: Function }} list/set 命名空间
 */
function createEntityShellJsonNamespace(apiContext, dataName, shape) {
	return {
		/**
		 * @returns {Promise<object>} 读出
		 */
		async list() {
			const { loadEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
			return shape(loadEntityShellData(apiContext.username, 'chat', apiContext.entityHash, dataName) || {})
		},
		/**
		 * @param {object} value 写入值（已是最终 shape）
		 * @returns {Promise<object>} 写入后的值
		 */
		async set(value) {
			const { assignEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
			const next = shape(value || {})
			assignEntityShellData(apiContext.username, 'chat', apiContext.entityHash, dataName, next)
			return next
		},
	}
}

/**
 * @param {import('./internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} ChatClient 鸭子类型
 */
export function createChatClient(apiContext) {
	return {
		entityHash: apiContext.entityHash,
		/**
		 * @returns {Promise<object[]>} 已加入群列表
		 */
		async groups() {
			const rows = await enumerateJoinedFederatedGroups(apiContext.username, apiContext.entityHash)
			return Promise.all(rows.map(async row => {
				const { group } = await buildConversationContext(apiContext.username, row.groupId, row.defaultChannelId || 'default')
				return hydrateGroup(apiContext, row.groupId, group)
			}))
		},
		/**
		 * @returns {{ list: Function, set: Function }} 书签
		 */
		get bookmarks() {
			const ns = createEntityShellJsonNamespace(apiContext, 'bookmarks', stored => ({
				entries: Array.isArray(stored.entries) ? stored.entries : [],
			}))
			return {
				/**
				 * @returns {Promise<{ entries: object[] }>} 书签列表
				 */
				list: () => ns.list(),
				/**
				 * @param {object[]} entries 书签条目
				 * @returns {Promise<{ entries: object[] }>} 写入后的列表
				 */
				async set(entries) {
					return ns.set({ entries: Array.isArray(entries) ? entries : [] })
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 群文件夹
		 */
		get groupFolders() {
			const ns = createEntityShellJsonNamespace(apiContext, 'groupFolders', stored => ({
				folders: Array.isArray(stored.folders) ? stored.folders : [],
			}))
			return {
				/**
				 * @returns {Promise<{ folders: object[] }>} 文件夹列表
				 */
				list: () => ns.list(),
				/**
				 * @param {object[]} folders 文件夹
				 * @returns {Promise<{ folders: object[] }>} 写入后的列表
				 */
				async set(folders) {
					return ns.set({ folders: Array.isArray(folders) ? folders : [] })
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 实体/群别名
		 */
		get aliases() {
			return createEntityShellJsonNamespace(apiContext, 'aliases', stored => ({
				entities: stored.entities || {},
				groups: stored.groups || {},
			}))
		},
		/**
		 * @returns {Promise<Record<string, Record<string, { eventId: string, seq: number }>>>} 全量已读水位
		 */
		async readMarkers() {
			const { loadReadMarkers } = await import('../chat/lib/readMarkers.mjs')
			return loadReadMarkers(apiContext.username, apiContext.entityHash)
		},
		/**
		 * @returns {{ get: Function, set: Function }} 通知偏好
		 */
		get notifications() {
			return {
				/**
				 * @returns {Promise<Record<string, object>>} 整档偏好
				 */
				async get() {
					const { loadNotificationPreferences } = await import('../chat/lib/notificationPreferences.mjs')
					return loadNotificationPreferences(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {Record<string, object>} prefs 整档偏好
				 * @returns {Promise<Record<string, object>>} 写入后的偏好
				 */
				async set(prefs) {
					const { saveNotificationPreferences, loadNotificationPreferences } = await import('../chat/lib/notificationPreferences.mjs')
					saveNotificationPreferences(apiContext.username, apiContext.entityHash, prefs || {})
					return loadNotificationPreferences(apiContext.username, apiContext.entityHash)
				},
			}
		},
		/**
		 * @returns {{ list: Function, seenAt: Function, setSeenAt: Function }} inbox
		 */
		get inbox() {
			return {
				/**
				 * @param {{ limit?: number, cursor?: string, kinds?: string[] }} [options] 分页
				 * @returns {Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>} 分页结果
				 */
				async list(options = {}) {
					const { listChatInbox } = await import('../chat/lib/inbox.mjs')
					const { getState } = await import('../chat/dag/materialize.mjs')
					const page = await listChatInbox(apiContext.username, apiContext.entityHash, options)
					/** @type {Map<string, object>} */
					const stateCache = new Map()
					const items = await Promise.all(page.items.map(async row => {
						let state = stateCache.get(row.groupId)
						if (!state) {
							state = (await getState(apiContext.username, row.groupId)).state
							stateCache.set(row.groupId, state)
						}
						return {
							...row,
							groupName: state.groupMeta?.name || row.groupId,
							channelName: state.channels?.[row.channelId]?.name || row.channelId,
						}
					}))
					return { items, nextCursor: page.nextCursor, unreadCount: page.unreadCount }
				},
				/**
				 * @returns {Promise<number>} 已读水位毫秒
				 */
				async seenAt() {
					const { getChatInboxSeenAt } = await import('../chat/lib/inbox.mjs')
					return getChatInboxSeenAt(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {number} [at] 已读水位毫秒
				 * @returns {Promise<number>} 写入的 seenAt
				 */
				async setSeenAt(at = Date.now()) {
					const { setChatInboxSeenAt } = await import('../chat/lib/inbox.mjs')
					const seenAt = Number(at) || Date.now()
					setChatInboxSeenAt(apiContext.username, apiContext.entityHash, seenAt)
					return seenAt
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function, save: Function, frequent: Function, record: Function }} 自定义表情与用量
		 */
		get emojis() {
			const customEmojis = createEntityShellJsonNamespace(apiContext, 'customEmojis', stored => ({
				entries: Array.isArray(stored.entries) ? stored.entries : Array.isArray(stored) ? stored : [],
			}))
			return {
				/**
				 * @returns {Promise<{ entries: object[] }>} 自定义表情
				 */
				list: () => customEmojis.list(),
				/**
				 * @param {object[]} entries 表情条目
				 * @returns {Promise<{ entries: object[] }>} 写入后的列表
				 */
				async set(entries) {
					return customEmojis.set({ entries: Array.isArray(entries) ? entries : [] })
				},
				/**
				 * @param {{ groupId: string, emojiId: string, dataUrl: string }} fields 保存字段
				 * @returns {Promise<{ entry: object }>} 新条目
				 */
				async save({ groupId, emojiId, dataUrl }) {
					const { loadEntityShellData, assignEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					const gid = String(groupId || '').trim()
					const eid = String(emojiId || '').trim()
					const url = String(dataUrl || '').trim()
					if (!gid || !eid) throw new Error('groupId and emojiId required')
					if (!url.startsWith('data:')) throw new Error('dataUrl required (data:…)')
					const entries = [...loadEntityShellData(apiContext.username, 'chat', apiContext.entityHash, 'customEmojis').entries || []]
					const id = `${gid}/${eid}`
					const next = { id, groupId: gid, emojiId: eid, dataUrl: url, savedAt: Date.now() }
					const existingIndex = entries.findIndex(entry => entry?.id === id)
					if (existingIndex >= 0) entries[existingIndex] = next
					else entries.push(next)
					assignEntityShellData(apiContext.username, 'chat', apiContext.entityHash, 'customEmojis', { entries })
					return { entry: next }
				},
				/**
				 * @param {number} [limit] 条数上限
				 * @returns {Promise<object[]>} 常用表情
				 */
				async frequent(limit = 32) {
					const { listFrequentEmojis } = await import('../emojiUsage.mjs')
					return listFrequentEmojis(apiContext.username, apiContext.entityHash, limit)
				},
				/**
				 * @param {{ kind: string, unicode?: string, groupId?: string, emojiId?: string }} item 表情
				 * @returns {Promise<void>}
				 */
				async record(item) {
					const { recordEmojiUsage } = await import('../emojiUsage.mjs')
					recordEmojiUsage(apiContext.username, apiContext.entityHash, item)
				},
			}
		},
		/**
		 * @returns {{ get: Function, install: Function, uninstall: Function, addFavorite: Function, removeFavorite: Function, recordRecent: Function }} 贴纸收藏
		 */
		get stickers() {
			return {
				/**
				 * @returns {Promise<object>} 贴纸收藏
				 */
				async get() {
					const { getUserCollection } = await import('../stickers/stickers.mjs')
					return getUserCollection(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {string} packId 包 id
				 * @returns {Promise<void>}
				 */
				async install(packId) {
					const { installPack } = await import('../stickers/stickers.mjs')
					await installPack(apiContext.username, apiContext.entityHash, packId)
				},
				/**
				 * @param {string} packId 包 id
				 * @returns {Promise<void>}
				 */
				async uninstall(packId) {
					const { uninstallPack } = await import('../stickers/stickers.mjs')
					await uninstallPack(apiContext.username, apiContext.entityHash, packId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async addFavorite(stickerId) {
					const { addToFavorites } = await import('../stickers/stickers.mjs')
					await addToFavorites(apiContext.username, apiContext.entityHash, stickerId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async removeFavorite(stickerId) {
					const { removeFromFavorites } = await import('../stickers/stickers.mjs')
					await removeFromFavorites(apiContext.username, apiContext.entityHash, stickerId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async recordRecent(stickerId) {
					const { recordRecentUse } = await import('../stickers/stickers.mjs')
					await recordRecentUse(apiContext.username, apiContext.entityHash, stickerId)
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 关心列表（共享 care.json，键=entityHash）
		 */
		get care() {
			return {
				/**
				 * @returns {Promise<string[]>} cared entityHashes
				 */
				async list() {
					const { listCared } = await import('../chat/lib/care.mjs')
					return listCared(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {string} targetEntityHash 目标实体
				 * @param {boolean} [cared] 是否关心
				 * @returns {Promise<string[]>} 更新后的列表
				 */
				async set(targetEntityHash, cared = true) {
					const { setCared, listCared } = await import('../chat/lib/care.mjs')
					await setCared(apiContext.username, apiContext.entityHash, targetEntityHash, cared !== false)
					return listCared(apiContext.username, apiContext.entityHash)
				},
			}
		},
		/**
		 * @param {string} groupId 群 ID
		 * @returns {Promise<object>} Group
		 */
		async group(groupId) {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(apiContext, groupId)
			const channelId = state.groupSettings?.defaultChannelId || 'default'
			const { group } = await buildConversationContext(apiContext.username, groupId, channelId)
			return hydrateGroup(apiContext, groupId, group)
		},
		/**
		 * @param {string} peerEntityHash 对端实体（须解析为用户 pubKeyHash）
		 * @returns {Promise<object>} DM Group
		 */
		async openDm(peerEntityHash) {
			const { createEcdhDmGroup } = await import('../chat/dm/index.mjs')
			const { getEntityActivePubKey } = await import('../entity/identity.mjs')
			const peerPubKey = peerPubKeyFromEntityHash(peerEntityHash)
			const myPubKey = await getEntityActivePubKey(apiContext.username, apiContext.entityHash)
			const dm = await createEcdhDmGroup(apiContext.username, myPubKey, peerPubKey, { entityHash: apiContext.entityHash })
			const { group } = await buildConversationContext(apiContext.username, dm.groupId, dm.defaultChannelId)
			return hydrateGroup(apiContext, dm.groupId, group)
		},
		/**
		 * @param {{ name?: string, defaultChannelName?: string }} [options] 建群参数
		 * @returns {Promise<object>} 新建 Group
		 */
		async createGroup(options = {}) {
			const { newGroup } = await import('../chat/session/groupLifecycle.mjs')
			const groupId = await newGroup(apiContext.username, { ...options, entityHash: apiContext.entityHash })
			return this.group(groupId)
		},
		/**
		 * @param {string} groupId 群 ID
		 * @param {object} [options] 加群参数（inviteCode / bootstrap 等）
		 * @returns {Promise<object>} Group
		 */
		async join(groupId, options = {}) {
			const { performMemberJoin } = await import('../chat/dm/index.mjs')
			const result = await performMemberJoin(apiContext.username, groupId, { ...options, entityHash: apiContext.entityHash })
			return this.group(result.groupId)
		},
		/**
		 * @param {object} event OnMessage 纯数据事件
		 * @returns {Promise<object>} Message
		 */
		async messageFrom(event) {
			const groupId = event.group?.groupId
			const message = event.message || event
			return createMessage(apiContext, groupId, {
				...message,
				channelId: event.channel?.channelId || message.channelId || 'default',
				eventId: message.eventId || message.id || message.extension?.dagEventId,
			}, event.mentions)
		},
		/**
		 * @returns {Promise<object>} 节点级信誉账本
		 */
		async reputation() {
			const { loadReputation } = await import('npm:@steve02081504/fount-p2p/node/reputation_store')
			return loadReputation()
		},
		/**
		 * @returns {{ add: Function, list: Function }} 节点 denylist
		 */
		get nodeDenylist() {
			return {
				/**
				 * @param {{ scope: string, value: string, groupId?: string }} entry denylist 条目
				 * @returns {Promise<object>} 更新后的 denylist
				 */
				async add(entry) {
					const { addDenylistEntry, loadDenylist } = await import('npm:@steve02081504/fount-p2p/node/denylist')
					addDenylistEntry(entry)
					return loadDenylist()
				},
				/**
				 * @returns {Promise<object>} denylist
				 */
				async list() {
					const { loadDenylist } = await import('npm:@steve02081504/fount-p2p/node/denylist')
					return loadDenylist()
				},
			}
		},
		/**
		 * @param {{ name?: string, avatar?: { buffer: Buffer, filename: string, mimeType?: string }, banner?: { buffer: Buffer, filename: string, mimeType?: string }, [key: string]: unknown }} updates 资料补丁
		 * @returns {Promise<object>} 更新后的 profile 或 `{ queued, contentHash, ts }`
		 */
		async updateProfile(updates = {}) {
			const { updateEntityProfileAsActor } = await import('../entity/ownerProfileUpdate.mjs')
			const result = await updateEntityProfileAsActor(
				apiContext.username,
				apiContext.entityHash,
				apiContext.entityHash,
				updates,
			)
			return result.profile ?? result
		},
		/**
		 * 以本 client 实体身份更新任意目标实体资料（本机直写或远端主人 EVFS 队列）。
		 * @param {string} targetEntityHash 目标
		 * @param {object} updates 资料补丁
		 * @returns {Promise<object>} `{ profile }` 或 `{ queued, contentHash, ts }`
		 */
		async updateEntityProfile(targetEntityHash, updates = {}) {
			const { updateEntityProfileAsActor } = await import('../entity/ownerProfileUpdate.mjs')
			return updateEntityProfileAsActor(
				apiContext.username,
				apiContext.entityHash,
				targetEntityHash,
				updates,
			)
		},
		/**
		 * 声明 / 清除本实体的所属主人（identity + profile + 群 `member_owner_update`）。
		 * @param {string | null} ownerEntityHash 主人 entityHash；null/空 清除
		 * @returns {Promise<object>} 更新后的身份行
		 */
		async setOwner(ownerEntityHash) {
			const { setEntityOwner } = await import('../entity/identity.mjs')
			return setEntityOwner(apiContext.username, apiContext.entityHash, ownerEntityHash)
		},
		/**
		 * @returns {{ search: Function }} 实体命名空间
		 */
		get entities() {
			return {
				/**
				 * @param {string} q 搜索词
				 * @param {{ maxHits?: number }} [options] 选项
				 * @returns {Promise<{ query: string, entities: object[] }>} 网络搜索结果
				 */
				async search(q, options = {}) {
					const { searchEntitiesNetwork } = await import('../entity/entitySearch.mjs')
					return searchEntitiesNetwork(apiContext.username, q, {
						viewerEntityHash: apiContext.entityHash,
						maxHits: options.maxHits,
					})
				},
			}
		},
		/**
		 * @returns {Promise<object[]>} 本 user 运行中的 BridgeBot 列表
		 */
		async bridgeBots() {
			const { listBridgeBots } = await import('../chat/bridge/operations.mjs')
			return listBridgeBots(apiContext.username).map(row => ({
				platform: row.platform,
				botname: row.botname,
				/**
				 * @returns {Promise<void>} 停止该 bot 实例
				 */
				async stop() {
					const { requireBridgeOperation } = await import('../chat/bridge/operations.mjs')
					await requireBridgeOperation(apiContext.username, {
						platform: row.platform,
						botname: row.botname,
					}, 'stopSelf')()
				},
			}))
		},
	}
}

/**
 * 获取以指定实体自签的 ChatClient。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [entityHash] 缺省 = operator
 * @returns {Promise<object>} ChatClient
 */
export async function getChatClient(username, entityHash) {
	const { resolveChatEntity } = await import('../chat/lib/actor.mjs')
	const entity = await resolveChatEntity(username, entityHash)
	return createChatClient({ username, ...entity })
}
