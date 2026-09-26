/**
 * 【文件】src/request_record.mjs — Agent Studio 主动请求记录 API
 * 【职责】供发起 AI 请求的一方（角色模板、sub-agent 运行时等）在每次 `StructCall` 前后主动调用，把逐轮 prompt 记录进生成历史。
 * 【原理】以 `args` 对象为键在 WeakMap 中保存本次生成状态；`beginPromptRequest` 在调用前投影 prompt（含消息 id），
 *   `finishPromptRequest` 标记该轮结束，`finishGeneration` 在生成收尾时用 `buildDialogue` 复原对话并落盘一次记录。
 *   会话身份完全来自 `args.chat_id`（由 shell 提供）；缺失时 `console.error` 并置为禁用，绝不影响角色生成。
 *   只有主动调用本 API 的请求才会产生记录；未调用者不进入生成历史。
 * 【关联】generation_history.mjs（落盘）、public/shared/dialogueReplay.mjs（复原）、snapshot.mjs（投影）、各角色模板与 sub-agent runtime。
 */
/** @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { formatErrorMessage } from '../../../../../scripts/error_format.mjs'
import { createPromptRequestRecorder } from '../../chat/src/prompt_struct/snapshot.mjs'
import { buildDialogue } from '../public/shared/dialogueReplay.mjs'

/**
 * 每次生成的记录会话。
 * @typedef {object} recordSession_t
 * @property {boolean} disabled
 * @property {string} username
 * @property {string} chatId
 * @property {string} charId
 * @property {string} [charname]
 * @property {string} generationId
 * @property {string} [parentId]
 * @property {string} source
 * @property {number} startedAt
 * @property {ReturnType<typeof createPromptRequestRecorder>} recorder
 * @property {object} [subAgent]
 * @property {object} [metadata]
 */

/** 生成会话（以请求对象为键，避免并发生成互相串记录）。 @type {WeakMap<object, recordSession_t>} */
const sessions = new WeakMap()

/**
 * 取（或惰性创建）本次生成的记录会话。
 * @param {chatReplyRequest_t} args 请求
 * @returns {recordSession_t} 记录会话
 */
function getSession(args) {
	let session = sessions.get(args)
	if (session) return session
	const chatId = args?.chat_id
	if (typeof chatId !== 'string' || !chatId || !args?.username) {
		console.error('agent_studio: 请求缺少 args.chat_id 或 args.username，跳过生成记录（由请求构造方负责提供稳定且频道唯一的会话标识）')
		session = { disabled: true }
		sessions.set(args, session)
		return session
	}
	const studio = args.extension?.agentStudio ?? {}
	session = {
		disabled: false,
		username: args.username,
		chatId,
		charId: args.char_id,
		charname: args.Charname,
		generationId: args.extension?.generationId ?? crypto.randomUUID(),
		parentId: studio.parentId ?? null,
		source: studio.source ?? 'shells/chat',
		startedAt: Date.now(),
		recorder: createPromptRequestRecorder(),
		subAgent: studio.subAgent,
		metadata: studio.metadata,
	}
	sessions.set(args, session)
	return session
}

/**
 * 每次 AI 源调用前记录一轮请求快照。
 * @param {chatReplyRequest_t} args 请求
 * @param {prompt_struct_t} promptStruct 提示结构
 * @param {{ model?: string, aiSource?: import('../../../../../decl/AIsource.ts').AIsource_t }} [extra] 额外字段（提供 aiSource 时用其 `BuildPrompt` 生成缓存快照文本）
 * @returns {Promise<{ session: recordSession_t, entry: object } | null>} 轮次句柄（禁用时为 null）
 */
export async function beginPromptRequest(args, promptStruct, extra = {}) {
	let session
	try {
		session = getSession(args)
	}
	catch (error) {
		console.warn('agent_studio: 记录请求失败', error)
		return null
	}
	if (session.disabled) return null
	const entry = await session.recorder.record(promptStruct, { model: extra.model, aiSource: extra.aiSource })
	return { session, entry }
}

/**
 * 标记一轮请求结束。
 * @param {{ session: recordSession_t, entry: object } | null} handle 轮次句柄
 * @param {{ error?: unknown, output?: string }} [outcome] 结果（模型原始输出与错误信息）
 * @returns {void}
 */
export function finishPromptRequest(handle, outcome = {}) {
	if (!handle?.entry) return
	handle.entry.finishedAt = Date.now()
	if (typeof outcome.output === 'string') handle.entry.output = outcome.output
	if (outcome.error)
		handle.entry.error = {
			name: outcome.error?.name,
			message: formatErrorMessage(outcome.error),
		}
}

/**
 * 收集本次生成的落盘记录（不写入）；未记录时返回 null。
 * @param {chatReplyRequest_t} args 请求
 * @param {{ response?: unknown, error?: { name?: string, message?: string }, metadata?: object, finishedAt?: number }} [payload] 收尾信息
 * @returns {object | null} 记录
 */
export function collectGenerationRecord(args, payload = {}) {
	let session
	try {
		session = getSession(args)
	}
	catch (error) {
		console.warn('agent_studio: 收集生成记录失败', error)
		return null
	}
	if (session.disabled) return null
	const requests = session.recorder.requests
	const dialogue = buildDialogue(requests, {
		response: payload.response,
		responseId: `${session.generationId}:final`,
		responseName: session.charname,
		responseUid: args.CharUid ?? 'char',
	})
	return {
		id: session.generationId,
		parentId: session.parentId,
		charId: session.charId,
		charname: session.charname,
		subAgent: session.subAgent,
		chatId: session.chatId,
		conversationId: session.chatId,
		source: session.source,
		startedAt: session.startedAt,
		finishedAt: payload.finishedAt ?? Date.now(),
		model: requests.at(-1)?.model ?? null,
		requests,
		requestCount: requests.length,
		dialogue,
		response: payload.response,
		metadata: { ...session.metadata, ...payload.metadata },
		error: payload.error,
	}
}

/**
 * 生成收尾：复原对话并落盘一条记录（尽力而为，失败不影响主流程）。
 * @param {chatReplyRequest_t} args 请求
 * @param {{ response?: unknown, error?: { name?: string, message?: string }, metadata?: object, finishedAt?: number }} [payload] 收尾信息
 * @returns {Promise<object | null>} 落盘记录；未记录或失败时为 null
 */
export async function finishGeneration(args, payload = {}) {
	const record = collectGenerationRecord(args, payload)
	if (!record) return null
	try {
		const { recordGeneration } = await import('./generation_history.mjs')
		return await recordGeneration(args.username, record)
	}
	catch (error) {
		console.warn('agent_studio: recordGeneration 失败', error)
		return null
	}
}
