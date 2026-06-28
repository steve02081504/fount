/**
 * 【文件】public/src/auditLogPanel.mjs
 * 【职责】群设置内审计日志面板：虚拟列表展示 fetchGroupAuditLog 结果。
 * 【原理】initAuditLogPanel 挂载模板与 virtualList；dispose 清理监听。
 * 【数据结构】groupId、审计行 { action, actor, timestamp, ... }。
 * 【关联】groupSettings.mjs、groupApi(groupCore)、virtualList.mjs。
 */
import {
	renderTemplate,
	renderTemplateAsHtmlString,
	usingTemplates,
} from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { createVirtualList } from '../../../../scripts/virtualList.mjs'

import { fetchGroupAuditLog } from './api/groupApi.mjs'
import { escapeHtml } from './lib/escapeHtml.mjs'


/** @type {string | null} */
let auditGroupId = null
/** @type {string[] | undefined} */
let auditTypeFilter = undefined
/** @type {string[]} */
let auditTypeOptions = []
/** @type {ReturnType<typeof createVirtualList> | null} */
let auditVirtualList = null
/** @type {AbortController | null} */
let auditController = null

/**
 * @param {HTMLElement} el 目标元素
 * @param {string} i18nKey data-i18n 键
 * @param {Record<string, string | number>} [params] dataset 插值
 * @returns {void}
 */
function applyDatasetI18n(el, i18nKey, params = {}) {
	if (!el) return
	el.dataset.i18n = i18nKey
	for (const k of Object.keys(el.dataset))
		if (k !== 'i18n') delete el.dataset[k]
	for (const [k, v] of Object.entries(params))
		el.dataset[k] = String(v)
	el.textContent = ''
}

/**
 * @param {number} ms 时间戳
 * @returns {string} 本地化时间
 */
function formatAuditTime(ms) {
	if (!Number.isFinite(ms) || ms <= 0) return '—'
	return new Date(ms).toLocaleString()
}

/** @returns {string[] | undefined} 当前类型筛选 */
function readTypeFilter() {
	const value = document.getElementById('audit-log-type-filter')?.value
	return value ? [value] : undefined
}

/**
 * 切换列表/空状态可见性。
 * @param {boolean} empty 无记录时为 true
 * @returns {void}
 */
function setAuditEmptyVisible(empty) {
	document.getElementById('audit-log-container')?.classList.toggle('hidden', empty)
	document.getElementById('audit-log-empty')?.classList.toggle('hidden', !empty)
}

/** 渲染类型筛选下拉。 */
async function renderAuditTypeFilter() {
	const select = document.getElementById('audit-log-type-filter')
	if (!select) return
	const current = select.value
	const types = auditTypeOptions.map(type => ({ value: escapeHtml(type) }))
	select.innerHTML = await renderTemplateAsHtmlString('group/audit/type_filter_options', { types })
	if (current && [...select.options].some(opt => opt.value === current)) select.value = current
}

/**
 * @param {object} entry 审计条目
 * @returns {Promise<HTMLElement>} 行节点
 */
async function renderAuditRow(entry) {
	const row = await renderTemplate('group/audit/row', {
		time: escapeHtml(formatAuditTime(entry.at)),
		senderTitle: escapeHtml(entry.sender || ''),
		sender: escapeHtml(entry.sender || '—'),
	})
	const type = String(entry.type || '')
	const typeEl = row.querySelector('[data-audit-type]')
	const summaryEl = row.querySelector('[data-audit-summary]')
	applyDatasetI18n(typeEl, `chat.group.auditLog.type.${type}`)
	applyDatasetI18n(summaryEl, `chat.group.auditLog.event.${type}`, entry.params || {})
	return row
}

/**
 * 挂载虚拟滚动审计列表（新→旧，向下滚动加载更早记录）。
 * @returns {void}
 */
function mountAuditVirtualList() {
	const scroll = document.getElementById('audit-log-scroll')
	if (!scroll || !auditGroupId) return

	auditVirtualList?.destroy()
	auditVirtualList = createVirtualList({
		container: scroll,
		initialIndex: 0,
		setInitialScroll: true,
		/**
		 * @param {number} offset 全局偏移（0 = 最新）
		 * @param {number} limit 条数；0 仅取 total
		 * @returns {Promise<{items: object[], total: number}>} 当前切片与总条数
		 */
		fetchData: async (offset, limit) => {
			try {
				const data = await fetchGroupAuditLog(auditGroupId, {
					offset,
					limit: limit || 0,
					types: auditTypeFilter,
				})
				if (data.types?.length) {
					auditTypeOptions = data.types
					await renderAuditTypeFilter()
				}
				return { items: data.entries, total: data.total }
			}
			catch (error) {
				showToastI18n('error', 'chat.group.auditLog.loadFailed', { error: error.message })
				return { items: [], total: 0 }
			}
		},
		renderItem: renderAuditRow,
		/** 每次渲染批次完成后切换空状态。 @returns {void} */
		onRenderComplete: () => {
			const empty = !auditVirtualList?.getQueue()?.length
			setAuditEmptyVisible(empty)
		},
	})
}

/** 按当前筛选刷新虚拟列表。 */
function refreshAuditVirtualList() {
	auditTypeFilter = readTypeFilter()
	if (auditVirtualList) auditVirtualList.refresh()
	else mountAuditVirtualList()
}

/**
 * 初始化群设置页的审计日志面板。
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function initAuditLogPanel(groupId) {
	usingTemplates('/parts/shells:chat/src/templates')
	auditGroupId = groupId
	auditTypeFilter = readTypeFilter()
	auditController?.abort()
	auditController = new AbortController()
	const { signal } = auditController

	document.getElementById('audit-log-refresh')?.addEventListener('click', () => {
		refreshAuditVirtualList()
	}, { signal })

	document.getElementById('audit-log-type-filter')?.addEventListener('change', () => {
		refreshAuditVirtualList()
	}, { signal })

	mountAuditVirtualList()
}

/** 卸载审计面板监听器。 */
export function disposeAuditLogPanel() {
	auditController?.abort()
	auditController = null
	auditVirtualList?.destroy()
	auditVirtualList = null
	auditGroupId = null
	auditTypeOptions = []
	setAuditEmptyVisible(true)
}
