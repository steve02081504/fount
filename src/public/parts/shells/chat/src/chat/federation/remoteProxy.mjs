/**
 * 【文件】federation/remoteProxy.mjs
 * 【职责】为不在本机运行的角色/世界构造 RPC 代理（CharAPI/WorldAPI 子集），经群 WebSocket rpc_call 或 Trystero char_rpc 调用远端节点。
 * 【原理】createRemoteCharProxy 用 Symbol 标记代理对象；rpcCall 组装 requestId/memberId/method，带 targetNodeId（从 sourceHost 解析 UUID）定向到指定联邦节点。shouldAcceptDirectedGroupRpc 防止 WS 误执行非本 clientNodeId 的请求。与 room char_rpc 及 ws/groupWsRpc 闭环。
 * 【数据结构】REMOTE_PROXY_SYMBOL；GROUP_RPC_TARGET_NODE_ID_KEY；代理内部缓存 interfaces 形状。
 * 【关联】charRpc.mjs、ws/groupWsRpc.mjs、session tryInvokeLocal*、lib/jsonBoundary.mjs、remoteWorldProxy.mjs。
 */
/** @typedef {import('../../../../../../decl/basedefs.ts').locale_t} locale_t */
/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReply_t} chatReply_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').single_part_prompt_t} single_part_prompt_t */

import { encodeWireJson } from '../lib/wireJson.mjs'

/** 标记 `createRemoteCharProxy` 生成的对象，供 `isRemoteProxy` 识别。 */
export const REMOTE_PROXY_SYMBOL = Symbol.for('fount.remoteCharProxy')

/** 群 WebSocket `rpc_call` 定向字段名（与 `ws/groupWsRpc.mjs` / 浏览器端一致）。 */
export const GROUP_RPC_TARGET_NODE_ID_KEY = 'targetNodeId'

const UUID_V4_RE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu

/**
 * 从成员 `sourceHost` 解析群 WS 可用的 `targetNodeId`。
 * @param {string | undefined} sourceHost 成员资料中的来源节点标识
 * @returns {string | undefined} UUID v4 小写；无法解析时为 undefined
 */
export function resolveTargetNodeIdFromSourceHost(sourceHost) {
	const trimmed = sourceHost?.trim()
	if (!trimmed) return undefined
	if (UUID_V4_RE.test(trimmed)) return trimmed.toLowerCase()
	const nodePref = /^node:([\da-f-]{36})$/iu.exec(trimmed)
	if (nodePref?.[1] && UUID_V4_RE.test(nodePref[1])) return nodePref[1].toLowerCase()
	return undefined
}

/**
 * @param {object} rpcPayload `rpc_call` 形状的对象（就地修改）
 * @param {string | undefined} sourceHost 成员来源节点标识
 * @returns {object} 与 `rpcPayload` 同一引用
 */
export function withDirectedGroupRpcTarget(rpcPayload, sourceHost) {
	const targetNodeId = resolveTargetNodeIdFromSourceHost(sourceHost)
	if (targetNodeId) rpcPayload[GROUP_RPC_TARGET_NODE_ID_KEY] = targetNodeId
	return rpcPayload
}

/**
 * @param {unknown} wireMessage 已解析 WS 消息
 * @param {string | undefined} localClientNodeId 本连接登记的 `clientNodeId`
 * @returns {boolean} true 表示应执行 RPC 逻辑
 */
export function shouldAcceptDirectedGroupRpc(wireMessage, localClientNodeId) {
	const targetNodeId = wireMessage?.[GROUP_RPC_TARGET_NODE_ID_KEY]
	if (!targetNodeId) return true
	const normalizedTargetNodeId = String(targetNodeId).trim().toLowerCase()
	return UUID_V4_RE.test(normalizedTargetNodeId) && normalizedTargetNodeId === localClientNodeId
}

/**
 * @param {unknown} clientNodeId 待校验值
 * @returns {boolean} 合法 UUID v4 时为 true
 */
export function isValidGroupRpcClientNodeId(clientNodeId) {
	return UUID_V4_RE.test(String(clientNodeId).trim().toLowerCase())
}

/**
 * @param {string | undefined} sourceHost 成员来源节点标识
 * @param {string} username 群主用户名
 * @param {string} groupId 群组 id
 * @param {object} rpcPayload `rpc_call` 形状的对象
 * @returns {Promise<{ mode: 'broadcast' | 'direct', payload: object }>} 发送模式与 WS 负载
 */
export async function sendRpcToNode(sourceHost, username, groupId, rpcPayload) {
	const payload = encodeWireJson(
		withDirectedGroupRpcTarget({ ...rpcPayload }, sourceHost),
		'rpc.args:sendRpcToNode',
	)
	const { ensureFederationRoom } = await import('./index.mjs')
	const slot = await ensureFederationRoom(username, groupId)
	if (!slot?.room) return { mode: 'broadcast', payload }
	const targetNodeId = resolveTargetNodeIdFromSourceHost(sourceHost)
	if (!targetNodeId) return { mode: 'broadcast', payload }
	const peerId = slot.getPeerIdByNodeHash(targetNodeId)
	if (!peerId) return { mode: 'broadcast', payload }

	slot.sendToPeer(peerId, 'char_rpc', payload)
	return { mode: 'direct', payload }
}

/**
 * @param {string} memberId 远端成员标识（如 `username:charname`）
 * @param {string} [sourceHost] 远端节点标识
 * @param {{ info?: boolean, config?: boolean, chat?: boolean }} [interfaces] 某键为 `false` 时不挂载对应分组
 * @param {null | ((method: string, args: unknown[]) => Promise<unknown>)} [rpcCall] 由宿主注入的 WS RPC
 * @returns {CharAPI_t & { [typeof REMOTE_PROXY_SYMBOL]: { memberId: string, sourceHost?: string, targetNodeId?: string } }} 可替换为真实 RPC 的代理对象
 */
export function createRemoteCharProxy(memberId, sourceHost, interfaces = {}, rpcCall = null) {
	const useInfo = interfaces.info !== false
	const useConfig = interfaces.config !== false
	const useChat = interfaces.chat !== false

	/** @type {CharAPI_t['interfaces']} */
	const iface = {}

	/**
	 * @param {string} method RPC 方法名
	 * @param {unknown[]} args 参数列表
	 * @returns {Promise<unknown>} 经 JSON 边界校验后的返回值
	 */
	async function invokeRemote(method, args) {
		if (!rpcCall) throw remoteUnavailableError(method)
		const jsonArgs = encodeWireJson(args, `rpc.args:${method}`)
		const rpcResult = await rpcCall(method, jsonArgs)
		return encodeWireJson(rpcResult ?? null, `rpc.result:${method}`)
	}

	/**
	 * @param {object} shape 接口描述对象
	 * @param {string[]} path 当前路径
	 * @returns {object} 递归生成的代理对象
	 */
	function materializeInterfaceShape(shape, path) {
		/** @type {Record<string, unknown>} */
		const out = {}
		for (const [key, value] of Object.entries(shape)) {
			const methodPath = [...path, key]
			if (typeof value === 'function') {
				const methodName = methodPath.join('.')
				/**
				 * @param {...unknown} callArgs 远端调用参数
				 * @returns {Promise<unknown>} 远端返回值
				 */
				out[key] = (...callArgs) => invokeRemote(methodName, callArgs)
				continue
			}
			if (value?.constructor === Object) {
				out[key] = materializeInterfaceShape(value, methodPath)
				continue
			}
			out[key] = value
		}
		return out
	}

	if (useInfo)
		iface.info = {
			/**
			 * @param {locale_t[]} locales 需要更新的区域列表
			 * @returns {Promise<import('../../../../../../decl/basedefs.ts').info_t>} 各区域的 info 对象
			 */
			UpdateInfo: locales => invokeRemote('UpdateInfo', [locales]),
		}

	if (useConfig)
		iface.config = {
			/** @returns {Promise<object>} 配置数据 */
			GetData: () => invokeRemote('GetData', []),
			/**
			 * @param {object} data 要写入的配置对象
			 * @returns {Promise<void>}
			 */
			SetData: data => invokeRemote('SetData', [data]),
		}

	if (useChat)
		iface.chat = {
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {number} greetingIndex 问候语索引
			 * @returns {Promise<chatReply_t | null>} 问候语回复或 null
			 */
			GetGreeting: (replyRequest, greetingIndex) =>
				invokeRemote('GetGreeting', [replyRequest, greetingIndex]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {number} greetingIndex 问候语索引
			 * @returns {Promise<chatReply_t | null>} 群问候语回复或 null
			 */
			GetGroupGreeting: (replyRequest, greetingIndex) =>
				invokeRemote('GetGroupGreeting', [replyRequest, greetingIndex]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @returns {Promise<single_part_prompt_t>} prompt 片段
			 */
			GetPrompt: replyRequest => invokeRemote('GetPrompt', [replyRequest]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {prompt_struct_t} promptStruct 完整 prompt 结构
			 * @param {single_part_prompt_t} myPrompt 本角色的 prompt 片段
			 * @param {number} detailLevel 详细程度
			 * @returns {Promise<void>}
			 */
			TweakPrompt: (replyRequest, promptStruct, myPrompt, detailLevel) =>
				invokeRemote('TweakPrompt', [replyRequest, promptStruct, myPrompt, detailLevel]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @returns {Promise<single_part_prompt_t>} prompt 片段
			 */
			GetPromptForOther: replyRequest => invokeRemote('GetPromptForOther', [replyRequest]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @param {prompt_struct_t} promptStruct 完整 prompt 结构
			 * @param {single_part_prompt_t} myPrompt 本角色为他人准备的 prompt 片段
			 * @param {number} detailLevel 详细程度
			 * @returns {Promise<void>}
			 */
			TweakPromptForOther: (replyRequest, promptStruct, myPrompt, detailLevel) =>
				invokeRemote('TweakPromptForOther', [replyRequest, promptStruct, myPrompt, detailLevel]),
			/**
			 * @param {chatReplyRequest_t} replyRequest 聊天回复请求
			 * @returns {Promise<chatReply_t | null>} 回复对象或 null
			 */
			GetReply: replyRequest => invokeRemote('GetReply', [replyRequest]),
			/**
			 * @param {object} event 新消息事件上下文（可序列化：message / mentions / group / channel）
			 * @returns {Promise<boolean>} true 表示该 char 想要发言
			 */
			onMessage: event => invokeRemote('onMessage', [event]).then(Boolean),
			/**
			 * @param {{ index: number, original: chatLogEntry_t, edited: chatReply_t, chat_log: chatLogEntry_t[], extension?: object }} editPayload 编辑参数
			 * @returns {Promise<chatReply_t>} 编辑后的回复
			 */
			MessageEdit: editPayload =>
				invokeRemote('MessageEdit', [editPayload]).then(result => result ?? editPayload.edited),
			/**
			 * @param {{ index: number, original: chatLogEntry_t, edited: chatReply_t, chat_log: chatLogEntry_t[], extension?: object }} editPayload 编辑中参数
			 * @returns {Promise<void>}
			 */
			MessageEditing: editPayload => invokeRemote('MessageEditing', [editPayload]),
			/**
			 * @param {{ index: number, chat_log: chatLogEntry_t[], chat_entry: chatLogEntry_t, extension?: object }} deletePayload 删除参数
			 * @returns {Promise<void>}
			 */
			MessageDelete: deletePayload => invokeRemote('MessageDelete', [deletePayload]),
		}

	if (useInfo && interfaces.info?.constructor === Object)
		iface.info = materializeInterfaceShape(interfaces.info, ['info'])
	if (useConfig && interfaces.config?.constructor === Object)
		iface.config = materializeInterfaceShape(interfaces.config, ['config'])
	if (useChat && interfaces.chat?.constructor === Object)
		iface.chat = materializeInterfaceShape(interfaces.chat, ['chat'])

	/** @type {CharAPI_t} */
	const proxy = {
		info: {},
		interfaces: iface,
	}

	Object.defineProperty(proxy, REMOTE_PROXY_SYMBOL, {
		value: {
			memberId,
			sourceHost,
			targetNodeId: resolveTargetNodeIdFromSourceHost(sourceHost),
		},
		enumerable: false,
		configurable: false,
		writable: false,
	})

	return /** @type {any} */ proxy
}

/**
 * @param {unknown} charObj 待检测对象
 * @returns {boolean} 为远端桩时为 true
 */
export function isRemoteProxy(charObj) {
	return Boolean(charObj && REMOTE_PROXY_SYMBOL in Object(charObj))
}

/**
 * @param {string} [operation] 可选的操作名
 * @returns {Error} 带 `REMOTE_UNAVAILABLE` code 的错误
 */
export function remoteUnavailableError(operation) {
	const suffix = operation ? `: ${operation}` : ''
	const err = new Error(`remote peer unavailable${suffix}`)
	err.code = 'REMOTE_UNAVAILABLE'
	return err
}
