/**
 * 【文件】public/src/views/subagent.mjs — 子代理内部对话视图
 * 【职责】按 runId 深链展示一次子代理运行的状态、任务与完整内部对话。
 * 【原理】数据经 `/subagent/:runId` 拉取（实时注册表优先，回落落盘记录）；纯文本 `textContent` 写入避免注入。
 * 【关联】endpoints.mjs、navigation.mjs、index.html 的 #subagentView。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { getSubAgent } from '../endpoints.mjs'
import { formatTime } from '../lib/format.mjs'

/** 当前深链的运行 id（语言切换重载时复用）。 */
let currentRunId = ''

/**
 * 取状态徽章样式。
 * @param {string} runState 状态
 * @returns {string} 徽章类名
 */
function stateBadge(runState) {
	if (runState === 'running' || runState === 'summarizing') return 'badge-info'
	if (runState === 'failed' || runState === 'terminated') return 'badge-error'
	if (runState === 'done') return 'badge-success'
	return 'badge-ghost'
}

/**
 * 绑定子代理视图内的静态控件。
 * @returns {void}
 */
export function initSubAgentView() {
	// 经 hashchange 回到生成记录视图（避免视图静态依赖 navigation.mjs 造成环）
	document.getElementById('subagentBackButton')?.addEventListener('click', () => { window.location.hash = '#generations' })
}

/**
 * 加载子代理视图。
 * @param {{ runId?: string }} [options] 选项（缺省复用上次深链的 runId）
 * @returns {Promise<void>}
 */
export async function loadSubAgentView({ runId } = {}) {
	if (runId) currentRunId = runId
	const meta = document.getElementById('subagentMeta')
	const task = document.getElementById('subagentTask')
	const conversation = document.getElementById('subagentConversation')
	const empty = document.getElementById('subagentConversationEmpty')
	if (!meta || !task || !conversation || !empty) return
	meta.replaceChildren()
	task.textContent = ''
	conversation.replaceChildren()
	if (!currentRunId) {
		empty.classList.remove('hidden')
		return
	}
	try {
		const run = await getSubAgent(currentRunId)
		renderMeta(meta, run)
		task.textContent = run.task || ''
		const entries = run.conversation ?? []
		empty.classList.toggle('hidden', entries.length > 0)
		conversation.replaceChildren(...entries.map(renderEntry))
	}
	catch (error) {
		empty.classList.remove('hidden')
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}

/**
 * 渲染运行元信息徽章。
 * @param {HTMLElement} container 容器
 * @param {object} run 运行详情
 * @returns {void}
 */
function renderMeta(container, run) {
	const runState = run.state || 'done'
	const chips = [
		geti18n(`agent_studio.run.state.${runState}`),
		geti18n('agent_studio.run.detail', {
			generations: run.conversation?.length ?? 0,
			rounds: run.rounds ?? 0,
			roundLimit: run.roundLimit ?? '-',
		}),
		run.startedAt ? formatTime(run.startedAt) : '',
		run.runId,
	].filter(Boolean)
	for (const [index, text] of chips.entries()) {
		const chip = document.createElement('span')
		chip.className = index === 0 ? `badge ${stateBadge(runState)}` : 'meta-chip'
		chip.textContent = text
		container.appendChild(chip)
	}
}

/**
 * 渲染一条内部对话条目。
 * @param {object} entry 条目
 * @returns {HTMLElement} 条目元素
 */
function renderEntry(entry) {
	const row = document.createElement('div')
	row.className = `subagent-entry role-${entry.role || 'char'}`
	const head = document.createElement('div')
	head.className = 'subagent-entry-head'
	const name = document.createElement('span')
	name.className = 'subagent-entry-name'
	name.setAttribute('user-content', '')
	name.textContent = `${entry.name || entry.role || ''}`
	const time = document.createElement('span')
	time.className = 'subagent-entry-time'
	time.textContent = formatTime(entry.time_stamp)
	head.append(name, time)
	const body = document.createElement('pre')
	body.className = 'subagent-entry-body'
	body.setAttribute('user-content', '')
	body.textContent = entry.content_for_show ?? entry.content ?? ''
	row.append(head, body)
	return row
}
