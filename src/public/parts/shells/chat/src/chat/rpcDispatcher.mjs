/**
 * 【文件】src/chat/rpcDispatcher.mjs
 * 【职责】在群 WebSocket RPC 通道上，将远程 memberId 映射到本节点已加载的 Char/World part 并执行对应 interfaces 方法。
 * 【原理】createCharRpcDispatcher 经 getActiveGroupRuntime 与 getCharBind 判定是否本地；支持嵌套路径 method、GetReply 的 serializableRequest 转 triggerCharReply、以及 UpdateInfo/GetPrompt/onMessage 等固定分支；结果统一为 `{ kind: result|not_local|method_not_found|error }` 供 groupWsHub 回写 WS。
 * 【数据结构】memberId（`owner:charname`）、method/args、chatMetadata.LastTimeSlice.chars、RPC kind 判别联合类型、normalizeRpcErrorCode 错误码表。
 * 【关联】被 session.mjs 导出 tryInvokeLocal*；被 chat/stream/groupWsHub 调用；依赖 session/dagSession、session/runtime、session/generation。
 */
import { loadPart } from '../../../../../../server/parts_loader.mjs'

import { resolveChannelId } from './lib/channelId.mjs'
import { normalizeJsonBoundaryValue } from './lib/jsonBoundary.mjs'
import { getMaterializedSession } from './session/dagSession.mjs'
import { getCharBind, isLocalNode } from './session/runtime.mjs'
import { isSerializableRequest } from './session/serializableRequest.mjs'

/**
 * 解析可能的嵌套方法路径（如 `chat.tools.pick`）。
 * @param {unknown} root 根对象
 * @param {string} path 点号路径
 * @returns {Function | null} 命中的可调用函数
 */
function resolveNestedCallable(root, path) {
	if (!root || !String(path || '').trim()) return null
	let current = root
	for (const segment of String(path).split('.').map(part => part.trim()).filter(Boolean)) {
		if (current == null) return null
		current = current[segment]
	}
	return current instanceof Function ? current : null
}

/**
 * 将内部异常映射为对外稳定的 RPC 错误码。
 * @param {unknown} err 原始异常
 * @returns {string} 规范化后的错误码
 */
function normalizeRpcErrorCode(err) {
	const code = err?.code
	if (code === 'RPC_INVALID_ARGUMENT') return 'RPC_INVALID_ARGUMENT'
	if (code === 'RPC_INVALID_RESULT') return 'RPC_INVALID_RESULT'
	if (code === 'JSON_SERIALIZATION_ERROR') return 'JSON_SERIALIZATION_ERROR'
	if (code === 'REMOTE_UNAVAILABLE') return 'REMOTE_UNAVAILABLE'
	return 'EXECUTION_ERROR'
}

/**
 * @param {string} method 方法名
 * @param {unknown} value RPC 返回值
 * @returns {{ kind: 'result', value: unknown }} 归一化后的成功结果
 */
function resultOk(method, value) {
	return {
		kind: 'result',
		value: normalizeJsonBoundaryValue(value, `rpcDispatcher.result:${method}`),
	}
}

/**
 * 创建本地 Char RPC 分发器。
 * @param {Function} getActiveGroupRuntime 加载群 AI runtime 的函数
 * @param {Function} getChatRequest 构造 chatReplyRequest 的函数
 * @returns {Function} tryInvokeLocalCharRpc
 */
export function createCharRpcDispatcher(getActiveGroupRuntime, getChatRequest) {
	/**
	 * 尝试在本节点群会话上调用指定 `memberId` 对应角色的 Char 方法（用于 WS RPC）。
	 *
	 * @param {string} groupId 群组 id
	 * @param {string} memberId `username:charname`
	 * @param {string} method 方法名（如 `GetReply`、`GetPrompt`）
	 * @param {unknown[]} [args] 已 JSON 反序列化的参数表
	 * @returns {Promise<{ kind: 'result', value: unknown } | { kind: 'not_local' } | { kind: 'method_not_found' } | { kind: 'error', message: string, code: string }>} RPC 分发结果
	 */
	return async function tryInvokeLocalCharRpc(groupId, memberId, method, args = []) {
		let list
		try {
			list = normalizeJsonBoundaryValue(Array.isArray(args) ? args : [], `rpcDispatcher.args:${method}`)
		}
		catch (error) {
			return {
				kind: 'error',
				message: String(error?.message || error),
				code: normalizeRpcErrorCode(error),
			}
		}

		const chatMetadata = await getActiveGroupRuntime(groupId)
		if (!chatMetadata) return { kind: 'not_local' }

		const owner = chatMetadata.username
		const colon = memberId.indexOf(':')
		if (colon < 0) return { kind: 'not_local' }
		if (memberId.slice(0, colon) !== owner) return { kind: 'not_local' }
		const charname = memberId.slice(colon + 1)

		let char = chatMetadata.LastTimeSlice.chars[charname]
		if (!char) {
			const session = await getMaterializedSession(owner, groupId)
			const bind = getCharBind(session, charname)
			if (!bind || !isLocalNode(bind.homeNodeHash, owner)) return { kind: 'not_local' }
			char = await loadPart(bind.ownerUsername || owner, `chars/${charname}`)
			if (!char) return { kind: 'not_local' }
		}

		/**
		 * 从 RPC 参数列表首项的 extension/channelId 推断目标频道 id。
		 * @returns {string | null} 频道 id，无法推断时为 null
		 */
		const inferChannelId = () => {
			const firstArg = list[0]
			const fromExtension = resolveChannelId(firstArg?.extension?.channelId, '')
			if (fromExtension) return fromExtension
			const fromReplyRequest = resolveChannelId(firstArg?.chatReplyRequest?.extension?.channelId, '')
			if (fromReplyRequest) return fromReplyRequest
			return null
		}

		try {
			switch (method) {
				case 'UpdateInfo': {
					const updateInfo = char.interfaces?.info?.UpdateInfo
					if (!updateInfo) return { kind: 'method_not_found' }
					return resultOk(method, await updateInfo(list[0] ?? []))
				}
				case 'GetData': {
					const getData = char.interfaces?.config?.GetData
					if (!getData) return { kind: 'method_not_found' }
					return resultOk(method, await getData())
				}
				case 'SetData': {
					const setData = char.interfaces?.config?.SetData
					if (!setData) return { kind: 'method_not_found' }
					await setData(list[0])
					return resultOk(method, null)
				}
				case 'GetGreeting':
				case 'GetGroupGreeting': {
					const greeting = method === 'GetGreeting'
						? char.interfaces?.chat?.GetGreeting
						: char.interfaces?.chat?.GetGroupGreeting
					if (!greeting) return { kind: 'method_not_found' }
					const request = await getChatRequest(groupId, charname, inferChannelId())
					return resultOk(method, await greeting(request, Number(list[1]) || 0))
				}
				case 'GetPrompt':
				case 'GetPromptForOther': {
					const getPrompt = method === 'GetPrompt'
						? char.interfaces?.chat?.GetPrompt
						: char.interfaces?.chat?.GetPromptForOther
					if (!getPrompt) return { kind: 'method_not_found' }
					const request = await getChatRequest(groupId, charname, inferChannelId())
					return resultOk(method, await getPrompt(request))
				}
				case 'TweakPrompt':
				case 'TweakPromptForOther': {
					const tweakPrompt = method === 'TweakPrompt'
						? char.interfaces?.chat?.TweakPrompt
						: char.interfaces?.chat?.TweakPromptForOther
					if (!tweakPrompt) return resultOk(method, null)
					const request = await getChatRequest(groupId, charname, inferChannelId())
					await tweakPrompt(request, list[1], list[2], Number(list[3]) || 0)
					return resultOk(method, null)
				}
				case 'GetReply': {
					const serial = list[0]
					if (isSerializableRequest(serial)) {
						const { triggerCharReply } = await import('./session/triggerReply.mjs')
						void triggerCharReply(
							serial.groupId,
							serial.channelId,
							serial.charname,
							null,
							{
								replicaUsername: serial.replicaUsername || owner,
								personaForOther: serial.personaForOther,
								fromRpc: true,
							},
						)
						return resultOk(method, null)
					}
					const getReply = char.interfaces?.chat?.GetReply
					if (!getReply) return { kind: 'method_not_found' }
					const request = await getChatRequest(groupId, charname, inferChannelId(), { replicaUsername: owner })
					return resultOk(method, await getReply(request))
				}
				case 'onMessage': {
					const onMessage = char.interfaces?.chat?.onMessage
					if (!onMessage) return resultOk(method, false)
					const envelope = list[0] || {}
					const onlineCount = Number(envelope.onlineCount) || 1
					const replyCharname = envelope.chatReplyRequest?.char_id || charname
					const request = await getChatRequest(groupId, replyCharname, inferChannelId())
					return resultOk(method, await onMessage({ chatReplyRequest: request, onlineCount }))
				}
				case 'MessageEdit':
				case 'MessageEditing':
				case 'MessageDelete': {
					const handler = char.interfaces?.chat?.[method]
					if (!handler) return { kind: 'method_not_found' }
					return resultOk(method, await handler(list[0]))
				}
				default: {
					const nested = resolveNestedCallable(char.interfaces, method)
					if (!nested) return { kind: 'method_not_found' }
					return resultOk(method, await nested(...list))
				}
			}
		}
		catch (error) {
			return {
				kind: 'error',
				message: String(error?.message || error),
				code: normalizeRpcErrorCode(error),
			}
		}
	}
}

/**
 * @param {Function} getChatRequest 构造 chatReplyRequest
 * @returns {Function} tryInvokeLocalWorldRpc 世界 RPC 分发器
 */
export function createWorldRpcDispatcher(getChatRequest) {
	/**
	 * @param {string} groupId 群 ID
	 * @param {string} memberId `owner:world:worldname`
	 * @param {string} method 方法名
	 * @param {unknown[]} [args] 已 JSON 反序列化的参数表
	 * @returns {Promise<{ kind: 'result', value: unknown } | { kind: 'not_local' } | { kind: 'method_not_found' } | { kind: 'error', message: string, code: string }>} RPC 分发结果
	 */
	return async function tryInvokeLocalWorldRpc(groupId, memberId, method, args = []) {
		let list
		try {
			list = normalizeJsonBoundaryValue(Array.isArray(args) ? args : [], `rpcDispatcher.args:${method}`)
		}
		catch (error) {
			return {
				kind: 'error',
				message: String(error?.message || error),
				code: normalizeRpcErrorCode(error),
			}
		}

		const chatData = await import('./session/wsLifecycle.mjs').then(m => m.groupMetadatas.get(groupId))
		const owner = chatData?.username
		if (!owner) return { kind: 'not_local' }

		const worldMarker = ':world:'
		const idx = memberId.indexOf(worldMarker)
		if (idx < 0) return { kind: 'not_local' }
		const ownerFromId = memberId.slice(0, idx)
		if (ownerFromId && ownerFromId !== owner) return { kind: 'not_local' }
		const worldname = memberId.slice(idx + worldMarker.length)

		const session = await getMaterializedSession(owner, groupId)
		const bind = session.world?.worldname === worldname
			? session.world
			: Object.values(session.channelWorlds || {}).find(w => w?.worldname === worldname)
		if (!bind || !isLocalNode(bind.homeNodeHash, owner)) return { kind: 'not_local' }

		const world = await loadPart(bind.ownerUsername || owner, `worlds/${worldname}`)
		if (!world) return { kind: 'not_local' }

		/** @returns {string | null} 从 RPC 参数推断频道 id */
		const inferChannelId = () => {
			const first = list[0]
			const fromExtension = resolveChannelId(first?.extension?.channelId, '')
			if (fromExtension) return fromExtension
			const fromReply = resolveChannelId(first?.chatReplyRequest?.extension?.channelId, '')
			if (fromReply) return fromReply
			return null
		}

		try {
			switch (method) {
				case 'GetGreeting':
				case 'GetGroupGreeting': {
					const fn = method === 'GetGreeting'
						? world.interfaces?.chat?.GetGreeting
						: world.interfaces?.chat?.GetGroupGreeting
					if (!fn) return { kind: 'method_not_found' }
					const request = await getChatRequest(groupId, undefined, inferChannelId(), { replicaUsername: owner })
					return resultOk(method, await fn(request, Number(list[1]) || 0))
				}
				case 'GetSpeakingOrder': {
					const fn = world.interfaces?.chat?.GetSpeakingOrder
					if (!fn) return { kind: 'method_not_found' }
					const request = list[0] || { groupId, channelId: inferChannelId(), username: owner }
					const order = fn(request)
					const turns = []
					if (order?.[Symbol.asyncIterator])
						for await (const turn of order) turns.push(turn)
					else if (order)
						turns.push(...order)
					return resultOk(method, turns)
				}
				case 'GetChatLogForCharname': {
					const fn = world.interfaces?.chat?.GetChatLogForCharname
					if (!fn) return { kind: 'method_not_found' }
					const request = list[0] || await getChatRequest(groupId, list[1], inferChannelId(), { replicaUsername: owner })
					return resultOk(method, await fn(request, list[1]))
				}
				case 'AddChatLogEntry':
				case 'AfterAddChatLogEntry':
				case 'MessageEdit':
				case 'MessageDelete': {
					const handler = world.interfaces?.chat?.[method]
					if (!handler) return { kind: 'method_not_found' }
					return resultOk(method, await handler(...list))
				}
				default: {
					const nested = resolveNestedCallable(world.interfaces, method)
					if (!nested) return { kind: 'method_not_found' }
					return resultOk(method, await nested(...list))
				}
			}
		}
		catch (error) {
			return {
				kind: 'error',
				message: String(error?.message || error),
				code: normalizeRpcErrorCode(error),
			}
		}
	}
}
