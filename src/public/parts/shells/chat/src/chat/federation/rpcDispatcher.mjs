/**
 * 【文件】federation/rpcDispatcher.mjs
 * 【职责】群联邦 RPC 服务端分发：将 memberId 映射到本机 Char/World part 并执行 interfaces 方法。
 * 【原理】createCharRpcDispatcher / createWorldRpcDispatcher 经本地绑定判定；结果 `{ kind: result|not_local|method_not_found|error }`。
 * 【关联】session.mjs 导出 tryInvokeLocal*；groupWsRpc、roomHandlers/rpc、remoteWorldProxy。
 */
import { loadPart } from '../../../../../../../server/parts_loader.mjs'
import { resolveChannelId } from '../lib/channelId.mjs'
import { normalizeJsonBoundaryValue } from '../lib/jsonBoundary.mjs'
import { getMaterializedSession } from '../session/dagSession.mjs'
import { getCharBind, isLocalNode } from '../session/runtime.mjs'
import { isSerializableRequest } from '../session/serializableRequest.mjs'

/**
 * @param {unknown} root 根对象
 * @param {string} path 点号路径
 * @returns {Function | null} 路径命中的可调用对象，否则 null
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
 * @param {unknown} err 原始异常
 * @returns {string} 规范化后的 RPC 错误码
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
 * @returns {{ kind: 'result', value: unknown }} 规范化后的成功结果
 */
function resultOk(method, value) {
	return {
		kind: 'result',
		value: normalizeJsonBoundaryValue(value, `rpcDispatcher.result:${method}`),
	}
}

/**
 * @param {Function} getActiveGroupRuntime 加载群 AI runtime
 * @param {Function} getChatRequest 构造 chatReplyRequest
 * @returns {Function} tryInvokeLocalCharRpc
 */
export function createCharRpcDispatcher(getActiveGroupRuntime, getChatRequest) {
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
		 * @returns {string | null} 从参数中推断的频道 ID
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
						const { triggerCharReply } = await import('../session/triggerReply.mjs')
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
				case 'OnMessage': {
					const OnMessage = char.interfaces?.chat?.OnMessage
					if (!OnMessage) return resultOk(method, false)
					const envelope = list[0] || {}
					if (envelope.mentions && envelope.group && envelope.channel && envelope.message)
						return resultOk(method, await OnMessage(envelope))
					const replyCharname = envelope.chatReplyRequest?.char_id || charname
					const { buildOnMessageEvent } = await import('../session/replyThrottle.mjs')
					const event = await buildOnMessageEvent(owner, groupId, inferChannelId(), replyCharname)
					return resultOk(method, await OnMessage(event))
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
 * @returns {Function} tryInvokeLocalWorldRpc
 */
export function createWorldRpcDispatcher(getChatRequest) {
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

		const chatData = await import('../session/wsLifecycle.mjs').then(m => m.groupMetadatas.get(groupId))
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

		/**
		 * @returns {string | null} 从参数中推断的频道 ID
		 */
		const inferChannelId = () => {
			const first = list[0]
			const fromExtension = resolveChannelId(first?.extension?.channelId, '')
			if (fromExtension) return fromExtension
			const fromReply = resolveChannelId(first?.chatReplyRequest?.extension?.channelId, '')
			if (fromReply) return fromReply
			const fromViewer = resolveChannelId(first?.channelId, '')
			if (fromViewer) return fromViewer
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
				case 'GetPrompt': {
					const fn = world.interfaces?.chat?.GetPrompt
					if (!fn) return { kind: 'method_not_found' }
					const request = list[0] || await getChatRequest(groupId, list[1], inferChannelId(), { replicaUsername: owner })
					return resultOk(method, await fn(request))
				}
				case 'GetGroupPrompt': {
					const fn = world.interfaces?.chat?.GetGroupPrompt
					if (!fn) return { kind: 'method_not_found' }
					const request = list[0] || await getChatRequest(groupId, undefined, inferChannelId(), { replicaUsername: owner })
					return resultOk(method, await fn(request))
				}
				case 'TweakPrompt': {
					const fn = world.interfaces?.chat?.TweakPrompt
					if (!fn) return resultOk(method, null)
					const request = list[0] || await getChatRequest(groupId, list[4], inferChannelId(), { replicaUsername: owner })
					await fn(request, list[1], list[2], Number(list[3]) || 0)
					return resultOk(method, null)
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
				case 'GetChatLogForViewer': {
					const fn = world.interfaces?.chat?.GetChatLogForViewer
					if (!fn) return { kind: 'method_not_found' }
					const viewer = list[1]
					const request = list[0] || await getChatRequest(
						groupId,
						viewer?.charname,
						inferChannelId() || viewer?.channelId || null,
						{ replicaUsername: owner },
					)
					return resultOk(method, await fn(request, viewer))
				}
				case 'GetChatLogForCharname': {
					const fn = world.interfaces?.chat?.GetChatLogForCharname
					if (!fn) return { kind: 'method_not_found' }
					const request = list[0] || await getChatRequest(groupId, list[1], inferChannelId(), { replicaUsername: owner })
					return resultOk(method, await fn(request, list[1]))
				}
				case 'GetCharReply': {
					const fn = world.interfaces?.chat?.GetCharReply
					if (!fn) return { kind: 'method_not_found' }
					const charname = String(list[1] || '')
					const request = list[0] || await getChatRequest(groupId, charname, inferChannelId(), { replicaUsername: owner })
					return resultOk(method, await fn(request, charname))
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
