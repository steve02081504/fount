/**
 * 【文件】public/src/views/dashboard.mjs — 仪表盘视图
 * 【职责】渲染角色列表（可搜索）与选中角色的概览：子代理运行、近期生成。
 * 【原理】角色数据来自共享 `state.chars`；详情经 `/char/:id/overview` 拉取；生成详情复用共享对话框。
 * 【关联】endpoints.mjs、state.mjs、lib/generationDialog.mjs、index.html。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { getCharOverview } from '../endpoints.mjs'
import { bindActivate } from '../lib/activate.mjs'
import { createCacheBadge } from '../lib/cacheBadge.mjs'
import { renderConversationItem } from '../lib/conversationItem.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { requestNavigate } from '../lib/navigationEvents.mjs'
import { stateBadge } from '../lib/stateBadge.mjs'
import { state } from '../state.mjs'
import { renderTemplate } from '../templates.mjs'

/** 默认头像（Iconify 机器人图标）。 */
const DEFAULT_AVATAR = 'https://api.iconify.design/mdi/robot-outline.svg'

/** 当前角色名过滤词。 */
let charFilter = ''

/**
 * 绑定仪表盘内的静态控件。
 * @returns {void}
 */
export function initDashboardView() {
	const search = document.getElementById('charSearchInput')
	search?.addEventListener('input', () => {
		charFilter = search instanceof HTMLInputElement ? search.value : ''
		void renderCharList()
	})
	const refresh = document.getElementById('dashboardRefreshButton')
	refresh?.addEventListener('click', () => { void reloadDetail() })
}

/**
 * 加载仪表盘视图。
 * @returns {Promise<void>}
 */
export async function loadDashboard() {
	await renderCharList()
	const hasActive = state.activeCharId && state.chars.some(char => char.id === state.activeCharId)
	if (hasActive) await selectChar(state.activeCharId)
	else await showDetailPlaceholder()
}

/**
 * 重新拉取当前角色概览（数据可能已变化）。
 * @returns {Promise<void>}
 */
async function reloadDetail() {
	if (state.activeCharId) await selectChar(state.activeCharId)
	else await loadDashboard()
}

/**
 * 渲染角色列表。
 * @returns {Promise<void>}
 */
async function renderCharList() {
	const list = document.getElementById('charList')
	const empty = document.getElementById('charListEmpty')
	if (!list || !empty) return
	list.replaceChildren()
	const query = charFilter.trim().toLowerCase()
	const chars = state.chars.filter(char => {
		if (!query) return true
		const info = char.info ?? {}
		return String(info.name || char.id).toLowerCase().includes(query)
			|| String(info.description || '').toLowerCase().includes(query)
	})
	for (const char of chars) {
		const info = char.info ?? {}
		const item = await renderTemplate('char_item', {
			id: char.id,
			avatar: info.avatar || DEFAULT_AVATAR,
			name: info.name || char.id,
			description: info.description || '',
		})
		const cacheBadge = createCacheBadge(char.minCacheRate)
		if (cacheBadge) item.appendChild(cacheBadge)
		item.classList.toggle('active', char.id === state.activeCharId)
		bindActivate(item, () => { void selectChar(char.id) })
		list.appendChild(item)
	}
	empty.classList.toggle('hidden', chars.length > 0)
	if (!chars.length)
		await mountEmptyState(empty, {
			titleKey: charFilter ? 'agent_studio.chars.noMatch' : 'agent_studio.chars.empty',
			iconClass: 'icon-search',
		})
}

/**
 * 显示未选角色的占位。
 * @returns {Promise<void>}
 */
async function showDetailPlaceholder() {
	document.getElementById('charDetail')?.classList.add('hidden')
	const placeholder = document.getElementById('charDetailPlaceholder')
	if (!placeholder) return
	placeholder.classList.remove('hidden')
	await mountEmptyState(placeholder, {
		titleKey: 'agent_studio.dashboard.selectPrompt',
		iconClass: 'icon-dashboard',
	})
}

/**
 * 选择角色并加载概览。
 * @param {string} charId 角色 id
 * @returns {Promise<void>}
 */
export async function selectChar(charId) {
	state.activeCharId = charId
	for (const item of document.querySelectorAll('#charList .char-item'))
		item.classList.toggle('active', item.dataset.charId === charId)
	document.getElementById('charDetailPlaceholder')?.classList.add('hidden')
	document.getElementById('charDetail')?.classList.remove('hidden')
	try {
		const overview = await getCharOverview(charId, { limit: 50 })
		renderCharHero(overview)
		await renderSubAgents(overview.subAgents)
		await renderGenerations(overview.conversations)
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}

/**
 * 渲染角色头部（头像 / 名称 / 描述 / 支持接口）。
 * @param {object} overview 角色概览
 * @returns {void}
 */
function renderCharHero(overview) {
	const info = overview.char ?? {}
	const avatar = document.getElementById('charHeroAvatar')
	if (avatar instanceof HTMLImageElement) avatar.src = info.avatar || DEFAULT_AVATAR
	const name = document.getElementById('charHeroName')
	if (name) name.textContent = info.name || overview.char?.id || ''
	const description = document.getElementById('charHeroDescription')
	if (description) description.textContent = info.description || ''
	const interfaces = document.getElementById('charHeroInterfaces')
	if (!interfaces) return
	interfaces.replaceChildren()
	for (const interfaceName of overview.supportedInterfaces ?? []) {
		const badge = document.createElement('span')
		badge.className = 'badge badge-outline badge-sm'
		badge.textContent = interfaceName
		interfaces.appendChild(badge)
	}
}

/**
 * 渲染子代理运行列表。
 * @param {object[]} runs 运行列表
 * @returns {Promise<void>}
 */
async function renderSubAgents(runs) {
	const list = document.getElementById('subAgentList')
	const empty = document.getElementById('subAgentEmpty')
	if (!list || !empty) return
	list.replaceChildren()
	const items = runs ?? []
	empty.classList.toggle('hidden', items.length > 0)
	if (!items.length) {
		await mountEmptyState(empty, { titleKey: 'agent_studio.detail.none' })
		return
	}
	for (const run of items) {
		const runState = run.live?.state || (run.hasError ? 'failed' : 'done')
		const detail = geti18n('agent_studio.run.detail', {
			generations: run.generationIds?.length ?? 0,
			rounds: run.live?.rounds ?? 0,
			roundLimit: run.live?.roundLimit ?? '-',
		})
		const item = await renderTemplate('run_item', {
			runId: run.runId,
			task: run.task || run.runId,
			state: geti18n(`agent_studio.run.state.${runState}`),
			badgeClass: stateBadge(runState),
			detail,
		})
		const cacheBadge = createCacheBadge(run.minCacheRate)
		if (cacheBadge) item.querySelector('.run-item-head')?.appendChild(cacheBadge)
		item.addEventListener('click', () => { requestNavigate('conversation', { key: `subagent:${run.runId}` }) })
		list.appendChild(item)
	}
}

/**
 * 渲染近期生成列表。
 * @param {object[]} records 记录摘要
 * @returns {Promise<void>}
 */
async function renderGenerations(records) {
	const list = document.getElementById('generationList')
	const empty = document.getElementById('generationEmpty')
	if (!list || !empty) return
	list.replaceChildren()
	const items = records ?? []
	empty.classList.toggle('hidden', items.length > 0)
	if (!items.length) {
		await mountEmptyState(empty, { titleKey: 'agent_studio.detail.none' })
		return
	}
	for (const record of items)
		list.appendChild(await renderConversationItem(record))
}
