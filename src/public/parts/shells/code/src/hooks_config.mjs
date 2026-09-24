/**
 * code shell 工作区钩子的纯配置逻辑：条目规整与事件环境变量构建（无 IO，便于单测）。
 */

/** 同一会话连续自动重生成的默认上限。 */
export const MAX_REGEN_ATTEMPTS = 3

/**
 * 规整钩子配置：事件名 → 条目数组（字符串或 `{command,...}`）。
 * @param {object} config - 工作区配置。
 * @returns {{agentStart: object[], agentFinish: object[], agentsIdle: object[]}} 规整后的钩子。
 */
export function normalizeHooks(config) {
	const hooks = config?.hooks && typeof config.hooks === 'object' ? config.hooks : {}
	return {
		agentStart: normalizeEntries(hooks.agentStart),
		agentFinish: normalizeEntries(hooks.agentFinish),
		agentsIdle: normalizeEntries(hooks.agentsIdle),
	}
}

/**
 * 规整单个事件的条目列表。
 * @param {unknown} value - 原始值。
 * @returns {object[]} 规整后的条目（含 `command`）。
 */
export function normalizeEntries(value) {
	if (!value) return []
	const list = Array.isArray(value) ? value : [value]
	return list
		.map(entry => typeof entry === 'string' ? { command: entry } : entry)
		.filter(entry => entry && typeof entry.command === 'string' && entry.command)
}

/**
 * 由事件上下文构建 `FOUNT_CODE_*` 环境变量。
 * @param {object} ctx - 事件上下文。
 * @returns {Record<string, string>} 环境变量。
 */
export function buildEnv(ctx) {
	return {
		FOUNT_CODE_EVENT: ctx.event ?? '',
		FOUNT_CODE_KIND: ctx.kind ?? '',
		FOUNT_CODE_USERNAME: ctx.username ?? '',
		FOUNT_CODE_SESSION_ID: ctx.sessionId ?? '',
		FOUNT_CODE_CONVERSATION_ID: ctx.conversationId ?? '',
		FOUNT_CODE_WORKSPACE_ID: ctx.workspaceId ?? '',
		FOUNT_CODE_WORKSPACE_PATH: ctx.path ?? '',
		FOUNT_CODE_MACHINE: String(ctx.machine ?? '0'),
		FOUNT_CODE_CHAR: ctx.char ?? '',
		FOUNT_CODE_GENERATION_ID: ctx.generationId ?? '',
		FOUNT_CODE_RUN_ID: ctx.runId ?? '',
		FOUNT_CODE_SUCCESS: ctx.success ?? '',
		FOUNT_CODE_ERROR: ctx.error ?? '',
		FOUNT_CODE_ATTEMPT: String(ctx.attempt ?? 0),
	}
}
