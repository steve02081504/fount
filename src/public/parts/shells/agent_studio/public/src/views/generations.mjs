/**
 * 【文件】public/src/views/generations.mjs — 生成记录视图
 * 【职责】浏览全部角色的生成记录与生成链，支持按角色筛选与记录 / 链切换。
 * 【原理】记录走 `/generations`，链走 `/chains`；两者共用筛选条件；记录详情复用共享对话框。
 * 【关联】endpoints.mjs、state.mjs、lib/generationDialog.mjs、index.html。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { listChains, listConversations } from '../endpoints.mjs'
import { fillCharOptions } from '../lib/charOptions.mjs'
import { renderConversationItem } from '../lib/conversationItem.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { renderGenerationItem } from '../lib/generationItem.mjs'
import { state } from '../state.mjs'

/** 每次拉取的最大记录数。 */
const FETCH_LIMIT = 200

/** 当前子标签：records / chains。 */
let activeTab = 'records'
/** 角色筛选值；空串表示全部。 */
let charFilter = ''

/**
 * 绑定生成视图内的静态控件。
 * @returns {void}
 */
export function initGenerationsView() {
	for (const button of document.querySelectorAll('[data-generation-tab]'))
		button.addEventListener('click', () => {
			const tab = button.dataset.generationTab
			if (!tab || tab === activeTab) return
			activeTab = tab
			syncTabs()
			void reloadActiveTab()
		})
	document.getElementById('generationCharFilter')?.addEventListener('change', event => {
		charFilter = event.target instanceof HTMLSelectElement ? event.target.value : ''
		void reloadActiveTab()
	})
	document.getElementById('generationsRefreshButton')?.addEventListener('click', () => { void reloadActiveTab() })
}

/**
 * 加载生成视图。
 * @returns {Promise<void>}
 */
export async function loadGenerations() {
	renderCharFilter()
	syncTabs()
	await reloadActiveTab()
}

/**
 * 同步子标签高亮。
 * @returns {void}
 */
function syncTabs() {
	for (const button of document.querySelectorAll('[data-generation-tab]')) {
		const active = button.dataset.generationTab === activeTab
		button.classList.toggle('tab-active', active)
		button.setAttribute('aria-selected', String(active))
	}
}

/**
 * 填充角色筛选下拉。
 * @returns {void}
 */
function renderCharFilter() {
	const select = document.getElementById('generationCharFilter')
	if (!(select instanceof HTMLSelectElement)) return
	const previous = select.value
	fillCharOptions(select, { allCharsKey: 'agent_studio.generations.allChars' })
	if (previous && state.chars.some(char => char.id === previous)) select.value = previous
	else if (charFilter && state.chars.some(char => char.id === charFilter)) select.value = charFilter
	else {
		charFilter = ''
		select.value = ''
	}
}

/**
 * 重新加载当前子标签的数据。
 * @returns {Promise<void>}
 */
async function reloadActiveTab() {
	document.getElementById('generationRecordsPanel')?.classList.toggle('hidden', activeTab !== 'records')
	document.getElementById('generationChainsPanel')?.classList.toggle('hidden', activeTab !== 'chains')
	try {
		if (activeTab === 'records') await renderRecords()
		else await renderChains()
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}

/**
 * 构造筛选条件。
 * @returns {{ charId?: string, limit: number }} 过滤条件
 */
function currentFilter() {
	return charFilter ? { charId: charFilter, limit: FETCH_LIMIT } : { limit: FETCH_LIMIT }
}

/**
 * 渲染会话列表（每行一个对话，进入后可见逐轮生成）。
 * @returns {Promise<void>}
 */
async function renderRecords() {
	const conversations = await listConversations(currentFilter())
	const list = document.getElementById('generationRecordsList')
	const empty = document.getElementById('generationRecordsEmpty')
	const count = document.getElementById('generationRecordsCount')
	if (!list || !empty) return
	list.replaceChildren()
	if (count)
		count.textContent = conversations.length ? geti18n('agent_studio.generations.conversationsCount', { count: conversations.length }) : ''
	empty.classList.toggle('hidden', conversations.length > 0)
	if (!conversations.length) {
		await mountEmptyState(empty, { titleKey: 'agent_studio.generations.conversationsEmpty', iconClass: 'icon-branch' })
		return
	}
	for (const conversation of conversations)
		list.appendChild(await renderConversationItem(conversation))
}

/**
 * 渲染生成链列表。
 * @returns {Promise<void>}
 */
async function renderChains() {
	const roots = await listChains(currentFilter())
	const list = document.getElementById('generationChainsList')
	const empty = document.getElementById('generationChainsEmpty')
	if (!list || !empty) return
	list.replaceChildren()
	empty.classList.toggle('hidden', roots.length > 0)
	if (!roots.length) {
		await mountEmptyState(empty, { titleKey: 'agent_studio.generations.chainsEmpty', iconClass: 'icon-branch' })
		return
	}
	for (const root of roots)
		list.appendChild(await renderChainNode(root, 0))
}

/**
 * 递归渲染一个生成链节点。
 * @param {{ record: object, children: object[] }} node 链节点
 * @param {number} depth 深度
 * @returns {Promise<HTMLElement>} 节点元素
 */
async function renderChainNode(node, depth) {
	const wrapper = document.createElement('li')
	wrapper.className = 'chain-node'
	if (depth > 0) wrapper.classList.add('chain-node--nested')
	wrapper.appendChild(await renderGenerationItem(node.record, { model: false }))
	if (node.children?.length) {
		const children = document.createElement('ul')
		children.className = 'chain-children'
		for (const child of node.children)
			children.appendChild(await renderChainNode(child, depth + 1))
		wrapper.appendChild(children)
	}
	return wrapper
}
