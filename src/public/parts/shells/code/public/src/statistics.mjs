/** 按标签页展示工作计时与输入框下方的会话统计。 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import { summarizeStatistics } from '../shared/statistics.mjs'

import { iconElement } from './icons.mjs'
import { activeTab, getActiveRuntime, store } from './store.mjs'

/** @type {HTMLElement|null} */
let root = null
/** @type {Map<string, HTMLElement>} */
const fields = new Map()

const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const decimalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const plainFormat = new Intl.NumberFormat()

/**
 * @param {number|null} value - 计量数。
 * @returns {string} 紧凑显示文本。
 */
const count = value => value == null ? '—' : compactFormat.format(value)
/**
 * @param {number|null} value - 比例。
 * @returns {string} 百分比文本。
 */
const percent = value => value == null ? '—' : percentFormat.format(value)

/**
 * 格式化单次工作的实际耗时。
 * @param {number|null} value - 毫秒数。
 * @returns {string} 本地化时长文本。
 */
export function workDuration(value) {
	if (value == null) return '—'
	const seconds = Math.max(0, Math.floor(value / 1000))
	return geti18n('code.statistics.duration', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
}

/**
 * 为一个工作区间创建计时标签。
 * @param {object} work - 已测得的区间。
 * @param {boolean} [live] - 该运行是否仍在进行。
 * @returns {HTMLElement} 计时标签。
 */
export function createWorkClock(work, live = false) {
	const label = document.createElement('div')
	label.className = 'code-work-clock'
	label.dataset.startedAt = String(work.startedAt)
	if (work.finishedAt) label.dataset.finishedAt = String(work.finishedAt)
	label.dataset.live = String(live)
	paintClock(label)
	return label
}

/**
 * 按当前时间重绘计时标签。
 * @param {HTMLElement} label - 计时标签。
 * @returns {void}
 */
function paintClock(label) {
	const start = Number(label.dataset.startedAt)
	if (!Number.isFinite(start)) return
	const duration = workDuration(Number(label.dataset.finishedAt || Date.now()) - start)
	const text = geti18n(label.dataset.live === 'true' ? 'code.statistics.working' : 'code.statistics.worked', { duration })
	if (label.textContent !== text) label.textContent = text
}

/**
 * 就地更新一个字段（值未变时不碰 DOM）。
 * @param {string} key - 指标键。
 * @param {string} value - 展示文本。
 * @returns {void}
 */
function set(key, value) {
	const node = fields.get(key)
	if (node && node.textContent !== value) node.textContent = value
	if (node?.parentElement?.tagName === 'SUMMARY') node.parentElement.setAttribute('aria-label', `${geti18n(`code.statistics.${key}.title`)} · ${value}`)
}

/** 创建稳定的详情节点，使流式更新保留焦点和展开状态。 @returns {void} */
function mount() {
	root = document.getElementById('code-statistics')
	if (!root || root.children.length) return
	for (const [group, keys] of Object.entries({
		performance: ['modelTime', 'toolTime', 'toolWait', 'toolCount', 'asyncTime', 'ttft', 'speed'],
		tokens: ['total', 'cache', 'uncached', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'incomplete'],
		context: ['contextTotal', 'system', 'tools', 'messages', 'other', 'contextNote'],
	})) {
		const details = document.createElement('details')
		details.className = 'code-statistic'
		const summary = document.createElement('summary')
		const icon = iconElement({ performance: 'mdi/speedometer', tokens: 'mdi/database-outline', context: 'mdi/chart-donut' }[group], { size: 14 })
		const summaryText = document.createElement('span')
		summary.append(icon, summaryText)
		fields.set(group, summaryText)
		const panel = document.createElement('div')
		panel.className = 'code-statistic-panel'
		const heading = document.createElement('strong')
		heading.dataset.statisticsHeading = group
		panel.appendChild(heading)
		if (group === 'context') {
			const meter = document.createElement('div')
			meter.className = 'code-context-meter'
			meter.setAttribute('role', 'meter')
			const used = document.createElement('div')
			used.className = 'code-context-meter-used'
			for (const key of ['system', 'tools', 'messages', 'other']) {
				const segment = document.createElement('span')
				segment.dataset.contextSegment = key
				used.appendChild(segment)
			}
			meter.appendChild(used)
			panel.appendChild(meter)
		}
		for (const key of keys) {
			const row = document.createElement('div')
			row.className = 'code-statistic-row'
			const label = document.createElement('span')
			label.dataset.statisticsLabel = key
			const value = document.createElement('span')
			fields.set(key, value)
			row.append(label, value)
			panel.appendChild(row)
		}
		details.append(summary, panel)
		let pinned = false
		summary.addEventListener('click', event => { event.preventDefault(); pinned = !pinned; details.open = pinned })
		details.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') details.open = true })
		details.addEventListener('pointerleave', () => { if (!pinned && !details.contains(document.activeElement)) details.open = false })
		details.addEventListener('focusout', event => { if (!pinned && !details.contains(event.relatedTarget)) details.open = false })
		details.addEventListener('keydown', event => { if (event.key === 'Escape') { pinned = false; details.open = false; summary.focus() } })
		document.addEventListener('click', event => { if (!details.contains(event.target)) { pinned = false; details.open = false } })
		root.appendChild(details)
		void svgInliner(summary)
	}
}

/** 只绘制当前活动会话的统计快照。 @returns {void} */
export function refreshStatistics() {
	mount()
	if (!root) return
	const session = store.session
	root.hidden = !session || activeTab()?.type === 'file'
	if (root.hidden) return
	for (const label of root.querySelectorAll('[data-statistics-label]')) label.textContent = geti18n(`code.statistics.${{ contextTotal: 'context.total', contextNote: 'context.note' }[label.dataset.statisticsLabel] ?? label.dataset.statisticsLabel}`)
	for (const heading of root.querySelectorAll('[data-statistics-heading]')) heading.textContent = geti18n(`code.statistics.${heading.dataset.statisticsHeading}.title`)
	const metrics = summarizeStatistics(session.statistics, session.usage, session.entries)
	const total = session.usage?.total ?? {}
	const speed = metrics.tps == null ? '—' : decimalFormat.format(metrics.tps)
	set('performance', geti18n('code.statistics.performance.summary', { rounds: session.statistics ? metrics.rounds : '—', steps: session.statistics ? metrics.steps : '—', speed }))
	set('modelTime', workDuration(metrics.modelMs))
	set('toolTime', workDuration(metrics.toolMs))
	set('asyncTime', workDuration(metrics.asyncMs))
	set('toolWait', workDuration(metrics.toolCount ? metrics.toolWaitMs : null))
	set('toolCount', session.statistics ? count(metrics.toolCount) : '—')
	set('ttft', metrics.ttftMs == null ? '—' : geti18n('code.statistics.ttftValue', { seconds: (metrics.ttftMs / 1000).toFixed(2), count: metrics.ttftCount }))
	set('speed', `${speed} tok/s`)
	const tokens = total.inputTokens != null && total.outputTokens != null ? total.inputTokens + total.outputTokens : null
	set('tokens', geti18n('code.statistics.tokens.summary', { tokens: count(tokens), rate: percent(metrics.cacheRate) }))
	set('total', tokens == null ? '—' : `${plainFormat.format(tokens)} tok`)
	set('cache', percent(metrics.cacheRate))
	set('uncached', total.inputTokens != null && total.cacheReadTokens != null && !metrics.cacheIncomplete ? count(total.inputTokens - total.cacheReadTokens) : '—')
	set('cacheRead', count(total.cacheReadTokens))
	set('cacheWrite', count(total.cacheWriteTokens))
	set('output', count(total.outputTokens))
	set('reasoning', count(total.reasoningTokens))
	set('incomplete', geti18n(!session.usage?.calls?.length || metrics.cacheIncomplete ? 'code.statistics.partial' : 'code.statistics.reported'))
	const context = metrics.context
	const ratio = context?.limit > 0 ? context.total / context.limit : null
	set('context', `${context?.estimated && ratio != null ? '~' : ''}${percent(ratio)}`)
	const meter = root.querySelector('.code-context-meter')
	meter.hidden = ratio == null
	if (ratio != null) {
		meter.setAttribute('aria-label', geti18n('code.statistics.context.title'))
		meter.setAttribute('aria-valuemin', '0')
		meter.setAttribute('aria-valuemax', String(context.limit))
		meter.setAttribute('aria-valuenow', String(Math.min(context.limit, context.total)))
		meter.firstElementChild.style.width = `${Math.min(100, ratio * 100)}%`
		for (const segment of meter.querySelectorAll('[data-context-segment]')) segment.style.flexGrow = String(context.components[segment.dataset.contextSegment] ?? 0)
	}
	set('contextTotal', context ? `${context.estimated ? '~' : ''}${count(context.total)} / ${count(context.limit)}` : '—')
	for (const key of ['system', 'tools', 'messages', 'other']) set(key, context ? `~${count(context.components[key])}` : '—')
	set('contextNote', geti18n('code.statistics.context.snapshot'))
	for (const label of document.querySelectorAll('.code-work-clock')) paintClock(label)
}

/** 启动页面计时器；权威起止时间来自后端工作区间。 @returns {void} */
export function initStatistics() {
	mount()
	refreshStatistics()
	setInterval(() => {
		const runtime = getActiveRuntime()
		const work = runtime?.session?.statistics?.runs?.at(-1)
		const bubble = document.querySelector('.code-message.generating')
		if (bubble && work?.runId === runtime?.runId && work.startedAt && !bubble.querySelector('.code-work-clock')) bubble.appendChild(createWorkClock(work, true))
		for (const label of document.querySelectorAll('.code-work-clock')) paintClock(label)
	}, 1000)
}
