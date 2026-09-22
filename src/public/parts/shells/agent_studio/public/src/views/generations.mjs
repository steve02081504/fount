/**
 * 【文件】public/src/views/generations.mjs — 生成记录视图
 * 【职责】浏览全部角色的生成记录与生成链，支持按角色筛选与记录 / 链切换。
 * 【原理】记录走 `/generations`，链走 `/chains`；两者共用筛选条件；记录详情复用共享对话框。
 * 【关联】endpoints.mjs、state.mjs、lib/generationDialog.mjs、index.html。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { listChains, listGenerations } from '../endpoints.mjs'
import { bindActivate } from '../lib/activate.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { formatTime, truncate } from '../lib/format.mjs'
import { openGenerationDialog } from '../lib/generationDialog.mjs'
import { state } from '../state.mjs'
import { renderTemplate } from '../templates.mjs'

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
	select.replaceChildren()
	const all = document.createElement('option')
	all.value = ''
	all.textContent = geti18n('agent_studio.generations.allChars')
	select.appendChild(all)
	for (const char of state.chars) {
		const option = document.createElement('option')
		option.value = char.id
		option.textContent = char.info?.name || char.id
		select.appendChild(option)
	}
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
 * 渲染生成记录列表。
 * @returns {Promise<void>}
 */
async function renderRecords() {
	const records = await listGenerations(currentFilter())
	const list = document.getElementById('generationRecordsList')
	const empty = document.getElementById('generationRecordsEmpty')
	const count = document.getElementById('generationRecordsCount')
	if (!list || !empty) return
	list.replaceChildren()
	if (count)
		count.textContent = records.length ? geti18n('agent_studio.generations.recordsCount', { count: records.length }) : ''
	empty.classList.toggle('hidden', records.length > 0)
	if (!records.length) {
		await mountEmptyState(empty, { titleKey: 'agent_studio.generations.empty', iconClass: 'icon-branch' })
		return
	}
	for (const record of records) {
		const item = await renderTemplate('generation_item', {
			id: record.id,
			preview: truncate(record.charname || record.conversationId || record.id),
			meta: [record.source || '', record.model || '', formatTime(record.startedAt)].filter(Boolean).join(' · '),
			status: record.hasError ? geti18n('agent_studio.generation.error') : geti18n('agent_studio.generation.ok'),
			badgeClass: record.hasError ? 'badge-error' : 'badge-ghost',
		})
		bindActivate(item, () => { void openGenerationDialog(record.id) })
		list.appendChild(item)
	}
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
		list.appendChild(renderChainNode(root, 0))
}

/**
 * 递归渲染一个生成链节点。
 * @param {{ record: object, children: object[] }} node 链节点
 * @param {number} depth 深度
 * @returns {HTMLElement} 节点元素
 */
function renderChainNode(node, depth) {
	const item = document.createElement('li')
	item.className = 'chain-node'
	if (depth > 0) item.classList.add('chain-node--nested')

	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'chain-node-btn'
	const record = node.record
	button.innerHTML = `
		<span class="generation-dot" aria-hidden="true"></span>
		<span class="chain-node-body">
			<span class="generation-preview" user-content></span>
			<span class="generation-meta" user-content></span>
		</span>
		<span class="badge ${record.hasError ? 'badge-error' : 'badge-ghost'}"></span>`
	const preview = button.querySelector('.generation-preview')
	if (preview) preview.textContent = truncate(record.charname || record.conversationId || record.id)
	const meta = button.querySelector('.generation-meta')
	if (meta) meta.textContent = [record.source || '', formatTime(record.startedAt)].filter(Boolean).join(' · ')
	const badge = button.querySelector('.badge')
	if (badge) badge.textContent = record.hasError ? geti18n('agent_studio.generation.error') : geti18n('agent_studio.generation.ok')
	button.addEventListener('click', () => { void openGenerationDialog(record.id) })
	item.appendChild(button)

	if (node.children?.length) {
		const children = document.createElement('ul')
		children.className = 'chain-children'
		for (const child of node.children)
			children.appendChild(renderChainNode(child, depth + 1))
		item.appendChild(children)
	}
	return item
}
