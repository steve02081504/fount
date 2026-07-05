/**
 * 【文件】src/actions.mjs
 * 【职责】定义 chat shell 可通过 CLI、IPC 与 fount://run 深链调用的命令表 actions，是无 HTTP 时的程序化入口。
 * 【原理】各 action 校验参数后委托 session/crud、messages、partConfig、generation、dm 编排等；默认频道由 getActiveGroupRuntime + getDefaultChannelId 解析；send/tail/trigger-reply 等操作在群 runtime 上读写 chatLog；dm/join 分别调用 orchestrateDmFirstContact / performMemberJoin 完成联邦入群流程。
 * 【数据结构】actions 对象（键为命令名）、chatInfo（asjson）、message（send）、Serializable 深链字段（introPubKeyHex/dmIntroNonce 等）。
 * 【关联】被 main.mjs handleAction 动态 import；依赖 chat/session、chat/dm、group/queries 等后端模块。
 */
import { getDefaultChannelId } from './chat/dag/queries.mjs'
import { orchestrateDmFirstContact, performMemberJoin } from './chat/dm/index.mjs'
import { getWorldName } from './chat/session/channelWorld.mjs'
import { newGroup } from './chat/session/crud.mjs'
import { addUserReply } from './chat/session/messages.mjs'
import {
	addchar,
	getCharListOfGroup,
	getUserPersonaName,
	removechar,
	setCharSpeakingFrequency,
	setPersona,
	setWorld,
} from './chat/session/partConfig.mjs'
import { getActiveGroupRuntime } from './chat/session/persistence.mjs'
import { triggerCharReply } from './chat/session/triggerReply.mjs'
import { enumerateJoinedFederatedGroups } from './group/queries.mjs'

/**
 * @param {string} groupId 群组 ID
 * @returns {Promise<string>} 默认频道 ID
 */
async function defaultChannelForGroup(groupId) {
	const meta = await getActiveGroupRuntime(groupId)
	if (!meta) throw new Error('Group not found')
	return getDefaultChannelId(meta.username, groupId)
}

/**
 * 定义了可用于聊天功能的各种操作。
 */
export const actions = {
	/**
	 * 开始一个新的聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.charname - 要添加到新聊天的角色名称。
	 * @returns {Promise<string>} - 新聊天会话的ID。
	 */
	start: async ({ user, charname }) => {
		const groupId = await newGroup(user)
		if (charname) await addchar(groupId, charname)
		return groupId
	},
	/**
	 * 根据提供的JSON信息加载聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {object} root0.chatInfo - 包含聊天详细信息的JSON对象。
	 * @returns {Promise<string>} - 加载的聊天会话的ID。
	 */
	asjson: async ({ user, chatInfo }) => {
		let groupId
		if (chatInfo.id) {
			groupId = chatInfo.id
			await getActiveGroupRuntime(groupId)
		}
		else groupId = await newGroup(user)


		if (chatInfo.world) {
			const channelId = await defaultChannelForGroup(groupId)
			await setWorld(groupId, channelId, chatInfo.world)
		}
		if (chatInfo.persona) await setPersona(groupId, chatInfo.persona)
		if (chatInfo.chars)
			for (const char of chatInfo.chars)
				await addchar(groupId, char)

		return groupId
	},
	/**
	 * 加载现有的聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 要加载的聊天的ID。
	 * @returns {Promise<string>} 确认加载的聊天ID。
	 */
	load: async ({ groupId }) => {
		if (!groupId) throw new Error('Group ID is required for load command.')
		await getActiveGroupRuntime(groupId)
		return groupId
	},
	/**
	 * 列出指定用户的所有聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @returns {Promise<Array<string>>} - 聊天ID的数组。
	 */
	list: ({ user }) => enumerateJoinedFederatedGroups(user),
	/**
	 * 向指定的聊天会话发送消息。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @param {object} root0.message - 要发送的消息对象。
	 * @returns {Promise<void>}
	 */
	send: async ({ groupId, message }) => {
		if (!groupId || !message) throw new Error('Group ID and message are required for send command.')
		const channelId = await defaultChannelForGroup(groupId)
		return addUserReply(groupId, channelId, message)
	},
	/**
	 * 获取聊天会话的最后几条消息。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @param {number} root0.n - 要检索的消息数量。
	 * @returns {Promise<Array<object>>} - 消息对象数组。
	 */
	tail: async ({ groupId, n = 5 }) => {
		if (!groupId) throw new Error('Group ID is required for tail command.')
		const meta = await getActiveGroupRuntime(groupId)
		if (!meta) throw new Error('Group not found')
		const log = meta.chatLog || []
		const start = Math.max(0, log.length - n)
		return Promise.all(log.slice(start).map(entry => entry.toData(meta.username)))
	},
	/**
	 * 从聊天中移除一个角色。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @param {string} root0.charname - 要移除的角色名称。
	 * @returns {Promise<void>}
	 */
	'remove-char': ({ groupId, charname }) => {
		if (!groupId || !charname) throw new Error('Group ID and character name are required.')
		return removechar(groupId, charname)
	},
	/**
	 * 为聊天设置用户角色。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @param {string} root0.personaName - 要设置的角色名称。
	 * @returns {Promise<void>}
	 */
	'set-persona': ({ groupId, personaName }) => {
		if (!groupId) throw new Error('Group ID is required.')
		return setPersona(groupId, personaName || null)
	},
	/**
	 * 为聊天设置世界观。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @param {string} root0.worldName - 要设置的世界观名称。
	 * @returns {Promise<void>}
	 */
	'set-world': async ({ groupId, worldName }) => {
		if (!groupId) throw new Error('Group ID is required.')
		const channelId = await defaultChannelForGroup(groupId)
		return setWorld(groupId, channelId, worldName || null)
	},
	/**
	 * 获取当前用户角色。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @returns {Promise<string>} - 当前用户角色的名称。
	 */
	'get-persona': ({ groupId }) => {
		if (!groupId) throw new Error('Group ID is required.')
		return getUserPersonaName(groupId)
	},
	/**
	 * 获取当前世界观。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @returns {Promise<string>} - 当前世界观的名称。
	 */
	'get-world': async ({ groupId }) => {
		if (!groupId) throw new Error('Group ID is required.')
		const channelId = await defaultChannelForGroup(groupId)
		return getWorldName(groupId, channelId)
	},
	/**
	 * 获取聊天中的角色列表。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @returns {Promise<Array<string>>} - 角色名称的数组。
	 */
	'get-chars': ({ groupId }) => {
		if (!groupId) throw new Error('Group ID is required.')
		return getCharListOfGroup(groupId)
	},
	/**
	 * 设置角色的发言频率。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.groupId - 目标聊天的ID。
	 * @param {string} root0.charname - 要设置频率的角色的名称。
	 * @param {number} root0.frequency - 发言频率。
	 * @returns {Promise<void>}
	 */
	'set-char-frequency': ({ groupId, charname, frequency }) => {
		if (!groupId || !charname || frequency == null) throw new Error('Group ID, character name, and frequency are required.')
		return setCharSpeakingFrequency(groupId, charname, frequency)
	},
	/**
	 * 触发角色回复。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.groupId - 聊天ID。
	 * @param {string} root0.charname - 角色名称。
	 * @returns {Promise<void>}
	 */
	'trigger-reply': async ({ groupId, charname }) => {
		if (!groupId) throw new Error('Group ID is required.')
		const channelId = await defaultChannelForGroup(groupId)
		return triggerCharReply(groupId, channelId, charname || null)
	},
	/**
	 * §16：消费 `fount://run/shells:chat/dm;…` 深链，建联或打开已有 DM。
	 * @param {object} root0 参数
	 * @param {string} root0.user 当前用户
	 * @param {string} root0.introPubKeyHex 介绍者公钥 hex
	 * @param {string} root0.dmIntroNonce nonce
	 * @param {string} root0.dmIntroSignatureHex 签名 hex
	 * @returns {Promise<{ groupId: string, defaultChannelId: string, created: boolean }>} DM 群信息
	 */
	dm: async ({ user, introPubKeyHex, dmIntroNonce, dmIntroSignatureHex }) => {
		if (!introPubKeyHex || !dmIntroNonce || !dmIntroSignatureHex)
			throw new Error('introPubKeyHex, dmIntroNonce and dmIntroSignatureHex are required for dm action')
		return orchestrateDmFirstContact(user, introPubKeyHex, dmIntroNonce, dmIntroSignatureHex)
	},
	/**
	 * §16：消费 `fount://run/shells:chat/join;…` 深链入群。
	 * @param {object} root0 参数
	 * @param {string} root0.user 当前用户
	 * @param {string} root0.groupId 群 ID
	 * @param {string} [root0.inviteCode] 邀请码
	 * @param {string} [root0.roomSecret] 首次联邦房间凭证 口令
	 * @param {string} [root0.signalingAppId] 信令应用 ID
	 * @param {string} [root0.introducerPubKeyHash] 邀请人成员 pubKeyHash
	 * @param {string} [root0.introducerNodeHash] 邀请人 nodeHash
	 * @param {string} [root0.powAnchorRef] 入群 PoW anchor 提示
	 * @returns {Promise<{ groupId: string, defaultChannelId: string }>} 入群结果
	 */
	join: async ({ user, groupId, inviteCode, roomSecret, signalingAppId, introducerPubKeyHash, introducerNodeHash, powAnchorRef }) => {
		if (!groupId) throw new Error('groupId is required for join action')
		const bootstrap = {}
		if (roomSecret?.trim()) bootstrap.roomSecret = roomSecret.trim()
		if (signalingAppId?.trim()) bootstrap.signalingAppId = signalingAppId.trim()
		if (introducerNodeHash?.trim()) bootstrap.fromNodeId = introducerNodeHash.trim()
		if (powAnchorRef?.trim()) bootstrap.powAnchorRef = powAnchorRef.trim()
		return performMemberJoin(user, groupId, { inviteCode, introducerPubKeyHash, bootstrap })
	},
}
