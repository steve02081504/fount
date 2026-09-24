/**
 * 【文件】public/src/views/conversation.mjs — 会话详情视图
 * 【职责】按会话键深链展示该对话的全部生成记录，以及每条生成内部的逐轮 prompt 请求。
 * 【原理】数据经 `/conversation/:key` 拉取（含逐轮 `requests`）；纯文本 `textContent` 写入避免注入；逐轮请求与旧格式过期状态分别提示。
 * 【关联】endpoints.mjs、lib/navigationEvents.mjs、index.html 的 #conversationView、lib/format.mjs。
 */
import { geti18n, geti18n_nowarn, primaryLocale } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { onServerEvent } from '/scripts/endpoints/server_events.mjs'

import { replayDialogue } from '../../shared/dialogueReplay.mjs'
import { estimatePromptCache } from '../../shared/promptCache.mjs'
import { messagesToText } from '../../shared/promptText.mjs'
import { getConversation, getSubAgent, sendSubAgentMessage } from '../endpoints.mjs'
import { formatTime } from '../lib/format.mjs'
import { messageBody } from '../lib/messageBody.mjs'
import { requestNavigate } from '../lib/navigationEvents.mjs'
import { stateBadge } from '../lib/stateBadge.mjs'
import { textActions } from '../lib/textActions.mjs'

/** 当前深链的会话键（语言切换重载时复用）。 */
let currentKey = ''
/** 当前子代理运行的状态刷新定时器。 */
let refreshTimer = null
/** 回放条两端内缩，抵消原生 range 滑块拇指的半宽，使节点/图表与进度条对位。 */
const REPLAY_INSET = 8

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
	document.getElementById('subagentMessageForm')?.addEventListener('submit', event => {
		event.preventDefault()
		const input = document.getElementById('subagentMessageInput')
		if (!(input instanceof HTMLTextAreaElement) || !input.value.trim()) return
		const text = input.value
		const key = currentKey
		void sendSubAgentMessage(key.slice('subagent:'.length), text).then(() => {
			input.value = ''
			if (currentKey === key) void loadConversationView({ key })
		}).catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message }))
	})
	onServerEvent('subagent-run', event => {
		if (currentKey !== `subagent:${event.runId}` || document.getElementById('conversationView')?.classList.contains('hidden')) return
		if (event.preview !== undefined || event.toolOutput) {
			const preview = document.getElementById('subagentLivePreview')
			if (preview) {
				preview.textContent = event.preview?.content_for_show ?? event.preview?.content ?? event.toolOutput?.data ?? ''
				preview.classList.toggle('hidden', !preview.textContent)
			}
		}
		if (event.entry || event.state) scheduleRefresh()
	})
}

/** 合并短时间内的运行事件，避免每个分片重复拉取历史。 */
function scheduleRefresh() {
	if (refreshTimer) return
	refreshTimer = setTimeout(() => {
		refreshTimer = null
		if (currentKey.startsWith('subagent:')) void loadConversationView({ key: currentKey })
	}, 250)
}

/**
 * 加载会话详情视图。
 * @param {{ key?: string }} [options] 选项（缺省复用上次深链的 key）
 * @returns {Promise<void>}
 */
export async function loadConversationView({ key } = {}) {
	if (key) currentKey = key
	const runPanel = document.getElementById('conversationSubagent')
	const isSubagent = currentKey.startsWith('subagent:')
	runPanel?.classList.toggle('hidden', !isSubagent)
	document.getElementById('conversationTranscript')?.classList.toggle('hidden', isSubagent)
	document.getElementById('conversationReplay')?.classList.remove('hidden')
	if (isSubagent) return loadSubagentConversation(currentKey)
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
		const metrics = estimatePromptCache(items)
		const transcript = document.getElementById('conversationTranscript')
		const units = buildRoundUnits(items)
		renderReplay(units, metrics, count => {
			const revealed = generationsForRounds(items, units, count)
			generations.replaceChildren(...revealed.map(({ item, index }) => renderGeneration(item, metrics[index])))
			if (transcript) {
				const rounds = units.length ? units[count - 1]?.round ?? 0 : 0
				transcript.replaceChildren(...renderMessages(replayDialogue(conversation.dialogue?.events ?? [], { upToRound: rounds })))
			}
		})
	}
	catch (error) {
		empty.classList.remove('hidden')
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}

/**
 * 把生成记录展开为逐轮回放单元：每个单元代表一轮（一次 AI 调用），并记录其所属生成与全局轮次。
 * @param {object[]} items 生成记录（按开始时间升序）
 * @returns {Array<{ round: number, startedAt: number, generationIndex: number, generationStart: boolean }>} 逐轮单元
 */
export function buildRoundUnits(items) {
	const units = []
	let round = 0
	for (const [index, item] of (items || []).entries()) {
		// 轮次数取每代权威计数：优先采集到的请求数，其次复原对话的轮次；缺失时至少 1 轮。
		const span = Math.max(item.requestCount ?? item.requests?.length ?? 0, item.dialogue?.rounds ?? 0, 1)
		for (let offset = 0; offset < span; offset++) {
			round++
			units.push({
				round,
				startedAt: item.requests?.[offset]?.startedAt ?? item.startedAt ?? 0,
				generationIndex: index,
				generationStart: offset === 0,
			})
		}
	}
	return units
}

/**
 * 取在某轮回放位置下应展示的生成记录（首个轮次已被揭示者即展示）。
 * @param {object[]} items 生成记录
 * @param {ReturnType<typeof buildRoundUnits>} units 逐轮单元
 * @param {number} count 已揭示的轮次数
 * @returns {Array<{ item: object, index: number }>} 生成记录与其原始下标
 */
function generationsForRounds(items, units, count) {
	const revealed = []
	const seen = new Set()
	for (const unit of units.slice(0, count))
		if (!seen.has(unit.generationIndex)) {
			seen.add(unit.generationIndex)
			revealed.push({ item: items[unit.generationIndex], index: unit.generationIndex })
		}
	return revealed
}

/**
 * 逐轮回放控制与缓存图：timeline / 滑块 / 选择器均以「轮次」为单位。
 * @param {ReturnType<typeof buildRoundUnits>} units 逐轮单元
 * @param {object[]} metrics 每次生成缓存数据（按生成下标）
 * @param {(count: number) => void} onChange 回放变化（count = 已揭示轮次数）
 * @returns {void}
 */
function renderReplay(units, metrics, onChange) {
	const timeline = document.getElementById('conversationTimeline')
	const chart = document.getElementById('conversationCacheChart')
	const summary = document.getElementById('conversationCacheSummary')
	const slider = document.getElementById('conversationReplaySlider')
	const selection = document.getElementById('conversationReplaySelection')
	if (!(slider instanceof HTMLInputElement) || !timeline || !chart || !summary || !selection) return
	const previous = slider.dataset.key !== currentKey || Number(slider.value) === Number(slider.max)
		? units.length : Number(slider.value)
	slider.dataset.key = currentKey
	slider.min = units.length ? '1' : '0'
	slider.max = String(units.length)
	slider.value = String(Math.min(previous, units.length))
	const span = units.length > 1 ? units.length - 1 : 1
	/** @returns {void} 更新回放进度和消息。 */
	const update = () => {
		const count = Number(slider.value)
		selection.textContent = `${count}/${units.length}`
		onChange(count)
		for (const node of timeline.children) node.classList.toggle('active', Number(node.dataset.index) === count)
	}
	slider.oninput = update
	timeline.replaceChildren(...units.map((unit, index) => {
		const node = document.createElement('button')
		node.type = 'button'
		node.className = 'conversation-timeline-node'
		if (unit.generationStart) node.classList.add('generation-start')
		node.dataset.index = String(index + 1)
		node.title = `${geti18n_nowarn('agent_studio.conversation.roundIndex', { index: unit.round })} · ${formatTime(unit.startedAt, primaryLocale())}`
		node.textContent = String(unit.round)
		node.style.left = `calc(${REPLAY_INSET}px + ${index / span} * (100% - ${REPLAY_INSET * 2}px))`
		/** @returns {void} 跳转到指定轮次节点。 */
		node.onclick = () => { slider.value = String(index + 1); update() }
		return node
	}))
	const total = metrics.reduce((sum, metric) => sum + metric.total, 0)
	const reused = metrics.reduce((sum, metric) => sum + metric.reused, 0)
	summary.textContent = total ? geti18n('agent_studio.conversation.cache.summary', { rate: Math.round(reused / total * 100) }) : geti18n('agent_studio.conversation.cache.missing')
	paintCacheChart(chart, units, metrics)
	update()
}

/**
 * 按「轮次」位置绘制缓存率折线：每个轮次节点一个点，取该单次请求相对上一请求的复用率，与 timeline 节点一一对位。
 * @param {HTMLCanvasElement} canvas 画布
 * @param {ReturnType<typeof buildRoundUnits>} units 逐轮单元
 * @param {object[]} metrics 每次生成缓存指标（含 `rounds` 逐轮指标）
 * @returns {void}
 */
function paintCacheChart(canvas, units, metrics) {
	if (!(canvas instanceof HTMLCanvasElement)) return
	const ratio = window.devicePixelRatio || 1
	canvas.width = Math.round(canvas.clientWidth * ratio)
	canvas.height = Math.round(canvas.clientHeight * ratio)
	const ctx = canvas.getContext('2d')
	if (!ctx) return
	ctx.scale(ratio, ratio)
	const width = canvas.clientWidth
	const height = canvas.clientHeight
	const span = units.length > 1 ? units.length - 1 : 1
	/** 每个生成的首个单元下标，用于取该轮的请求下标。 */
	const firstIndex = new Map()
	units.forEach((unit, index) => {
		if (!firstIndex.has(unit.generationIndex)) firstIndex.set(unit.generationIndex, index)
	})
	const points = units.map((unit, index) => {
		const offset = index - (firstIndex.get(unit.generationIndex) ?? 0)
		const rate = metrics[unit.generationIndex]?.rounds?.[offset]?.rate
		if (rate == null) return null
		return {
			x: REPLAY_INSET + index / span * (width - REPLAY_INSET * 2),
			y: height - 10 - rate * (height - 20), rate,
		}
	})
	const style = getComputedStyle(canvas)
	ctx.strokeStyle = style.getPropertyValue('--color-primary')
	ctx.lineWidth = 2
	ctx.beginPath()
	let connected = false
	for (const point of points) {
		if (!point) { connected = false; continue }
		if (connected) ctx.lineTo(point.x, point.y)
		else ctx.moveTo(point.x, point.y)
		connected = true
	}
	ctx.stroke()
	for (const point of points) {
		if (!point) continue
		ctx.beginPath()
		ctx.fillStyle = style.getPropertyValue(point.rate >= 0.6 ? '--color-success' : '--color-error')
		ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI)
		ctx.fill()
	}
}

/**
 * 子代理的会话深链：运行中从内存取得对话，完成后从记录恢复。
 * @param {string} key 会话键
 * @returns {Promise<void>}
 */
async function loadSubagentConversation(key) {
	const meta = document.getElementById('conversationMeta')
	const list = document.getElementById('conversationGenerations')
	const transcriptView = document.getElementById('conversationTranscript')
	transcriptView?.replaceChildren()
	const empty = document.getElementById('conversationEmpty')
	const transcript = document.getElementById('subagentTranscript')
	if (!meta || !list || !empty || !transcript) return
	meta.replaceChildren()
	list.replaceChildren()
	empty.classList.add('hidden')
	try {
		const run = await getSubAgent(key.slice('subagent:'.length))
		if (currentKey !== key) return
		const chip = document.createElement('span')
		chip.className = `badge ${stateBadge(run.state)}`
		chip.textContent = geti18n(`agent_studio.run.state.${run.state}`)
		meta.append(chip)
		for (const text of [run.charname || run.charId, run.runId, `${run.rounds}/${run.roundLimit ?? '-'}`, formatTime(run.startedAt, primaryLocale())].filter(Boolean)) {
			const item = document.createElement('span')
			item.className = 'meta-chip'
			item.textContent = text
			meta.append(item)
		}
		const task = document.getElementById('subagentConversationTask')
		if (task) task.textContent = run.task || ''
		document.getElementById('subagentConversationTaskActions')?.replaceChildren(textActions(
			() => run.task || '',
			{ filename: `subagent-${run.runId}-task.txt` },
		))
		const form = document.getElementById('subagentMessageForm')
		const record = await getConversation(key).catch(() => null)
		if (currentKey !== key) return
		const items = record?.generations?.length ? record.generations : [{ id: run.runId, startedAt: run.startedAt }]
		const metrics = estimatePromptCache(items)
		const units = buildRoundUnits(items)
		renderReplay(units, metrics, count => {
			// 子代理运行时的增量对话只属于当前生成；回放期间不显示未来消息或允许注入。
			const atLatest = count === units.length
			transcript.classList.toggle('hidden', !atLatest)
			form?.classList.toggle('hidden', !run.canSend || !atLatest)
			const revealed = generationsForRounds(items, units, count)
			list.replaceChildren(...revealed.filter(({ item }) => item.requests?.length).map(({ item, index }) => renderGeneration(item, metrics[index])))
		})
		transcript.replaceChildren(...(run.conversation || []).map(message => {
			const row = document.createElement('article')
			row.className = `subagent-entry role-${message.role || 'char'}`
			const title = document.createElement('strong')
			title.className = 'subagent-entry-name'
			title.textContent = message.name || message.role || ''
			row.append(title, messageBody(message.content_for_show ?? message.content ?? ''))
			return row
		}))
		const preview = document.getElementById('subagentLivePreview')
		if (!run.canSend && preview) { preview.textContent = ''; preview.classList.add('hidden') }
	}
	catch (error) {
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
 * @param {object} cache 缓存复用估算
 * @returns {HTMLElement} 元素
 */
function renderGeneration(generation, cache = {}) {
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
	const cacheBadge = document.createElement('span')
	cacheBadge.className = `badge ${cache.rate == null ? 'badge-ghost' : cache.rate >= 0.6 ? 'badge-success' : 'badge-error'}`
	cacheBadge.textContent = cache.rate == null ? geti18n('agent_studio.conversation.cache.noRate') : geti18n('agent_studio.conversation.cache.rate', { rate: Math.round(cache.rate * 100) })
	cacheBadge.title = geti18n('agent_studio.conversation.cache.hint')
	head.append(cacheBadge)
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

	article.appendChild(buildSection(geti18n('agent_studio.conversation.response'), generation.response ?? '', `generation-${generation.id}-response.txt`))

	const requestsSection = document.createElement('details')
	requestsSection.className = 'conversation-requests'
	const requestsTitle = document.createElement('summary')
	requestsTitle.className = 'dialog-section-title'
	requestsTitle.textContent = `${geti18n('agent_studio.conversation.requests')} · ${generation.requestCount ?? generation.requests?.length ?? 0}`
	requestsSection.appendChild(requestsTitle)
	if (generation.requests?.length)
		for (const request of generation.requests)
			requestsSection.appendChild(renderRequest(request, generation.id))
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
 * @param {string} generationId 所属生成记录 id（用于下载文件名）
 * @returns {HTMLElement} 元素
 */
function renderRequest(request, generationId) {
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

	round.appendChild(buildSection(
		geti18n('agent_studio.conversation.systemPrompt'),
		request.systemPrompt ?? '',
		`generation-${generationId}-round-${request.index}-system.txt`,
	))

	if (request.messages?.length) {
		const labelRow = document.createElement('div')
		labelRow.className = 'conversation-section-head'
		const label = document.createElement('h6')
		label.className = 'conversation-request-label'
		label.textContent = geti18n('agent_studio.conversation.messages')
		labelRow.append(label, textActions(
			() => messagesToText(request.messages),
			{ filename: `generation-${generationId}-round-${request.index}-messages.txt` },
		))
		round.appendChild(labelRow)
		const list = document.createElement('div')
		list.className = 'conversation-messages'
		for (const message of request.messages) {
			const row = document.createElement('div')
			row.className = `conversation-message role-${message.role || 'system'}`
			const name = document.createElement('span')
			name.className = 'conversation-message-name'
			const key = ROLE_LABEL_KEYS[message.role]
			name.textContent = message.name || (key && geti18n_nowarn(key)) || message.role || ''
			const body = messageBody(message.content ?? '')
			row.append(name, body)
			list.appendChild(row)
		}
		round.appendChild(list)
	}
	return round
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
		const body = messageBody(message.content ?? '')
		row.append(name, body)
		return row
	})
}

/**
 * 构建带标题的 `<pre>` 段落，标题旁附带复制 / 下载按钮。
 * @param {string} title 标题
 * @param {string} text 文本
 * @param {string} [filename] 下载文件名（缺省则不加按钮）
 * @returns {HTMLElement} 段落
 */
function buildSection(title, text, filename) {
	const section = document.createElement('section')
	section.className = 'conversation-section'
	const head = document.createElement('div')
	head.className = 'conversation-section-head'
	const heading = document.createElement('h3')
	heading.className = 'dialog-section-title'
	heading.textContent = title
	head.appendChild(heading)
	if (filename) head.appendChild(textActions(() => text, { filename }))
	const body = messageBody(text)
	section.append(head, body)
	return section
}
