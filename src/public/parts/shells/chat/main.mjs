/**
 * 【文件】main.mjs
 * 【职责】chat shell 的 Part 入口：向 parts_loader 导出 shellAPI_t，注册 HTTP/群路由与文件 GC，并分发 CLI/IPC 动作。
 * 【原理】side-effect 预加载 dag/index；Load 调用 registerChatRoutes。
 *   handleAction 动态 import actions 表；ArgumentsHandler 解析 dm/join/start/send 等；IPCInvokeHandler 透传 command。
 * 【数据结构】loadCount、shellAPI_t（info/Load/Unload/interfaces）、actions 命令键。
 * 【关联】parts_loader 加载；import registerRoutes、files、locales。
 */
import './src/chat/dag/index.mjs'
import './src/chat/federation/config.mjs'

import {
	registerShellPartpath,
	unregisterShellPartpath,
} from 'npm:@steve02081504/fount-p2p/registries/part_path'

import { sendEventToUser } from '../../../../server/web_server/event_dispatcher.mjs'

import { registerChatChunkProviders, unregisterChatChunkProviders } from './src/chat/chunkProviders.mjs'
import { registerChatEventTypeDefs, unregisterChatEventTypeDefs } from './src/chat/dag/eventTypes.mjs'
import { registerChatFederationRoomProvider, unregisterChatFederationRoomProvider } from './src/chat/federation/trustGraphRooms.mjs'
import { registerChatUserRoomEmojiHandlers, unregisterChatUserRoomEmojiHandlers } from './src/chat/federation/userRoomEmojiRegistry.mjs'
import { registerChatGroupEmojiPostEmbed, unregisterChatGroupEmojiPostEmbed } from './src/chat/groupEmojiPostEmbed.mjs'
import { registerChatGroupEntityIndex, unregisterChatGroupEntityIndex } from './src/chat/groupEntityIndex.mjs'
import { getGroupMemberEntityHash } from './src/chat/lib/replica.mjs'
import {
	registerChatMailboxConsumer,
	unregisterChatMailboxConsumer,
} from './src/chat/mailbox/ingest.mjs'
import { registerChatManifestAcl, unregisterChatManifestAcl } from './src/chat/manifestAcl.mjs'
import { registerChatManifestTransfer, unregisterChatManifestTransfer } from './src/chat/manifestTransfer.mjs'
import {
	registerChatEntitySearchHandler,
	unregisterChatEntitySearchHandler,
} from './src/entity/entitySearch.mjs'
import {
	registerOwnerProfileUpdateMailbox,
	unregisterOwnerProfileUpdateMailbox,
} from './src/entity/ownerProfileUpdate.mjs'
import { registerGroupMemberEntityResolver, unregisterGroupMemberEntityResolver } from './src/entity/viewerResolve.mjs'
import { registerChatRoutes } from './src/registerRoutes.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

let loadCount = 0

/**
 * 处理传入的聊天动作请求。
 * @param {string} user - 用户名。
 * @param {string} action - 要执行的动作名称。
 * @param {object} params - 动作所需的参数。
 * @returns {Promise<any>} - 返回动作执行的结果。
 */
async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (actions[action])
		return actions[action]({ user, ...params })

	const { actions: profileActions } = await import('./src/profile/actions.mjs')
	if (profileActions[action])
		return profileActions[action]({ user, ...params })

	const stickerActionMap = {
		'sticker-list': 'list',
		'sticker-create': 'create',
		'sticker-info': 'info',
		'sticker-install': 'install',
		'sticker-uninstall': 'uninstall',
		'sticker-delete': 'delete',
	}
	const stickerKey = stickerActionMap[action]
	if (stickerKey) {
		const { actions: stickerActions } = await import('./src/stickers/actions.mjs')
		if (stickerActions[stickerKey])
			return stickerActions[stickerKey]({ user, ...params })
	}

	throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)
}

/**
 * 聊天Shell API
 * @type {import('../../../../../src/decl/shellAPI.ts').shellAPI_t}
 */
export default {
	info,
	/**
	 * 加载聊天Shell，设置API端点并增加加载计数。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: async ({ router }) => {
		loadCount++
		registerShellPartpath('chat', 'shells/chat')
		registerChatEntitySearchHandler()
		registerChatEventTypeDefs()
		registerChatGroupEmojiPostEmbed()
		registerChatUserRoomEmojiHandlers()
		registerChatManifestAcl()
		registerChatManifestTransfer()
		registerChatChunkProviders()
		registerChatGroupEntityIndex()
		registerGroupMemberEntityResolver('chat', getGroupMemberEntityHash)
		registerChatFederationRoomProvider()
		registerChatMailboxConsumer()
		registerOwnerProfileUpdateMailbox()
		if (loadCount === 1) {
			registerChatRoutes(router)
			void import('./src/chat/call/session.mjs').then(m => m.reconcileAllOrphanedCalls())
				.catch(error => console.error('call: reconcile on Load failed', error))
		}
	},
	/**
	 * 卸载聊天Shell，减少加载计数并在必要时清理定时器。
	 */
	Unload: () => {
		loadCount--
		if (!loadCount) {
			unregisterChatEntitySearchHandler()
			unregisterShellPartpath('chat')
			unregisterChatEventTypeDefs()
			unregisterChatGroupEmojiPostEmbed()
			unregisterChatUserRoomEmojiHandlers()
			unregisterChatManifestAcl()
			unregisterGroupMemberEntityResolver('chat')
			unregisterChatManifestTransfer()
			unregisterChatChunkProviders()
			unregisterChatGroupEntityIndex()
			unregisterChatFederationRoomProvider()
			unregisterChatMailboxConsumer()
			unregisterOwnerProfileUpdateMailbox()
		}
	},
	interfaces: {
		web: {},
		invokes: {
			/**
			 * 处理命令行参数以执行各种聊天操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const command = args[0]
				let params = {}
				let result

				switch (command) {
					case 'dm': {
						params = {
							introPubKeyHex: args[1],
							dmIntroNonce: args[2],
							dmIntroSignatureHex: args[3],
						}
						result = await handleAction(user, command, params)
						if (result?.groupId) console.log(JSON.stringify(result))
						return result
					}
					case 'join': {
						params = {
							groupId: args[1],
							inviteCode: args[2] || '',
							roomSecret: args[3] || '',
							introducerPubKeyHash: args[4] || '',
							powAnchorRef: args[5] || '',
							introducerNodeHash: args[6] || '',
						}
						result = await handleAction(user, command, params)
						const groupId = result?.groupId || args[1]
						if (groupId)
							sendEventToUser(user, 'chat-group-joined', { groupId: String(groupId) })
						if (result?.groupId) console.log(JSON.stringify(result))
						return result
					}
					case 'start':
						params = { charname: args[1] }
						result = await handleAction(user, command, params)
						break
					case 'asjson':
						params = { chatInfo: JSON.parse(args[1]) }
						result = await handleAction(user, command, params)
						break
					case 'load':
						params = { groupId: args[1] }
						result = await handleAction(user, command, params)
						break
					case 'tail':
						params = { groupId: args[1], n: Number(args[2] || '5') }
						result = await handleAction(user, command, params)
						result.forEach(log => {
							console.log(`[${new Date(log.time_stamp).toLocaleString()}] ${log.name}: ${log.content}`)
						})
						break
					case 'send':
						params = { groupId: args[1], message: { content: args[2] } }
						await handleAction(user, command, params)
						break
					default: {
						const [groupId, ...rest] = args.slice(1)
						const paramMap = {
							'remove-char': { charname: rest[0] },
							'set-persona': { personaName: rest[0] },
							'set-world': { worldName: rest[0] },
							'set-char-frequency': { charname: rest[0], frequency: parseFloat(rest[1]) },
							'trigger-reply': { charname: rest[0] },
						}
						params = { groupId, ...paramMap[command] }
						result = await handleAction(user, command, params)
						if (result !== undefined) console.log(result)
						break
					}
				}
			},
			/**
			 * 处理IPC调用以执行聊天操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { command, ...params } = data
				return handleAction(user, command, params)
			},
		}
	}
}
