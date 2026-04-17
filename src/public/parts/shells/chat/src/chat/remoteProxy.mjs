/** @typedef {import('../../../../../../decl/basedefs.ts').locale_t} locale_t */
/** @typedef {import('../../../../../../decl/basedefs.ts').single_lang_info_t} single_lang_info_t */
/** @typedef {import('../../../../../../decl/basedefs.ts').info_t} info_t */
/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReply_t} chatReply_t */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').single_part_prompt_t} single_part_prompt_t */

/** 标记 `createRemoteCharProxy` 生成的对象，供 `isRemoteProxy` 与后续 P2P 替换层识别。 */
export const REMOTE_PROXY_SYMBOL = Symbol.for('fount.remoteCharProxy')

/** 群 WebSocket `rpc_call` 定向字段名（与 `websocket.mjs` / 浏览器端一致）。 */
export const GROUP_RPC_TARGET_NODE_ID_KEY = 'targetNodeId'

/** 与 `randomUUID()` 输出一致的 UUID v4 正则（用于 `sourceHost` / `clientNodeId` 校验）。 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/**
 * 检查并归一化 JSON 边界值：不可序列化时抛错，避免跨节点静默丢字段。
 * @param {unknown} value 待校验值
 * @param {string} boundary 语义边界标签（用于错误信息）
 * @returns {any} 经过 JSON 语义归一化（stringify/parse）的值
 */
export function normalizeJsonBoundaryValue(value, boundary) {
	/** @type {WeakSet<object>} */
	const seen = new WeakSet()
	const pathStack = ['<root>']
	const encoded = JSON.stringify(value, function replacer(key, raw) {
		const k = typeof key === 'string' ? key : ''
		if (k) pathStack.push(k)
		try {
			if (raw === undefined)
				throw jsonBoundaryError(boundary, `undefined 不能跨 JSON 边界（路径: ${pathStack.join('.')})`)
			if (typeof raw === 'function')
				throw jsonBoundaryError(boundary, `function 不能按值传输（路径: ${pathStack.join('.')}）`)
			if (typeof raw === 'symbol')
				throw jsonBoundaryError(boundary, `symbol 不能跨 JSON 边界（路径: ${pathStack.join('.')}）`)
			if (typeof raw === 'bigint')
				throw jsonBoundaryError(boundary, `bigint 不能跨 JSON 边界（路径: ${pathStack.join('.')}）`)
			if (raw && typeof raw === 'object') {
				if (seen.has(raw))
					throw jsonBoundaryError(boundary, `检测到循环引用（路径: ${pathStack.join('.')}）`)
				seen.add(raw)
			}
			return raw
		}
		finally {
			if (k) pathStack.pop()
		}
	})
	if (encoded === undefined)
		throw jsonBoundaryError(boundary, '根值不可 JSON 序列化')
	return JSON.parse(encoded)
}

/**
 * @param {string} boundary 语义边界标签
 * @param {string} reason 失败原因
 * @returns {Error} 带 `JSON_SERIALIZATION_ERROR` code 的错误
 */
function jsonBoundaryError(boundary, reason) {
	const tag = classifyRpcBoundaryTag(boundary)
	const prefix = tag === 'args'
		? 'RPC 参数非法'
		: tag === 'result'
			? 'RPC 返回非法'
			: 'JSON 序列化失败'
	const err = new Error(`${prefix}（${boundary}）：${reason}`)
	err.code = tag === 'args'
		? 'RPC_INVALID_ARGUMENT'
		: tag === 'result'
			? 'RPC_INVALID_RESULT'
			: 'JSON_SERIALIZATION_ERROR'
	err.rpcBoundaryTag = tag
	return err
}

/**
 * 基于边界标签推断 RPC 语义：`*.args:*` 视为参数边界，`*.result:*` 视为返回边界。
 * 其余保持通用 JSON 错误，兼容历史调用方。
 * @param {string} boundary 边界标签
 * @returns {'args' | 'result' | 'json'} RPC 边界分类
 */
function classifyRpcBoundaryTag(boundary) {
	if (typeof boundary !== 'string' || !boundary) return 'json'
	if (boundary.includes('.args:') || boundary.includes('rpc.args:')) return 'args'
	if (boundary.includes('.result:') || boundary.includes('rpc.result:')) return 'result'
	return 'json'
}

/**
 * 从成员 `sourceHost` 字段解析群 WS 可用的 `targetNodeId`（连线端 `clientNodeId` 或 DAG 节点 UUID）。
 * 支持：整串为 UUID、`node:<uuid>`、任意串中嵌入的首个 UUID v4。
 * @param {string | undefined} sourceHost 成员资料中的来源节点标识
 * @returns {string | undefined} 解析到的节点 id；无法解析时为 undefined（走广播回退）
 */
export function resolveTargetNodeIdFromSourceHost(sourceHost) {
	if (typeof sourceHost !== 'string') return undefined
	const s = sourceHost.trim()
	if (!s) return undefined
	if (UUID_V4_RE.test(s)) return s.toLowerCase()
	const nodePref = /^node:([0-9a-f-]{36})$/iu.exec(s)
	if (nodePref && UUID_V4_RE.test(nodePref[1])) return nodePref[1].toLowerCase()
	const embedded = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu)
	if (embedded && UUID_V4_RE.test(embedded[0])) return embedded[0].toLowerCase()
	return undefined
}

/**
 * 为群 `rpc_call` 负载附加 `targetNodeId`（若能从 `sourceHost` 解析）。
 * @param {object} rpcPayload 已含 `type: 'rpc_call'` 等字段的对象（会被就地修改）
 * @param {string | undefined} sourceHost 成员来源节点标识
 * @returns {object} 与 `rpcPayload` 同一引用
 */
export function withDirectedGroupRpcTarget(rpcPayload, sourceHost) {
	const id = resolveTargetNodeIdFromSourceHost(sourceHost)
	if (id) rpcPayload[GROUP_RPC_TARGET_NODE_ID_KEY] = id
	return rpcPayload
}

/**
 * 接收端：是否应处理带定向字段的群 RPC（无字段或与本地 id 一致时处理）。
 * @param {unknown} msg 已解析 WS 消息
 * @param {string | undefined} localClientNodeId 本连接登记的 `clientNodeId`（浏览器 session 级 UUID）
 * @returns {boolean} true 表示应执行 RPC 逻辑
 */
export function shouldAcceptDirectedGroupRpc(msg, localClientNodeId) {
	if (!msg || typeof msg !== 'object') return true
	const tid = /** @type {{ [k: string]: unknown }} */ msg[GROUP_RPC_TARGET_NODE_ID_KEY]
	if (tid == null || tid === '') return true
	if (typeof tid !== 'string') return false
	if (typeof localClientNodeId !== 'string' || !localClientNodeId) return false
	return tid === localClientNodeId
}

/**
 * 校验可作为群 RPC 连线端身份（`group_ws_rpc_identity.clientNodeId`）的 UUID v4 串。
 * @param {unknown} id 待校验值
 * @returns {boolean} 合法时为 true
 */
export function isValidGroupRpcClientNodeId(id) {
	return typeof id === 'string' && UUID_V4_RE.test(id.trim())
}

/**
 * 跨节点 RPC 发送策略：尝试联邦房间（预留 P2P），当前无对等映射时回退为仅附带定向字段的 WS 负载。
 *
 * @param {string | undefined} sourceHost 成员来源节点标识
 * @param {string} username 群主用户名（联邦房间键）
 * @param {string} chatId 群组 id
 * @param {object} rpcPayload `rpc_call` 形状的对象
 * @returns {Promise<{ mode: 'broadcast' | 'p2p', payload: object }>} 发送模式与应经 WS 转发的负载
 */
export async function sendRpcToNode(sourceHost, username, chatId, rpcPayload) {
	// 发送前再次过 JSON 边界，确保不可序列化值直接报错而非静默丢弃。
	const payload = normalizeJsonBoundaryValue(withDirectedGroupRpcTarget({ ...rpcPayload }, sourceHost), 'rpc.args:sendRpcToNode')
	const { ensureFederationRoom } = await import('./federation.mjs')
	const slot = await ensureFederationRoom(username, chatId)
	if (!slot?.room) return { mode: 'broadcast', payload }

	const targetNodeId = resolveTargetNodeIdFromSourceHost(sourceHost)
	if (targetNodeId) {
		const peerId = slot.getPeerIdByNodeId(targetNodeId)
		if (peerId) 
			try {
				slot.sendToPeer(peerId, 'char_rpc', payload)
				return { mode: 'p2p', payload }
			}
			catch (e) {
				// 参数/边界错误必须冒泡，防止上层误以为已成功降级。
				if (e?.code === 'RPC_INVALID_ARGUMENT' || e?.code === 'RPC_INVALID_RESULT' || e?.code === 'JSON_SERIALIZATION_ERROR')
					throw e
				console.error('sendRpcToNode p2p failed, fallback to broadcast:', e)
			}
		
	}
	return { mode: 'broadcast', payload }
}

/**
 * 构造与本地 `CharAPI_t` 同形的远端 char 桩；`sourceHost` 用于解析群 WS `targetNodeId` 定向路由。
 * @param {string} memberId 远端成员标识（如 `username:charname`）
 * @param {string} [sourceHost] 远端节点标识（UUID、`node:<uuid>` 或含 UUID 的 host 串，见 `resolveTargetNodeIdFromSourceHost`）
 * @param {{ info?: boolean, config?: boolean, chat?: boolean }} [interfaces] 某键为 `false` 时不挂载对应 `interfaces` 分组
 * @param {null | ((method: string, args: unknown[]) => Promise<unknown>)} [rpcCall] 由宿主注入的 WS RPC
 * @returns {CharAPI_t & { [typeof REMOTE_PROXY_SYMBOL]: { memberId: string, sourceHost?: string, targetNodeId?: string } }} 可替换为真实 RPC 的代理对象
 */
export function createRemoteCharProxy(memberId, sourceHost, interfaces = {}, rpcCall = null) {
	const useInfo = interfaces.info !== false
	const useConfig = interfaces.config !== false
	const useChat = interfaces.chat !== false

	/** @type {Record<locale_t, single_lang_info_t>} */
	const emptyInfo = {}

	/** @type {CharAPI_t['interfaces']} */
	const iface = {}

	/**
	 * UpdateInfo 本地降级：用空 single_lang_info_t 填充每个请求区域。
	 * @param {Record<locale_t, single_lang_info_t>} baseInfo 基础 info 对象
	 * @param {locale_t[]} locales 需要填充的区域列表
	 * @returns {Promise<info_t>} 带空占位的 info 对象
	 */
	async function localUpdateInfoFallback(baseInfo, locales) {
		const out = normalizeJsonBoundaryValue(baseInfo, 'localUpdateInfoFallback.baseInfo')
		for (const loc of locales || [])
			out[loc] = {
				name: '',
				avatar: '',
				description: '',
				description_markdown: '',
				version: '',
				author: '',
				home_page: '',
				issue_page: '',
				tags: [],
			}

		return out
	}

	/**
	 * 统一远端调用边界：参数/返回值都按 JSON 语义处理，任何非法值立刻抛错。
	 * @param {string} method RPC 方法名
	 * @param {unknown[]} args 参数列表
	 * @returns {Promise<unknown>} 经 JSON 边界校验后的返回值
	 */
	async function invokeRemote(method, args) {
		if (!rpcCall) throw remoteUnavailableError(method)
		const jsonArgs = normalizeJsonBoundaryValue(args, `rpc.args:${method}`)
		const raw = await rpcCall(method, jsonArgs)
		return normalizeJsonBoundaryValue(raw ?? null, `rpc.result:${method}`)
	}

	/**
	 * 递归将接口描述对象转为远端代理：
	 * - function -> async RPC 代理（参数/返回均走 JSON 边界）
	 * - object -> 递归处理
	 * - 其他值 -> JSON 归一化后的静态值
	 * @param {object} shape 接口描述对象
	 * @param {string[]} path 当前路径
	 * @returns {object} 递归生成的代理对象
	 */
	function materializeInterfaceShape(shape, path) {
		/** @type {Record<string, unknown>} */
		const out = {}
		for (const [k, v] of Object.entries(shape)) {
			const next = [...path, k]
			if (typeof v === 'function') {
				const methodName = next.join('.')
				/**
				 * @param {...unknown} argv 远端调用参数
				 * @returns {Promise<unknown>} 远端返回值（经 JSON 边界校验）
				 */
				out[k] = async (...argv) => await invokeRemote(methodName, argv)
				continue
			}
			if (v && typeof v === 'object' && !Array.isArray(v)) {
				out[k] = materializeInterfaceShape(/** @type {object} */ v, next)
				continue
			}
			out[k] = normalizeJsonBoundaryValue(v, `interface.value:${next.join('.')}`)
		}
		return out
	}

	if (useInfo)
		iface.info = {
			/**
			 * 请求远端更新各区域 info；失败时降级为本地空占位。
			 * @param {locale_t[]} locales 需要更新的区域列表
			 * @returns {Promise<info_t>} 各区域的 info 对象
			 */
			UpdateInfo: async locales => {
				if (!rpcCall) return localUpdateInfoFallback(emptyInfo, locales)
				const r = await invokeRemote('UpdateInfo', [locales])
				return /** @type {info_t} */ r ?? await localUpdateInfoFallback(emptyInfo, locales)
			},
		}

	if (useConfig)
		iface.config = {
			/**
			 * 获取远端 char 配置数据；无 RPC 时返回空对象。
			 * @returns {Promise<object>} 配置数据
			 */
			GetData: async () => {
				if (!rpcCall) return {}
				return await invokeRemote('GetData', []) ?? {}
			},
			/**
			 * 写入远端 char 配置；无 RPC 时抛出不可用错误。
			 * @param {object} data 要写入的配置对象
			 * @returns {Promise<void>}
			 */
			SetData: async data => {
				await invokeRemote('SetData', [data])
			},
		}

	if (useChat)
		iface.chat = {
			/**
			 * 获取远端 char 的问候语；无 RPC 时返回 null。
			 * @param {chatReplyRequest_t} _arg 聊天回复请求
			 * @param {number} _index 问候语索引
			 * @returns {Promise<chatReply_t | null>} 问候语回复或 null
			 */
			GetGreeting: async (_arg, _index) => {
				if (!rpcCall) return null
				const r = await invokeRemote('GetGreeting', [_arg, _index])
				return r == null ? null : r
			},
			/**
			 * 获取远端 char 的群问候语；无 RPC 时返回 null。
			 * @param {chatReplyRequest_t} _arg 聊天回复请求
			 * @param {number} _index 问候语索引
			 * @returns {Promise<chatReply_t | null>} 群问候语回复或 null
			 */
			GetGroupGreeting: async (_arg, _index) => {
				if (!rpcCall) return null
				const r = await invokeRemote('GetGroupGreeting', [_arg, _index])
				return r == null ? null : r
			},
			/**
			 * 获取远端 char 的 prompt 片段；无 RPC 时返回空片段。
			 * @param {chatReplyRequest_t} _arg 聊天回复请求
			 * @returns {Promise<single_part_prompt_t>} prompt 片段
			 */
			GetPrompt: async _arg => {
				if (!rpcCall) return remoteStubEmptyPrompt()
				return await invokeRemote('GetPrompt', [_arg]) ?? remoteStubEmptyPrompt()
			},
			/**
			 * 让远端 char 微调 prompt；无 RPC 时直接返回。
			 * @param {chatReplyRequest_t} _arg 聊天回复请求
			 * @param {prompt_struct_t} _promptStruct 完整 prompt 结构
			 * @param {single_part_prompt_t} _myPrompt 本角色的 prompt 片段
			 * @param {number} _detailLevel 详细程度
			 * @returns {Promise<void>}
			 */
			TweakPrompt: async (_arg, _promptStruct, _myPrompt, _detailLevel) => {
				if (!rpcCall) return
				await invokeRemote('TweakPrompt', [_arg, _promptStruct, _myPrompt, _detailLevel])
			},
			/**
			 * 获取远端 char 为他人准备的 prompt；无 RPC 时返回空片段。
			 * @param {chatReplyRequest_t} _arg 聊天回复请求
			 * @returns {Promise<single_part_prompt_t>} prompt 片段
			 */
			GetPromptForOther: async _arg => {
				if (!rpcCall) return remoteStubEmptyPrompt()
				return await invokeRemote('GetPromptForOther', [_arg]) ?? remoteStubEmptyPrompt()
			},
			/**
			 * 让远端 char 微调他人 prompt；无 RPC 时直接返回。
			 * @param {chatReplyRequest_t} _arg 聊天回复请求
			 * @param {prompt_struct_t} _promptStruct 完整 prompt 结构
			 * @param {single_part_prompt_t} _myPrompt 本角色为他人准备的 prompt 片段
			 * @param {number} _detailLevel 详细程度
			 * @returns {Promise<void>}
			 */
			TweakPromptForOther: async (_arg, _promptStruct, _myPrompt, _detailLevel) => {
				if (!rpcCall) return
				await invokeRemote('TweakPromptForOther', [_arg, _promptStruct, _myPrompt, _detailLevel])
			},
			/**
			 * 获取远端 char 的完整回复；无 RPC 时返回 null（表示该角色不参与本轮）。
			 * @param {chatReplyRequest_t} _arg 聊天回复请求
			 * @returns {Promise<chatReply_t | null>} 回复对象或 null
			 */
			GetReply: async _arg => {
				if (!rpcCall) return null
				const r = await invokeRemote('GetReply', [_arg])
				return r == null ? null : r
			},
			/**
			 * 通知远端 char 有新消息，由其决定是否发言；无 RPC 时默认不发言。
			 * @param {{ chatReplyRequest: chatReplyRequest_t, onlineCount: number }} _event 新消息事件上下文
			 * @returns {Promise<boolean>} true 表示该 char 想要发言
			 */
			onMessage: async _event => {
				if (!rpcCall) return false
				return Boolean(await invokeRemote('onMessage', [_event]))
			},
			/**
			 * 通知远端 char 某条消息被编辑；无 RPC 时返回基于 edited 的占位回复。
			 * @param {{ index: number, original: chatLogEntry_t, edited: chatReply_t, chat_log: chatLogEntry_t[], extension?: object }} arg 编辑参数
			 * @returns {Promise<chatReply_t>} 编辑后的回复
			 */
			MessageEdit: async arg => {
				if (!rpcCall) return remoteStubReplyFromEdited(arg.edited)
				return await invokeRemote('MessageEdit', [arg]) ?? remoteStubReplyFromEdited(arg.edited)
			},
			/**
			 * 通知远端 char 消息编辑中（实时预览）；无 RPC 时静默忽略。
			 * @param {{ index: number, original: chatLogEntry_t, edited: chatReply_t, chat_log: chatLogEntry_t[], extension?: object }} _arg 编辑中参数
			 * @returns {Promise<void>}
			 */
			MessageEditing: async _arg => {
				if (!rpcCall) return
				await invokeRemote('MessageEditing', [_arg])
			},
			/**
			 * 通知远端 char 某条消息被删除；无 RPC 时静默忽略。
			 * @param {{ index: number, chat_log: chatLogEntry_t[], chat_entry: chatLogEntry_t, extension?: object }} _arg 删除参数
			 * @returns {Promise<void>}
			 */
			MessageDelete: async _arg => {
				if (!rpcCall) return
				await invokeRemote('MessageDelete', [_arg])
			},
		}

	// 若调用方提供了接口结构对象，则按“每个 value”规则递归处理并覆盖默认桩。
	if (useInfo && interfaces.info && typeof interfaces.info === 'object')
		iface.info = materializeInterfaceShape(interfaces.info, ['info'])
	if (useConfig && interfaces.config && typeof interfaces.config === 'object')
		iface.config = materializeInterfaceShape(interfaces.config, ['config'])
	if (useChat && interfaces.chat && typeof interfaces.chat === 'object')
		iface.chat = materializeInterfaceShape(interfaces.chat, ['chat'])

	/** @type {CharAPI_t} */
	const proxy = {
		// info 仅保留 JSON 语义数据，避免对象共享造成边界歧义。
		info: normalizeJsonBoundaryValue(emptyInfo, 'remoteProxy.info'),
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
 * 判断对象是否为 `createRemoteCharProxy` 生成的远端桩。
 * @param {unknown} charObj 待检测对象
 * @returns {boolean} 为远端桩时为 true
 */
export function isRemoteProxy(charObj) {
	return typeof charObj === 'object' && charObj !== null && REMOTE_PROXY_SYMBOL in charObj
}

/**
 * 构造表示远端不可用的错误，供真实 RPC 层复用。
 * @param {string} [operation] 可选的操作名，用于拼接错误信息
 * @returns {Error} 带 `code === 'REMOTE_UNAVAILABLE'` 的错误实例
 */
export function remoteUnavailableError(operation) {
	const suffix = operation ? `: ${operation}` : ''
	const err = new Error(`远端不可用${suffix}`)
	err.code = 'REMOTE_UNAVAILABLE'
	return err
}

/**
 * @returns {single_part_prompt_t} 空提示片段
 */
function remoteStubEmptyPrompt() {
	return { text: [], additional_chat_log: [], extension: {} }
}

/**
 * @param {chatReply_t | undefined} edited 编辑后的回复草稿
 * @returns {chatReply_t} 尽量保留字段的占位回复
 */
function remoteStubReplyFromEdited(edited) {
	if (!edited) return { content: '', files: [] }
	return {
		name: edited.name,
		avatar: edited.avatar,
		content: edited.content ?? '',
		content_for_show: edited.content_for_show,
		content_for_edit: edited.content_for_edit,
		files: edited.files,
		logContextBefore: edited.logContextBefore,
		logContextAfter: edited.logContextAfter,
		charVisibility: edited.charVisibility,
		visibility: edited.visibility,
		extension: edited.extension,
	}
}
