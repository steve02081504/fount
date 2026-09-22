/**
 * 统一异步任务：把 `extension.asyncTask` 的工具条目渲染为带状态的卡片，订阅实时事件并查询进行中任务。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

import * as api from './endpoints.mjs'
import { icons } from './icons.mjs'
import { createRunCard, createRunCardFeed, paintRunCard, registerRunCardFeed } from './runCards.mjs'
import { subAgentChatId } from './subagents.mjs'

/** 运行中的状态集合（显示转圈）。 */
const ACTIVE_STATES = new Set(['running', 'start'])

/** 各状态对应的图标。 */
const STATE_ICON = {
	running: icons.loading,
	done: icons.checkCircle,
	failed: icons.alertCircle,
	idle: icons.timerSand,
}

/** 已知任务类型的图标（未列出者按 shell 名 / 通用计时兜底）。 */
const KIND_ICON = {
	subagent: icons.robot,
	js: icons.javascript,
}

/** shell 类任务类型（图标用终端）。 */
const SHELL_KINDS = new Set(['pwsh', 'powershell', 'bash', 'sh', 'zsh', 'fish', 'cmd', 'nu', 'nushell'])

/** 异步任务状态 → i18n 键（`start` 与 `running` 同义；未知状态回落 idle，避免缺键告警）。 */
const ASYNC_STATE_I18N = {
	start: 'code.asyncTasks.state.running',
	running: 'code.asyncTasks.state.running',
	done: 'code.asyncTasks.state.done',
	failed: 'code.asyncTasks.state.failed',
	unknown: 'code.asyncTasks.state.unknown',
	idle: 'code.asyncTasks.state.idle',
}

/**
 * 异步任务状态文案（实时卡片与结构化任务行共用）。
 * @param {string} state - 状态。
 * @returns {string} 文案。
 */
export function asyncStateLabel(state) {
	return geti18n(ASYNC_STATE_I18N[state] ?? ASYNC_STATE_I18N.idle)
}

/**
 * 取任务类型的图标。
 * @param {string} kind - 任务类型。
 * @returns {string} Iconify 图标 id。
 */
function kindIcon(kind) {
	return KIND_ICON[kind] ?? (SHELL_KINDS.has(kind) ? icons.terminal : icons.timerSand)
}

/**
 * 规范化任务状态（缺省为 idle，避免历史条目误转圈）。
 * @param {object} [task] - 任务摘要。
 * @returns {string} 状态。
 */
function taskState(task) {
	return task?.state || 'idle'
}

/**
 * 按状态刷新单个卡片（图标 / 转圈 / 文案）。
 * @param {HTMLElement} card - 卡片。
 * @param {object} [task] - 任务摘要。
 * @param {object} [meta] - 兜底元数据（来自条目扩展）。
 * @returns {void}
 */
function applyAsyncTaskState(card, task, meta = {}) {
	const kind = task?.kind ?? meta.kind ?? ''
	const state = taskState(task)
	const working = ACTIVE_STATES.has(state)
	const label = task?.label ?? meta.label ?? ''
	paintRunCard(card, {
		state,
		working,
		icon: kindIcon(kind),
		statusText: asyncStateLabel(state),
		title: geti18n('code.asyncTasks.open', { label: label || kind }),
		ariaLabel: working ? geti18n('code.asyncTasks.working', { kind }) : null,
	})
}

const feed = createRunCardFeed({
	cardSelector: '.code-async-card[data-async-task-id]',
	/**
	 * 从卡片取任务 id。
	 * @param {HTMLElement} card - 卡片。
	 * @returns {string} 任务 id。
	 */
	cardId: card => card.dataset.asyncTaskId,
	chatId: subAgentChatId,
	/**
	 * 从事件负载取任务 id。
	 * @param {object} payload - 事件负载。
	 * @returns {string} 任务 id。
	 */
	eventId: payload => payload.id,
	/**
	 * 从事件负载取 chat id。
	 * @param {object} payload - 事件负载。
	 * @returns {string} chat id。
	 */
	eventChatId: payload => payload.owner?.chatName,
	/**
	 * 合并一条实时任务事件（结算相位折算为终态）。
	 * @param {Map} states - 状态表。
	 * @param {object} payload - 事件负载。
	 * @returns {void}
	 */
	ingest: (states, payload) => states.set(payload.id, {
		...states.get(payload.id),
		...payload,
		state: payload.state || (payload.phase === 'settle' ? 'done' : 'running'),
	}),
	/**
	 * 合并一批进行中任务（刷新结果一律视为运行中）。
	 * @param {Map} states - 状态表。
	 * @param {object[]} tasks - 任务摘要列表。
	 * @returns {void}
	 */
	merge: (states, tasks) => {
		for (const task of tasks ?? []) states.set(task.id, { ...states.get(task.id), ...task, state: 'running' })
	},
	/**
	 * 拉取当前会话进行中的任务。
	 * @param {string} chatId - 会话 chat id。
	 * @returns {Promise<object[]>} 任务摘要列表。
	 */
	fetch: chatId => api.getAsyncTasks(chatId).then(data => data.tasks ?? []),
	/**
	 * 重绘单张任务卡。
	 * @param {HTMLElement} card - 卡片。
	 * @param {object} task - 任务摘要（空表示无实时状态，走卡片兜底）。
	 * @returns {void}
	 */
	paint: (card, task) => applyAsyncTaskState(card, task, { kind: card.dataset.asyncTaskKind }),
})

registerRunCardFeed(feed)

/**
 * 构建异步任务卡片（工具条目携带 `extension.asyncTask` 时使用）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 卡片（状态展示，不响应点击）。
 */
export function asyncTaskCardElement(entry) {
	const meta = entry.extension?.asyncTask ?? {}
	const card = createRunCard({
		className: 'code-run-card code-async-card',
		kindClass: 'code-async-card-kind',
		kind: meta.kind || '',
		label: meta.label || geti18n('code.asyncTasks.title'),
		dataset: { asyncTaskId: meta.id, asyncTaskKind: meta.kind || '' },
	})
	applyAsyncTaskState(card, feed.get(meta.id), meta)
	return card
}

/**
 * 处理服务端 `async-task` 实时事件（仅当前会话）。
 * @param {object} payload - 事件负载。
 * @returns {void}
 */
export function handleAsyncTaskEvent(payload) {
	feed.handle(payload)
}
