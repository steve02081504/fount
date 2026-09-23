/**
 * 【文件】public/src/views/conversation.mjs — 会话详情视图
 * 【职责】按会话键深链展示该对话的全部生成记录，以及每条生成内部的逐轮 prompt 请求。
 * 【原理】数据经 `/conversation/:key` 拉取（含逐轮 `requests`）；纯文本 `textContent` 写入避免注入；逐轮请求与旧格式过期状态分别提示。
 * 【关联】endpoints.mjs、lib/navigationEvents.mjs、index.html 的 #conversationView、lib/format.mjs。
 */
import { geti18n, geti18n_nowarn, primaryLocale } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { dialogueRounds, replayDialogue } from '../../shared/dialogueReplay.mjs'
import { getConversation } from '../endpoints.mjs'
import { formatTime } from '../lib/format.mjs'
import { requestNavigate } from '../lib/navigationEvents.mjs'
import { stateBadge } from '../lib/stateBadge.mjs'

/** 当前深链的会话键（语言切换重载时复用）。 */
let currentKey = ''

/**
 * 内部对话角色标签的 i18n 键（缺失时回落原始角色名）。
 * @type {Record<string, string>}
 */
const ROLE_LABEL_KEYS = {
	system: 'agent_studio.conversation.role.system',
	user: 'agent_studio.conversation.role.user',
	char: 'agent_studio.conversation.role.char',
	tool: 'agent_studio.conversation.role.tool',
}

/**
 * 绑定会话视图内的静态控件。
 * @returns {void}
 */
export function initConversationView() {
	document.getElementById('conversationBackButton')?.addEventListener('click', () => { requestNavigate('generations') })
}

/**
 * 加载会话详情视图。
 * @param {{ key?: string }} [options] 选项（缺省复用上次深链的 key）
 * @returns {Promise<void>}
 */
export async function loadConversationView({ key } = {}) {
	if (key) currentKey = key
	const meta = document.getElementById('conversationMeta')
	const generations = document.getElementById('conversationGenerations')
	const empty = document.getElementById('conversationEmpty')
	if (!meta || !generations || !empty) return
	meta.replaceChildren()
	generations.replaceChildren()
	if (!currentKey) {
		empty.classList.remove('hidden')
		return
	}
	try {
		const conversation = await getConversation(currentKey)
		renderMeta(meta, conversation)
		const items = conversation.generations ?? []
		empty.classList.toggle('hidden', items.length > 0)
		generations.replaceChildren(...items.map(renderGeneration))
	}
	catch (error) {
		empty.classList.remove('hidden')
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}

/**
 * 渲染会话元信息徽章。
 * @param {HTMLElement} container 容器
 * @param {{ key: string, generations: object[] }} conversation 会话
 * @returns {void}
 */
function renderMeta(container, conversation) {
	const generations = conversation.generations ?? []
	const rounds = generations.reduce((sum, generation) => sum + (generation.requestCount ?? generation.requests?.length ?? 0), 0)
	const chips = [
		geti18n('agent_studio.conversation.generationsCount', { count: generations.length }),
		geti18n('agent_studio.conversation.rounds', { count: rounds }),
		conversation.key,
	].filter(Boolean)
	for (const text of chips) {
		const chip = document.createElement('span')
		chip.className = 'meta-chip'
		chip.textContent = text
		container.appendChild(chip)
	}
}

/**
 * 渲染一条生成记录及其逐轮请求。
 * @param {object} generation 生成记录
 * @returns {HTMLElement} 元素
 */
function renderGeneration(generation) {
	const article = document.createElement('article')
	article.className = 'conversation-generation surface'

	const head = document.createElement('header')
	head.className = 'conversation-generation-head'
	const title = document.createElement('span')
	title.className = 'conversation-generation-id'
	title.setAttribute('prompt-content', '')
	title.textContent = generation.id
	const badge = document.createElement('span')
	const state = generation.hasError ? 'failed' : 'done'
	badge.className = `badge ${stateBadge(state)}`
	badge.textContent = geti18n(`agent_studio.run.state.${state}`)
	head.append(title, badge)
	const meta = document.createElement('p')
	meta.className = 'conversation-generation-meta'
	meta.setAttribute('user-content', '')
	meta.textContent = [
		generation.source || '',
		generation.charname || generation.charId || '',
		generation.model || '',
		formatTime(generation.startedAt, primaryLocale()),
	].filter(Boolean).join(' · ')
	head.appendChild(meta)
	article.appendChild(head)

	// 由逐轮请求复原的连续对话（可按轮次复播，编辑随轮次推进呈现）
	if (generation.dialogue?.events?.length)
		article.appendChild(buildDialogueSection(generation.dialogue))

	article.appendChild(buildSection(geti18n('agent_studio.conversation.response'), generation.response ?? ''))

	const requestsSection = document.createElement('section')
	requestsSection.className = 'conversation-requests'
	const requestsTitle = document.createElement('h4')
	requestsTitle.className = 'dialog-section-title'
	requestsTitle.textContent = geti18n('agent_studio.conversation.requests')
	requestsSection.appendChild(requestsTitle)
	if (generation.requests?.length) 
		for (const request of generation.requests)
			requestsSection.appendChild(renderRequest(request))
	
	else {
		const hint = document.createElement('p')
		hint.className = 'conversation-requests-hint'
		hint.textContent = generation.requestsStripped || generation.requestCount
			? geti18n('agent_studio.conversation.requestsExpired', { count: generation.requestCount ?? 0 })
			: geti18n('agent_studio.conversation.requestsMissing')
		requestsSection.appendChild(hint)
	}
	article.appendChild(requestsSection)

	return article
}

/**
 * 渲染一轮 prompt 请求。
 * @param {object} request 请求快照
 * @returns {HTMLElement} 元素
 */
function renderRequest(request) {
	const round = document.createElement('div')
	round.className = 'conversation-request'

	const head = document.createElement('h5')
	head.className = 'conversation-request-head'
	head.textContent = geti18n('agent_studio.conversation.round', {
		index: request.index,
		model: request.model || '-',
		time: formatTime(request.startedAt, primaryLocale()),
	})
	round.appendChild(head)

	if (request.error) {
		const error = document.createElement('p')
		error.className = 'conversation-request-error'
		error.setAttribute('prompt-content', '')
		error.textContent = `${request.error.name || ''}: ${request.error.message || ''}`
		round.appendChild(error)
	}

	round.appendChild(buildSection(geti18n('agent_studio.conversation.systemPrompt'), request.systemPrompt ?? ''))

	if (request.messages?.length) {
		const label = document.createElement('h6')
		label.className = 'conversation-request-label'
		label.textContent = geti18n('agent_studio.conversation.messages')
		round.appendChild(label)
		const list = document.createElement('div')
		list.className = 'conversation-messages'
		for (const message of request.messages) {
			const row = document.createElement('div')
			row.className = `conversation-message role-${message.role || 'system'}`
			const name = document.createElement('span')
			name.className = 'conversation-message-name'
			const key = ROLE_LABEL_KEYS[message.role]
			name.textContent = message.name || (key && geti18n_nowarn(key)) || message.role || ''
			const body = document.createElement('pre')
			body.className = 'conversation-message-body'
			body.setAttribute('prompt-content', '')
			body.textContent = message.content ?? ''
			row.append(name, body)
			list.appendChild(row)
		}
		round.appendChild(list)
	}
	return round
}

/**
 * 构建复原对话段落：含轮次选择器与按轮次复播的消息列表。
 * @param {{ rounds: number, events: object[] }} dialogue 对话
 * @returns {HTMLElement} 段落
 */
function buildDialogueSection(dialogue) {
	const section = document.createElement('section')
	section.className = 'conversation-dialogue'
	const heading = document.createElement('h4')
	heading.className = 'dialog-section-title'
	heading.textContent = geti18n('agent_studio.conversation.replay')
	section.appendChild(heading)

	const row = document.createElement('label')
	row.className = 'conversation-request-head'
	row.textContent = geti18n('agent_studio.conversation.replayUpto') + ' '
	const select = document.createElement('select')
	select.className = 'select select-sm'
	const all = document.createElement('option')
	all.value = '0'
	all.textContent = geti18n('agent_studio.conversation.replayAll')
	select.appendChild(all)
	for (const round of dialogueRounds(dialogue.events)) {
		const option = document.createElement('option')
		option.value = String(round)
		option.textContent = geti18n('agent_studio.conversation.roundIndex', { index: round })
		select.appendChild(option)
	}
	row.appendChild(select)
	section.appendChild(row)

	const list = document.createElement('div')
	list.className = 'conversation-messages'
	list.replaceChildren(...renderMessages(replayDialogue(dialogue.events)))
	section.appendChild(list)
	select.addEventListener('change', () => {
		const upToRound = Number(select.value) || 0
		list.replaceChildren(...renderMessages(replayDialogue(dialogue.events, { upToRound: upToRound > 0 ? upToRound : undefined })))
	})
	return section
}

/**
 * 渲染一组消息行。
 * @param {object[]} messages 消息
 * @returns {HTMLElement[]} 行元素
 */
function renderMessages(messages) {
	return (messages || []).map(message => {
		const row = document.createElement('div')
		row.className = `conversation-message role-${message.role || 'system'}`
		const name = document.createElement('span')
		name.className = 'conversation-message-name'
		const key = ROLE_LABEL_KEYS[message.role]
		name.textContent = message.name || (key && geti18n_nowarn(key)) || message.role || ''
		const body = document.createElement('pre')
		body.className = 'conversation-message-body'
		body.setAttribute('prompt-content', '')
		body.textContent = message.content ?? ''
		row.append(name, body)
		return row
	})
}

/**
 * 构建带标题的 `<pre>` 段落。
 * @param {string} title 标题
 * @param {string} text 文本
 * @returns {HTMLElement} 段落
 */
function buildSection(title, text) {
	const section = document.createElement('section')
	section.className = 'conversation-section'
	const heading = document.createElement('h4')
	heading.className = 'dialog-section-title'
	heading.textContent = title
	const body = document.createElement('pre')
	body.className = 'code-block'
	body.setAttribute('prompt-content', '')
	body.textContent = text
	section.append(heading, body)
	return section
}
