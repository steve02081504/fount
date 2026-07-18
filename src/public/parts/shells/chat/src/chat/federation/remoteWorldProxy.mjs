/**
 * 【文件】federation/remoteWorldProxy.mjs
 * 【职责】为远端世界（world 成员）构造 WorldAPI 聊天接口代理，方法调用转发到与 remoteProxy 相同的 RPC 通道。
 * 【原理】createRemoteWorldProxy 按 interfaces.chat 开关挂载 GetGreeting/GetSpeakingOrder/GetChatLogForViewer 等；invokeRemote 经 rpcCall 往返并做 JSON 边界 normalize。REMOTE_WORLD_PROXY_SYMBOL 供类型识别。
 * **不挂 GetChatPlugins**：返回活对象，不可 RPC；hosted 侧仅主机本机 resolveWorld 生效。TweakPrompt 就地 mutation 经 JSON 边界亦会丢失。
 * 【数据结构】proxy { info, interfaces.chat? }；Symbol 附着 { memberId, sourceHost }。
 * 【关联】remoteProxy.mjs、charRpc/room、session world RPC、decl/worldAPI.ts、viewerLog。
 */
/** @typedef {import('../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/chatLog.ts').chatReply_t} chatReply_t */
/** @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../decl/chatLog.ts').chatViewer_t} chatViewer_t */
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
		let rpcResult
		try {
			rpcResult = await rpcCall(method, encodeWireJson(args, `rpc.args:${method}`))
		}
		catch (error) {
			// world 钩子全部可选：远端未实现等价于本地未定义该钩子
			if (error?.code === 'METHOD_NOT_FOUND') return undefined
			throw error
		}
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
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @returns {Promise<object | undefined>} 世界单人 prompt 片段
			 */
			GetPrompt: replyRequest => invokeRemote('GetPrompt', [replyRequest]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @returns {Promise<object | undefined>} 世界群 prompt 片段
			 */
			GetGroupPrompt: replyRequest => invokeRemote('GetGroupPrompt', [replyRequest]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {object} promptStruct 完整 prompt 结构
			 * @param {object} myPrompt 世界自身的 prompt 片段
			 * @param {number} detailLevel 细节级别
			 * @returns {Promise<object | undefined>} 调整后的 prompt 结构
			 */
			TweakPrompt: (replyRequest, promptStruct, myPrompt, detailLevel) =>
				invokeRemote('TweakPrompt', [replyRequest, promptStruct, myPrompt, detailLevel]),
			/**
			 * @param {chatReplyRequest_t} request 聊天回复请求
			 * @returns {Promise<AsyncIterable<object>>} 发言轮次序列
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
			 * @param {chatViewer_t} viewer 观察者
			 * @returns {Promise<chatLogEntry_t[]>} 观察者视图下的聊天记录
			 */
			GetChatLogForViewer: (replyRequest, viewer) => invokeRemote('GetChatLogForViewer', [replyRequest, viewer]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {string} charname 被代言的角色
			 * @returns {Promise<chatReply_t | null | undefined>} 世界代角色的回复；nullish 表示放行
			 */
			GetCharReply: (replyRequest, charname) => invokeRemote('GetCharReply', [replyRequest, charname]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {chatLogEntry_t} entry 即将落盘的条目
			 * @returns {Promise<object | undefined>} 世界改写/拒绝结果
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
