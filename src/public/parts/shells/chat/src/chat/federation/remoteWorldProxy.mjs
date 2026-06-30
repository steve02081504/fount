/**
 * 【文件】federation/remoteWorldProxy.mjs
 * 【职责】为远端世界（world 成员）构造 WorldAPI 聊天接口代理，方法调用转发到与 remoteProxy 相同的 RPC 通道。
 * 【原理】createRemoteWorldProxy 按 interfaces.chat 开关挂载 GetGreeting/GetSpeakingOrder 等；invokeRemote 经 rpcCall 往返并做 JSON 边界 normalize。REMOTE_WORLD_PROXY_SYMBOL 供类型识别。
 * 【数据结构】proxy { info, interfaces.chat? }；Symbol 附着 { memberId, sourceHost }。
 * 【关联】remoteProxy.mjs、charRpc/room、session world RPC、decl/worldAPI.ts。
 */
/** @typedef {import('../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/chatLog.ts').chatReply_t} chatReply_t */
/** @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').chatLogEntry_t} chatLogEntry_t */

import { encodeWireJson } from '../lib/wireJson.mjs'

/** 标记 `createRemoteWorldProxy` 生成的对象，供类型识别。 */
export const REMOTE_WORLD_PROXY_SYMBOL = Symbol.for('fount.remoteWorldProxy')

/**
 * @param {string} memberId 远端世界标识
 * @param {string} [sourceHost] 远端节点
 * @param {object} [interfaces] 接口形状覆盖
 * @param {((method: string, args: unknown[]) => Promise<unknown>) | null} [rpcCall] 由宿主注入的 RPC 调用
 * @returns {WorldAPI_t} 可替换为真实 RPC 的世界代理对象
 */
export function createRemoteWorldProxy(memberId, sourceHost, interfaces = {}, rpcCall = null) {
	const useChat = interfaces.chat !== false
	const iface = {}

	/**
	 * @param {string} method RPC 方法名
	 * @param {unknown[]} args 参数列表
	 * @returns {Promise<unknown>} 经 JSON 边界校验后的返回值
	 */
	async function invokeRemote(method, args) {
		if (!rpcCall) {
			const err = new Error(`remote world unavailable: ${method}`)
			err.code = 'REMOTE_UNAVAILABLE'
			throw err
		}
		const rpcResult = await rpcCall(method, encodeWireJson(args, `rpc.args:${method}`))
		return encodeWireJson(rpcResult ?? null, `rpc.result:${method}`)
	}

	if (useChat)
		iface.chat = {
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {number} greetingIndex 问候语索引
			 * @returns {Promise<chatReply_t | null>} 问候语回复或 null
			 */
			GetGreeting: (replyRequest, greetingIndex) => invokeRemote('GetGreeting', [replyRequest, greetingIndex]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {number} greetingIndex 问候语索引
			 * @returns {Promise<chatReply_t | null>} 群问候语回复或 null
			 */
			GetGroupGreeting: (replyRequest, greetingIndex) => invokeRemote('GetGroupGreeting', [replyRequest, greetingIndex]),
			/**
			 * @param {object} request 发言顺序上下文（含 chatReplyRequest 等）
			 * @returns {AsyncIterable<object>} 远端返回的发言轮次异步迭代器
			 */
			GetSpeakingOrder: async request => {
				const turns = await invokeRemote('GetSpeakingOrder', [request])
				const list = Array.isArray(turns) ? turns : []
				return {
					/**
					 * @returns {AsyncGenerator<object, void, unknown>} 发言轮次生成器
					 */
					async *[Symbol.asyncIterator]() {
						for (const turn of list) yield turn
					},
				}
			},
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {string} charname 角色名称
			 * @returns {Promise<chatLogEntry_t[]>} 指定角色的聊天记录
			 */
			GetChatLogForCharname: (replyRequest, charname) => invokeRemote('GetChatLogForCharname', [replyRequest, charname]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {chatLogEntry_t} entry 聊天记录条目
			 * @returns {Promise<void>}
			 */
			AddChatLogEntry: (replyRequest, entry) => invokeRemote('AddChatLogEntry', [replyRequest, entry]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {object[]} freq 频率数据
			 * @returns {Promise<void>}
			 */
			AfterAddChatLogEntry: (replyRequest, freq) => invokeRemote('AfterAddChatLogEntry', [replyRequest, freq]),
			/**
			 * @param {object} payload 消息编辑参数
			 * @returns {Promise<chatReply_t>} 编辑后的回复
			 */
			MessageEdit: payload => invokeRemote('MessageEdit', [payload]),
			/**
			 * @param {object} payload 消息删除参数
			 * @returns {Promise<void>}
			 */
			MessageDelete: payload => invokeRemote('MessageDelete', [payload]),
		}

	const proxy = {
		info: {},
		interfaces: iface,
	}

	Object.defineProperty(proxy, REMOTE_WORLD_PROXY_SYMBOL, {
		value: { memberId, sourceHost },
		enumerable: false,
		configurable: false,
		writable: false,
	})

	return /** @type {WorldAPI_t} */ proxy
}
