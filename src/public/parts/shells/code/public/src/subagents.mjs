/**
 * 子代理运行：把 `sub-agent` 插件的工具条目渲染为带状态的按钮，订阅实时事件并深链到 Agent Studio 内部对话页。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

import * as api from './endpoints.mjs'
import { icons } from './icons.mjs'
import { createRunCard, createRunCardFeed, paintRunCard, registerRunCardFeed } from './runCards.mjs'
import { store } from './store.mjs'

/** Agent Studio 子代理会话深链前缀。 */
const AGENT_STUDIO_SUBAGENT_URL = '/parts/shells:agent_studio/#conversation/subagent%3A'

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
 * 按状态刷新单个按钮（图标 / 转圈 / 文案）。
 * @param {HTMLElement} card - 卡片按钮。
 * @param {object} [run] - 运行摘要。
 * @param {object} [fallback] - 运行未在本地状态表中时的兜底（来自条目扩展）。
 * @returns {void}
 */
function applySubAgentState(card, run, fallback = {}) {
	const effective = run ?? fallback
	const view = runView(effective)
	const task = effective.task ?? card.dataset.subagentTask ?? ''
	const label = geti18n('code.subagent.open', { task: taskPreview(task) || view.state })
	paintRunCard(card, {
		state: view.state,
		working: view.working,
		icon: STATE_ICON[view.state] ?? icons.robot,
		statusText: stateLabel(view.state, view),
		title: label,
		ariaLabel: label,
	})
}

const feed = createRunCardFeed({
	cardSelector: '.code-subagent-card[data-subagent-run-id]',
	/**
	 * 从卡片取运行 id。
	 * @param {HTMLElement} card - 卡片。
	 * @returns {string} 运行 id。
	 */
	cardId: card => card.dataset.subagentRunId,
	chatId: subAgentChatId,
	/**
	 * 从事件负载取运行 id。
	 * @param {object} payload - 事件负载。
	 * @returns {string} 运行 id。
	 */
	eventId: payload => payload.runId,
	/**
	 * 从事件负载取 chat id。
	 * @param {object} payload - 事件负载。
	 * @returns {string} chat id。
	 */
	eventChatId: payload => payload.chat_name,
	/**
	 * 合并一条实时运行事件。
	 * @param {Map} states - 状态表。
	 * @param {object} payload - 事件负载。
	 * @returns {void}
	 */
	ingest: (states, payload) => states.set(payload.runId, { ...states.get(payload.runId), ...payload }),
	/**
	 * 合并一批运行历史（保留已有字段，规范化状态）。
	 * @param {Map} states - 状态表。
	 * @param {object[]} runs - 运行摘要列表。
	 * @returns {void}
	 */
	merge: (states, runs) => {
		for (const run of runs ?? []) {
			if (!run?.runId) continue
			states.set(run.runId, { ...states.get(run.runId), ...run, state: runState(run) })
		}
	},
	/**
	 * 拉取当前会话的子代理运行历史。
	 * @param {string} chatId - 会话 chat id。
	 * @returns {Promise<object[]>} 运行摘要列表。
	 */
	fetch: chatId => api.getSubAgents(chatId).then(data => data.runs ?? []),
	/**
	 * 重绘单个运行按钮。
	 * @param {HTMLElement} card - 卡片。
	 * @param {object} run - 运行摘要（空表示无实时状态，走卡片兜底）。
	 * @returns {void}
	 */
	paint: (card, run) => applySubAgentState(card, run),
})

registerRunCardFeed(feed)

/**
 * 构建子代理按钮（工具条目携带 `extension.subAgent` 时使用）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLButtonElement} 卡片按钮。
 */
export function subAgentCardElement(entry) {
	const meta = entry.extension?.subAgent ?? {}
	const runId = meta.runId
	const card = createRunCard({
		tag: 'button',
		className: 'code-run-card code-subagent-card',
		label: taskPreview(meta.task) || geti18n('code.subagent.title'),
		dataset: { subagentRunId: runId, subagentTask: meta.task || '' },
	})
	card.type = 'button'
	card.addEventListener('click', () => openSubAgent(runId))
	applySubAgentState(card, feed.get(runId), meta)
	return card
}

/**
 * 处理服务端 `subagent-run` 实时事件（仅当前会话）。
 * @param {object} payload - 事件负载。
 * @returns {void}
 */
export function handleSubAgentEvent(payload) {
	feed.handle(payload)
}
