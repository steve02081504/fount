/**
 * 统一异步任务：把 `extension.asyncTask` 的工具条目渲染为带状态的卡片，订阅实时事件并查询进行中任务。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import * as api from './endpoints.mjs'
import { iconElement, icons } from './icons.mjs'
import { elements, store } from './store.mjs'
import { openSubAgent, subAgentChatId } from './subagents.mjs'

/** 运行中的状态集合（显示转圈）。 */
const ACTIVE_STATES = new Set(['running', 'start'])

/** 各状态对应的图标。 */
const STATE_ICON = {
	running: icons.loading,
	done: icons.checkCircle,
	failed: icons.alertCircle,
	idle: icons.clock,
}

/** 已知任务类型的图标（未列出者按 shell 名 / 通用时钟兜底）。 */
const KIND_ICON = {
	subagent: icons.robot,
	js: icons.javascript,
}

/** shell 类任务类型（图标用终端）。 */
const SHELL_KINDS = new Set(['pwsh', 'powershell', 'bash', 'sh', 'zsh', 'fish', 'cmd', 'nu', 'nushell'])

/**
 * 取任务类型的图标。
 * @param {string} kind - 任务类型。
 * @returns {string} Iconify 图标 id。
 */
function kindIcon(kind) {
	return KIND_ICON[kind] ?? (SHELL_KINDS.has(kind) ? icons.terminal : icons.clock)
}

/**
 * 规范化任务状态（缺省为 idle，避免历史条目误转圈）。
 * @param {object} [task] - 任务摘要。
 * @param {string} [fallback] - 兜底状态。
 * @returns {string} 状态。
 */
function taskState(task, fallback = 'idle') {
	return task?.state || fallback
}

/**
 * 状态文案。
 * @param {string} state - 状态。
 * @returns {string} 文案。
 */
function stateLabel(state) {
	return geti18n(`code.asyncTasks.state.${state === 'start' ? 'running' : state}`)
}

/**
 * 按状态刷新单个卡片（图标 / 转圈 / 文案），状态与类型均未变则跳过。
 * @param {HTMLElement} card - 卡片。
 * @param {object} [task] - 任务摘要。
 * @param {object} [meta] - 兜底元数据（来自条目扩展）。
 * @returns {void}
 */
function applyAsyncTaskState(card, task, meta = {}) {
	const kind = task?.kind ?? meta.kind ?? ''
	const state = taskState(task)
	const working = ACTIVE_STATES.has(state)
	card.dataset.state = state
	card.classList.toggle('is-working', working)
	const label = task?.label ?? meta.label ?? ''
	card.title = geti18n('code.asyncTasks.open', { label: label || kind })
	if (working) card.setAttribute('aria-label', geti18n('code.asyncTasks.working', { kind }))

	const iconKey = `${kind}:${state}:${working}`
	if (card.dataset.iconKey !== iconKey) {
		card.dataset.iconKey = iconKey
		const holder = card.querySelector('.code-async-card-icon')
		if (holder) {
			holder.replaceChildren(iconElement(kindIcon(kind), { size: 15 }))
			void svgInliner(holder)
		}
	}
	const status = card.querySelector('.code-async-card-status')
	if (status) status.textContent = stateLabel(state)
}

/**
 * 构建异步任务卡片（工具条目携带 `extension.asyncTask` 时使用）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 卡片（子代理任务可点击跳转 Agent Studio，其余为状态块）。
 */
export function asyncTaskCardElement(entry) {
	const meta = entry.extension?.asyncTask ?? {}
	const id = meta.id
	const runId = entry.extension?.subAgent?.runId
	const card = document.createElement(runId ? 'button' : 'div')
	if (runId) card.type = 'button'
	card.className = 'code-async-card'
	card.dataset.asyncTaskId = id
	card.dataset.asyncTaskKind = meta.kind || ''

	const icon = document.createElement('span')
	icon.className = 'code-async-card-icon'
	const kind = document.createElement('span')
	kind.className = 'code-async-card-kind'
	kind.textContent = meta.kind || ''
	const label = document.createElement('span')
	label.className = 'code-async-card-label'
	label.setAttribute('user-content', '')
	label.textContent = meta.label || geti18n('code.asyncTasks.title')
	const status = document.createElement('span')
	status.className = 'code-async-card-status'
	card.append(icon, kind, label, status)

	if (runId) card.addEventListener('click', () => openSubAgent(runId))
	applyAsyncTaskState(card, store.asyncTasks.get(id), meta)
	return card
}

/**
 * 刷新消息流中所有异步任务卡片的状态。
 * @returns {void}
 */
export function updateAsyncTaskCards() {
	for (const card of elements.messages.querySelectorAll('.code-async-card[data-async-task-id]'))
		applyAsyncTaskState(card, store.asyncTasks.get(card.dataset.asyncTaskId), { kind: card.dataset.asyncTaskKind })
}

/**
 * 处理服务端 `async-task` 实时事件（仅当前会话）。
 * @param {object} payload - 事件负载。
 * @returns {void}
 */
export function handleAsyncTaskEvent(payload) {
	if (!payload?.id) return
	if (payload.owner?.chatName && payload.owner.chatName !== subAgentChatId()) return
	store.asyncTasks.set(payload.id, {
		...store.asyncTasks.get(payload.id),
		...payload,
		state: payload.state || (payload.phase === 'settle' ? 'done' : 'running'),
	})
	updateAsyncTaskCards()
}

/**
 * 拉取当前会话进行中的异步任务（节流；实时事件优先，仅补充运行中集合）。
 * @param {{force?: boolean}} [options] - force 为 true 时忽略节流。
 * @returns {Promise<void>}
 */
export async function refreshAsyncTasks({ force = false } = {}) {
	const chatId = subAgentChatId()
	if (!chatId) {
		store.asyncTasks.clear()
		updateAsyncTaskCards()
		return
	}
	const previousChatId = store.asyncTaskFetch?.chatId
	if (!force && previousChatId === chatId && Date.now() - store.asyncTaskFetch.at < 3000) return
	if (previousChatId && previousChatId !== chatId) store.asyncTasks.clear()
	store.asyncTaskFetch = { chatId, at: Date.now() }
	try {
		const { tasks } = await api.getAsyncTasks(chatId)
		if (subAgentChatId() !== chatId) return
		const next = new Map(store.asyncTasks)
		for (const task of tasks) next.set(task.id, { ...store.asyncTasks.get(task.id), ...task, state: 'running' })
		store.asyncTasks = next
		updateAsyncTaskCards()
	}
	catch { /* 查询失败保留本地兜底状态 */ }
}
