/**
 * 子代理运行：把 `sub-agent` 插件的工具条目渲染为带状态的按钮，订阅实时事件并深链到 Agent Studio 内部对话页。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import * as api from './endpoints.mjs'
import { iconElement, icons } from './icons.mjs'
import { elements, store } from './store.mjs'

/** Agent Studio 深链前缀（`#subagent/<runId>`）。 */
const AGENT_STUDIO_SUBAGENT_URL = '/parts/shells:agent_studio/#subagent/'

/** 运行中的状态集合（显示转圈）。 */
const ACTIVE_STATES = new Set(['running', 'summarizing'])

/** 各状态对应的图标。 */
const STATE_ICON = {
	running: icons.loading,
	summarizing: icons.loading,
	done: icons.robot,
	terminated: icons.stopCircle,
	failed: icons.alertCircle,
}

/**
 * 会话的子代理 chat id（与后端 `chat_name` 一致）。
 * @param {object} session - 会话。
 * @returns {string} chat id；无会话时为空串。
 */
export function subAgentChatId(session = store.session) {
	return session?.id ? `code-${session.id}` : ''
}

/**
 * 取运行状态（事件/历史摘要 → 规范状态）。
 * @param {object} run - 运行摘要。
 * @returns {string} 状态。
 */
function runState(run) {
	if (!run) return 'done'
	return run.state || run.live?.state || (run.isAsync ? 'running' : run.hasError ? 'failed' : 'done')
}

/**
 * 单个运行的展示信息。
 * @param {object} run - 运行摘要。
 * @returns {{state: string, rounds: number, roundLimit: number|null, working: boolean}} 展示信息。
 */
function runView(run) {
	const state = runState(run)
	return {
		state,
		rounds: run?.rounds ?? run?.live?.rounds ?? 0,
		roundLimit: run?.roundLimit ?? run?.live?.roundLimit ?? null,
		working: ACTIVE_STATES.has(state),
	}
}

/**
 * 取任务预览（首行，截断）。
 * @param {string} task - 任务文本。
 * @returns {string} 预览。
 */
function taskPreview(task) {
	const line = String(task ?? '').split(/\r?\n/).find(text => text.trim())?.trim() ?? ''
	return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

/**
 * 状态徽标文案。
 * @param {string} state - 状态。
 * @param {{rounds: number, roundLimit: number|null}} view - 展示信息。
 * @returns {string} 文案。
 */
function stateLabel(state, view) {
	if (ACTIVE_STATES.has(state))
		return view.roundLimit
			? geti18n('code.subagent.working', { rounds: view.rounds, roundLimit: view.roundLimit })
			: geti18n('code.subagent.workingUnknown')
	return geti18n(`code.subagent.state.${state}`)
}

/**
 * 打开某运行在 Agent Studio 的内部对话页（新标签页）。
 * @param {string} runId - 运行 id。
 * @returns {void}
 */
export function openSubAgent(runId) {
	if (!runId) return
	window.open(AGENT_STUDIO_SUBAGENT_URL + encodeURIComponent(runId), '_blank', 'noopener')
}

/**
 * 按状态刷新单个按钮（图标 / 转圈 / 文案），状态未变则跳过。
 * @param {HTMLElement} card - 卡片按钮。
 * @param {object} run - 运行摘要。
 * @param {object} [fallback] - 运行未在本地状态表中时的兜底（来自条目扩展）。
 * @returns {void}
 */
function applySubAgentState(card, run, fallback = {}) {
	const effective = run ?? fallback
	const view = runView(effective)
	const task = effective.task ?? card.dataset.subagentTask ?? ''
	card.dataset.state = view.state
	card.classList.toggle('is-working', view.working)
	card.setAttribute('aria-label', geti18n('code.subagent.open', { task: taskPreview(task) || view.state }))
	card.title = geti18n('code.subagent.open', { task: taskPreview(task) || view.state })

	const icon = STATE_ICON[view.state] ?? icons.robot
	const iconKey = `${view.state}:${view.working}`
	if (card.dataset.iconKey !== iconKey) {
		card.dataset.iconKey = iconKey
		const holder = card.querySelector('.code-subagent-icon')
		if (holder) {
			holder.replaceChildren(iconElement(icon, { size: 15 }))
			void svgInliner(holder)
		}
	}
	const status = card.querySelector('.code-subagent-status')
	if (status) status.textContent = stateLabel(view.state, view)
}

/**
 * 构建子代理按钮（工具条目携带 `extension.subAgent` 时使用）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLButtonElement} 卡片按钮。
 */
export function subAgentCardElement(entry) {
	const meta = entry.extension?.subAgent ?? {}
	const runId = meta.runId
	const card = document.createElement('button')
	card.type = 'button'
	card.className = 'code-subagent-card'
	card.dataset.subagentRunId = runId
	card.dataset.subagentTask = meta.task || ''

	const icon = document.createElement('span')
	icon.className = 'code-subagent-icon'
	const label = document.createElement('span')
	label.className = 'code-subagent-label'
	label.setAttribute('user-content', '')
	label.textContent = taskPreview(meta.task) || geti18n('code.subagent.title')
	const status = document.createElement('span')
	status.className = 'code-subagent-status'
	card.append(icon, label, status)

	card.addEventListener('click', () => openSubAgent(runId))
	applySubAgentState(card, store.subAgents.get(runId), meta)
	return card
}

/**
 * 刷新消息流中所有子代理按钮的状态。
 * @returns {void}
 */
export function updateSubAgentCards() {
	for (const card of elements.messages.querySelectorAll('.code-subagent-card[data-subagent-run-id]'))
		applySubAgentState(card, store.subAgents.get(card.dataset.subagentRunId))
}

/**
 * 合并一组运行摘要到本地状态表（保留已有的 task 等字段）。
 * @param {object[]} runs - 运行摘要列表。
 * @returns {void}
 */
function mergeRuns(runs) {
	for (const run of runs ?? []) {
		if (!run?.runId) continue
		store.subAgents.set(run.runId, { ...store.subAgents.get(run.runId), ...run, state: runState(run) })
	}
}

/**
 * 拉取当前会话的子代理运行历史（节流；进行中的运行实时事件优先）。
 * @param {{force?: boolean}} [options] - force 为 true 时忽略节流。
 * @returns {Promise<void>}
 */
export async function refreshSubAgents({ force = false } = {}) {
	const chatId = subAgentChatId()
	if (!chatId) {
		store.subAgents.clear()
		updateSubAgentCards()
		return
	}
	const previousChatId = store.subAgentFetch?.chatId
	if (!force && previousChatId === chatId && Date.now() - store.subAgentFetch.at < 3000) return
	if (previousChatId && previousChatId !== chatId) store.subAgents.clear()
	store.subAgentFetch = { chatId, at: Date.now() }
	try {
		const { runs } = await api.getSubAgents(chatId)
		if (subAgentChatId() !== chatId) return
		mergeRuns(runs)
		updateSubAgentCards()
	}
	catch { /* 历史查询失败不影响按钮的本地兜底状态 */ }
}

/**
 * 处理服务端 `subagent-run` 实时事件（仅当前会话）。
 * @param {object} payload - 事件负载。
 * @returns {void}
 */
export function handleSubAgentEvent(payload) {
	if (!payload?.runId) return
	if (payload.chat_name && payload.chat_name !== subAgentChatId()) return
	store.subAgents.set(payload.runId, { ...store.subAgents.get(payload.runId), ...payload })
	updateSubAgentCards()
}
