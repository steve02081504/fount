import { buildConversationContext } from '../chat/lib/conversationContext.mjs'
import { enumerateJoinedFederatedGroups } from '../group/queries.mjs'

import { createGroup as hydrateGroup } from './group.mjs'
import { peerPubKeyFromEntityHash } from './internal.mjs'
import { createMessage } from './message.mjs'

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @returns {object} ChatClient 鸭子类型
 */
export function createChatClient(ctx) {
	return {
		entityHash: ctx.entityHash,
		/**
		 * @returns {Promise<object[]>} 已加入群列表
		 */
		async groups() {
			const rows = await enumerateJoinedFederatedGroups(ctx.username, ctx.entityHash)
			return Promise.all(rows.map(async row => {
				const { group } = await buildConversationContext(ctx.username, row.groupId, row.defaultChannelId || 'default')
				return hydrateGroup(ctx, row.groupId, group)
			}))
		},
		/**
		 * @returns {{ list: Function, set: Function }} 书签
		 */
		get bookmarks() {
			return {
				/**
				 * @returns {Promise<{ entries: object[] }>} 书签列表
				 */
				async list() {
					const { loadEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					return { entries: loadEntityShellData(ctx.username, 'chat', ctx.entityHash, 'bookmarks').entries || [] }
				},
				/**
				 * @param {object[]} entries 书签条目
				 * @returns {Promise<{ entries: object[] }>} 写入后的列表
				 */
				async set(entries) {
					const { assignEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					const next = Array.isArray(entries) ? entries : []
					assignEntityShellData(ctx.username, 'chat', ctx.entityHash, 'bookmarks', { entries: next })
					return { entries: next }
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 群文件夹
		 */
		get groupFolders() {
			return {
				/**
				 * @returns {Promise<{ folders: object[] }>} 文件夹列表
				 */
				async list() {
					const { loadEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					return { folders: loadEntityShellData(ctx.username, 'chat', ctx.entityHash, 'groupFolders').folders || [] }
				},
				/**
				 * @param {object[]} folders 文件夹
				 * @returns {Promise<{ folders: object[] }>} 写入后的列表
				 */
				async set(folders) {
					const { assignEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					const next = Array.isArray(folders) ? folders : []
					assignEntityShellData(ctx.username, 'chat', ctx.entityHash, 'groupFolders', { folders: next })
					return { folders: next }
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 实体/群别名
		 */
		get aliases() {
			return {
				/**
				 * @returns {Promise<{ entities: Record<string, string>, groups: Record<string, string> }>} 别名档
				 */
				async list() {
					const { loadEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					const data = loadEntityShellData(ctx.username, 'chat', ctx.entityHash, 'aliases')
					return { entities: data.entities || {}, groups: data.groups || {} }
				},
				/**
				 * @param {{ entities?: Record<string, string>, groups?: Record<string, string> }} doc 别名档
				 * @returns {Promise<{ entities: Record<string, string>, groups: Record<string, string> }>} 写入后的档
				 */
				async set(doc) {
					const { assignEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					const next = { entities: doc?.entities || {}, groups: doc?.groups || {} }
					assignEntityShellData(ctx.username, 'chat', ctx.entityHash, 'aliases', next)
					return next
				},
			}
		},
		/**
		 * @returns {Promise<Record<string, Record<string, { eventId: string, seq: number }>>>} 全量已读水位
		 */
		async readMarkers() {
			const { loadReadMarkers } = await import('../chat/lib/readMarkers.mjs')
			return loadReadMarkers(ctx.username, ctx.entityHash)
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
					return loadNotificationPreferences(ctx.username, ctx.entityHash)
				},
				/**
				 * @param {Record<string, object>} prefs 整档偏好
				 * @returns {Promise<Record<string, object>>} 写入后的偏好
				 */
				async set(prefs) {
					const { saveNotificationPreferences, loadNotificationPreferences } = await import('../chat/lib/notificationPreferences.mjs')
					saveNotificationPreferences(ctx.username, ctx.entityHash, prefs || {})
					return loadNotificationPreferences(ctx.username, ctx.entityHash)
				},
			}
		},
		/**
		 * @returns {{ list: Function, seenAt: Function, setSeenAt: Function }} inbox
		 */
		get inbox() {
			return {
				/**
				 * @param {{ limit?: number, cursor?: string, kinds?: string[] }} [opts] 分页
				 * @returns {Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>} 分页结果
				 */
				async list(opts = {}) {
					const { listChatInbox } = await import('../chat/lib/inbox.mjs')
					const { getState } = await import('../chat/dag/materialize.mjs')
					const page = await listChatInbox(ctx.username, ctx.entityHash, opts)
					/** @type {Map<string, object>} */
					const stateCache = new Map()
					const items = await Promise.all(page.items.map(async row => {
						let state = stateCache.get(row.groupId)
						if (!state) {
							state = (await getState(ctx.username, row.groupId)).state
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
					return getChatInboxSeenAt(ctx.username, ctx.entityHash)
				},
				/**
				 * @param {number} [at] 已读水位毫秒
				 * @returns {Promise<number>} 写入的 seenAt
				 */
				async setSeenAt(at = Date.now()) {
					const { setChatInboxSeenAt } = await import('../chat/lib/inbox.mjs')
					const seenAt = Number(at) || Date.now()
					setChatInboxSeenAt(ctx.username, ctx.entityHash, seenAt)
					return seenAt
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function, save: Function, frequent: Function, record: Function }} 自定义表情与用量
		 */
		get emojis() {
			return {
				/**
				 * @returns {Promise<{ entries: object[] }>} 自定义表情
				 */
				async list() {
					const { loadEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					return { entries: loadEntityShellData(ctx.username, 'chat', ctx.entityHash, 'customEmojis').entries || [] }
				},
				/**
				 * @param {object[]} entries 表情条目
				 * @returns {Promise<{ entries: object[] }>} 写入后的列表
				 */
				async set(entries) {
					const { assignEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
					const next = Array.isArray(entries) ? entries : []
					assignEntityShellData(ctx.username, 'chat', ctx.entityHash, 'customEmojis', { entries: next })
					return { entries: next }
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
					const entries = [...loadEntityShellData(ctx.username, 'chat', ctx.entityHash, 'customEmojis').entries || []]
					const id = `${gid}/${eid}`
					const next = { id, groupId: gid, emojiId: eid, dataUrl: url, savedAt: Date.now() }
					const existingIndex = entries.findIndex(entry => entry?.id === id)
					if (existingIndex >= 0) entries[existingIndex] = next
					else entries.push(next)
					assignEntityShellData(ctx.username, 'chat', ctx.entityHash, 'customEmojis', { entries })
					return { entry: next }
				},
				/**
				 * @param {number} [limit] 条数上限
				 * @returns {Promise<object[]>} 常用表情
				 */
				async frequent(limit = 32) {
					const { listFrequentEmojis } = await import('../emojiUsage.mjs')
					return listFrequentEmojis(ctx.username, ctx.entityHash, limit)
				},
				/**
				 * @param {{ kind: string, unicode?: string, groupId?: string, emojiId?: string }} item 表情
				 * @returns {Promise<void>}
				 */
				async record(item) {
					const { recordEmojiUsage } = await import('../emojiUsage.mjs')
					recordEmojiUsage(ctx.username, ctx.entityHash, item)
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
					return getUserCollection(ctx.username, ctx.entityHash)
				},
				/**
				 * @param {string} packId 包 id
				 * @returns {Promise<void>}
				 */
				async install(packId) {
					const { installPack } = await import('../stickers/stickers.mjs')
					await installPack(ctx.username, ctx.entityHash, packId)
				},
				/**
				 * @param {string} packId 包 id
				 * @returns {Promise<void>}
				 */
				async uninstall(packId) {
					const { uninstallPack } = await import('../stickers/stickers.mjs')
					await uninstallPack(ctx.username, ctx.entityHash, packId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async addFavorite(stickerId) {
					const { addToFavorites } = await import('../stickers/stickers.mjs')
					await addToFavorites(ctx.username, ctx.entityHash, stickerId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async removeFavorite(stickerId) {
					const { removeFromFavorites } = await import('../stickers/stickers.mjs')
					await removeFromFavorites(ctx.username, ctx.entityHash, stickerId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async recordRecent(stickerId) {
					const { recordRecentUse } = await import('../stickers/stickers.mjs')
					await recordRecentUse(ctx.username, ctx.entityHash, stickerId)
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
					return listCared(ctx.username, ctx.entityHash)
				},
				/**
				 * @param {string} targetEntityHash 目标实体
				 * @param {boolean} [cared] 是否关心
				 * @returns {Promise<string[]>} 更新后的列表
				 */
				async set(targetEntityHash, cared = true) {
					const { setCared, listCared } = await import('../chat/lib/care.mjs')
					await setCared(ctx.username, ctx.entityHash, targetEntityHash, cared !== false)
					return listCared(ctx.username, ctx.entityHash)
				},
			}
		},
		/**
		 * @param {string} groupId 群 ID
		 * @returns {Promise<object>} Group
		 */
		async group(groupId) {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const channelId = state.groupSettings?.defaultChannelId || 'default'
			const { group } = await buildConversationContext(ctx.username, groupId, channelId)
			return hydrateGroup(ctx, groupId, group)
		},
		/**
		 * @param {string} peerEntityHash 对端实体（须解析为用户 pubKeyHash）
		 * @returns {Promise<object>} DM Group
		 */
		async openDm(peerEntityHash) {
			const { createEcdhDmGroup } = await import('../chat/dm/index.mjs')
			const { getEntityActivePubKey } = await import('../entity/identity.mjs')
			const peerPubKey = peerPubKeyFromEntityHash(peerEntityHash)
			const myPubKey = await getEntityActivePubKey(ctx.username, ctx.entityHash)
			const dm = await createEcdhDmGroup(ctx.username, myPubKey, peerPubKey, { entityHash: ctx.entityHash })
			const { group } = await buildConversationContext(ctx.username, dm.groupId, dm.defaultChannelId)
			return hydrateGroup(ctx, dm.groupId, group)
		},
		/**
		 * @param {{ name?: string, defaultChannelName?: string }} [opts] 建群参数
		 * @returns {Promise<object>} 新建 Group
		 */
		async createGroup(opts = {}) {
			const { newGroup } = await import('../chat/session/groupLifecycle.mjs')
			const groupId = await newGroup(ctx.username, { ...opts, entityHash: ctx.entityHash })
			return this.group(groupId)
		},
		/**
		 * @param {string} groupId 群 ID
		 * @param {object} [opts] 加群参数（inviteCode / bootstrap 等）
		 * @returns {Promise<object>} Group
		 */
		async join(groupId, opts = {}) {
			const { performMemberJoin } = await import('../chat/dm/index.mjs')
			const result = await performMemberJoin(ctx.username, groupId, { ...opts, entityHash: ctx.entityHash })
			return this.group(result.groupId)
		},
		/**
		 * @param {object} event OnMessage 纯数据事件
		 * @returns {Promise<object>} Message
		 */
		async messageFrom(event) {
			const groupId = event.group?.groupId
			const message = event.message || event
			return createMessage(ctx, groupId, {
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
		 * @param {{ name?: string, avatar?: { buffer: Buffer, filename: string, mimeType?: string }, [key: string]: unknown }} updates 资料补丁
		 * @returns {Promise<object>} 更新后的 profile
		 */
		async updateProfile(updates = {}) {
			const { updateProfile, uploadAvatar } = await import('../entity/profile.mjs')
			const { avatar, ...fields } = updates
			if (avatar?.buffer)
				await uploadAvatar(ctx.username, ctx.entityHash, avatar.buffer, avatar.filename || 'avatar.png', avatar.mimeType)
			return updateProfile(ctx.username, ctx.entityHash, fields)
		},
		/**
		 * @returns {Promise<object[]>} 本 user 运行中的 BridgeBot 列表
		 */
		async bridgeBots() {
			const { listBridgeBots } = await import('../chat/bridge/operations.mjs')
			return listBridgeBots(ctx.username).map(row => ({
				platform: row.platform,
				botname: row.botname,
				/**
				 * @returns {Promise<void>} 停止该 bot 实例
				 */
				async stop() {
					const { requireBridgeOperation } = await import('../chat/bridge/operations.mjs')
					await requireBridgeOperation(ctx.username, {
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
