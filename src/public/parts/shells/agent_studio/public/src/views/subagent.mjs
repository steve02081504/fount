/**
 * 【文件】public/src/views/subagent.mjs — 子代理内部对话视图
 * 【职责】按 runId 深链展示一次子代理运行的状态、任务与完整内部对话。
 * 【原理】数据经 `/subagent/:runId` 拉取（实时注册表优先，回落落盘记录）；纯文本 `textContent` 写入避免注入。
 * 【关联】endpoints.mjs、lib/navigationEvents.mjs、index.html 的 #subagentView。
 */
import { geti18n, geti18n_nowarn, primaryLocale } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { getSubAgent } from '../endpoints.mjs'
import { formatTime } from '../lib/format.mjs'
import { requestNavigate } from '../lib/navigationEvents.mjs'
import { stateBadge } from '../lib/stateBadge.mjs'

/** 当前深链的运行 id（语言切换重载时复用）。 */
let currentRunId = ''

/**
 * 内部对话角色标签的 i18n 键（缺失时回落原始角色名）。
 * @type {Record<string, string>}
 */
const ROLE_LABEL_KEYS = {
	system: 'agent_studio.subagent.role.system',
	user: 'agent_studio.subagent.role.user',
	char: 'agent_studio.subagent.role.char',
	tool: 'agent_studio.subagent.role.tool',
}

/**
 * 取条目的展示名：优先条目自带名字，其次角色标签，最后原始角色名。
 * @param {object} entry 条目
 * @returns {string} 展示名
 */
function entryLabel(entry) {
	if (entry.name) return entry.name
	const key = ROLE_LABEL_KEYS[entry.role]
	return (key && geti18n_nowarn(key)) || entry.role || ''
}

/**
 * 绑定子代理视图内的静态控件。
 * @returns {void}
 */
export function initSubAgentView() {
	document.getElementById('subagentBackButton')?.addEventListener('click', () => { requestNavigate('generations') })
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
		run.startedAt ? formatTime(run.startedAt, primaryLocale()) : '',
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
	name.textContent = entryLabel(entry)
	const time = document.createElement('span')
	time.className = 'subagent-entry-time'
	time.textContent = formatTime(entry.time_stamp, primaryLocale())
	head.append(name, time)
	const body = document.createElement('pre')
	body.className = 'subagent-entry-body'
	body.setAttribute('user-content', '')
	body.textContent = entry.content_for_show ?? entry.content ?? ''
	row.append(head, body)
	return row
}
