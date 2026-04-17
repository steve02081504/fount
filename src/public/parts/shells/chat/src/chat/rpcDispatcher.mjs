import { isValidChannelId } from './dag.mjs'
import { normalizeJsonBoundaryValue } from './remoteProxy.mjs'

/**
 * 创建本地 Char RPC 分发器。
 * @param {Function} loadChat 加载聊天元数据的函数
 * @param {Function} getChatRequest 构造 chatReplyRequest 的函数
 * @returns {Function} tryInvokeLocalCharRpc
 */
export function createCharRpcDispatcher(loadChat, getChatRequest) {
	/**
	 * 解析可能的嵌套方法路径（如 `chat.tools.pick`），用于递归函数代理。
	 * @param {unknown} root 根对象
	 * @param {string} path 点号路径
	 * @returns {Function | null} 命中的可调用函数；无效路径返回 null
	 */
	function resolveNestedCallable(root, path) {
		if (!root || typeof root !== 'object' || typeof path !== 'string' || !path.trim()) return null
		const segs = path.split('.').map(s => s.trim()).filter(Boolean)
		if (!segs.length) return null
		/** @type {any} */
		let cur = root
		for (const seg of segs) {
			if (!cur || (typeof cur !== 'object' && typeof cur !== 'function')) return null
			cur = cur[seg]
		}
		return typeof cur === 'function' ? cur : null
	}

	/**
	 * 尝试在本节点群会话上调用指定 `memberId` 对应角色的 Char 方法（用于 WS RPC）。
	 *
	 * @param {string} groupId 群组 id
	 * @param {string} memberId `username:charname` 或纯 `charname`（后者视为群主用户下的角色）
	 * @param {string} method 方法名（如 `GetReply`、`GetPrompt`）
	 * @param {unknown[]} [args] 已 JSON 反序列化的参数表
	 * @returns {Promise<{ kind: 'result', value: unknown } | { kind: 'not_local' } | { kind: 'method_not_found' } | { kind: 'error', message: string, code: string }>} 本机可调用时返回 `result`；非群主成员角色返回 `not_local`；无对应方法返回 `method_not_found`；执行异常返回 `error`
	 */
	return async function tryInvokeLocalCharRpc(groupId, memberId, method, args = []) {
		/** @type {unknown[]} */
		let list = []
		try {
			const listRaw = Array.isArray(args) ? args : []
			// RPC 参数边界：强制 JSON 可序列化，避免静默丢字段。
			list = normalizeJsonBoundaryValue(listRaw, `rpcDispatcher.args:${method}`)
		}
		catch (e) {
			return {
				kind: 'error',
				message: String(e?.message || e),
				code: normalizeRpcErrorCode(e),
			}
		}
		const chatMetadata = await loadChat(groupId)
		if (!chatMetadata) return { kind: 'not_local' }

		const owner = chatMetadata.username
		let charname = memberId
		if (typeof memberId === 'string' && memberId.includes(':')) {
			const idx = memberId.indexOf(':')
			const u = memberId.slice(0, idx)
			const cn = memberId.slice(idx + 1)
			if (u !== owner) return { kind: 'not_local' }
			charname = cn
		}

		const char = chatMetadata.LastTimeSlice.chars[charname]
		if (!char) return { kind: 'not_local' }

		/** @returns {string | null} 从 RPC 参数推断频道 id */
		const inferChannelId = () => {
			const ext = list[0]?.extension
			const ch = ext?.channelId
			if (isValidChannelId(ch)) return ch
			const ev = list[0]?.chatReplyRequest?.extension
			const ch2 = ev?.channelId
			if (isValidChannelId(ch2)) return ch2
			return null
		}

		try {
			switch (method) {
				case 'UpdateInfo': {
					const fn = char.interfaces?.info?.UpdateInfo
					if (typeof fn !== 'function') return { kind: 'method_not_found' }
					return { kind: 'result', value: normalizeJsonBoundaryValue(await fn(list[0] ?? []), `rpcDispatcher.result:${method}`) }
				}
				case 'GetData': {
					const fn = char.interfaces?.config?.GetData
					if (typeof fn !== 'function') return { kind: 'method_not_found' }
					return { kind: 'result', value: normalizeJsonBoundaryValue(await fn(), `rpcDispatcher.result:${method}`) }
				}
				case 'SetData': {
					const fn = char.interfaces?.config?.SetData
					if (typeof fn !== 'function') return { kind: 'method_not_found' }
					await fn(list[0])
					return { kind: 'result', value: null }
				}
				case 'GetGreeting':
				case 'GetGroupGreeting': {
					const fn = method === 'GetGreeting'
						? char.interfaces?.chat?.GetGreeting
						: char.interfaces?.chat?.GetGroupGreeting
					if (typeof fn !== 'function') return { kind: 'method_not_found' }
					const request = await getChatRequest(groupId, charname, inferChannelId())
					return { kind: 'result', value: normalizeJsonBoundaryValue(await fn(request, Number(list[1]) || 0), `rpcDispatcher.result:${method}`) }
				}
				case 'GetPrompt':
				case 'GetPromptForOther': {
					const fn = method === 'GetPrompt'
						? char.interfaces?.chat?.GetPrompt
						: char.interfaces?.chat?.GetPromptForOther
					if (typeof fn !== 'function') return { kind: 'method_not_found' }
					const request = await getChatRequest(groupId, charname, inferChannelId())
					return { kind: 'result', value: normalizeJsonBoundaryValue(await fn(request), `rpcDispatcher.result:${method}`) }
				}
				case 'TweakPrompt':
				case 'TweakPromptForOther': {
					const fn = method === 'TweakPrompt'
						? char.interfaces?.chat?.TweakPrompt
						: char.interfaces?.chat?.TweakPromptForOther
					if (typeof fn !== 'function') return { kind: 'result', value: null }
					const request = await getChatRequest(groupId, charname, inferChannelId())
					await fn(request, list[1], list[2], Number(list[3]) || 0)
					return { kind: 'result', value: null }
				}
				case 'GetReply': {
					const fn = char.interfaces?.chat?.GetReply
					if (typeof fn !== 'function') return { kind: 'method_not_found' }
					const request = await getChatRequest(groupId, charname, inferChannelId())
					return { kind: 'result', value: normalizeJsonBoundaryValue(await fn(request), `rpcDispatcher.result:${method}`) }
				}
				case 'onMessage': {
					const fn = char.interfaces?.chat?.onMessage
					if (typeof fn !== 'function') return { kind: 'result', value: false }
					const ev = list[0] || {}
					const onlineCount = Number(ev.onlineCount) || 1
					const rid = typeof ev.chatReplyRequest?.char_id === 'string' ? ev.chatReplyRequest.char_id : charname
					const request = await getChatRequest(groupId, rid, inferChannelId())
					return { kind: 'result', value: normalizeJsonBoundaryValue(await fn({ chatReplyRequest: request, onlineCount }), `rpcDispatcher.result:${method}`) }
				}
				case 'MessageEdit':
				case 'MessageEditing':
				case 'MessageDelete': {
					const fn = char.interfaces?.chat?.[method]
					if (typeof fn !== 'function') return { kind: 'method_not_found' }
					return { kind: 'result', value: normalizeJsonBoundaryValue(await fn(list[0]), `rpcDispatcher.result:${method}`) }
				}
				default:
				{
					const nested = resolveNestedCallable(char.interfaces, method)
					if (typeof nested !== 'function') return { kind: 'method_not_found' }
					return { kind: 'result', value: normalizeJsonBoundaryValue(await nested(...list), `rpcDispatcher.result:${method}`) }
				}
			}
		}
		catch (e) {
			return {
				kind: 'error',
				message: String(e?.message || e),
				code: normalizeRpcErrorCode(e),
			}
		}
	}
}

/**
 * 将内部异常映射为对外稳定的 RPC 错误码。
 * @param {unknown} err 原始异常
 * @returns {string} 规范化后的错误码
 */
function normalizeRpcErrorCode(err) {
	const rawCode = typeof err === 'object' && err !== null ? err.code : undefined
	if (rawCode === 'RPC_INVALID_ARGUMENT') return 'RPC_INVALID_ARGUMENT'
	if (rawCode === 'RPC_INVALID_RESULT') return 'RPC_INVALID_RESULT'
	if (rawCode === 'JSON_SERIALIZATION_ERROR') return 'JSON_SERIALIZATION_ERROR'
	return 'EXECUTION_ERROR'
}
