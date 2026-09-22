/**
 * 【文件】public/src/lib/generationItem.mjs — 生成条目渲染助手
 * 【职责】把生成记录摘要渲染为统一的列表项，并绑定详情对话框。
 * 【原理】复用 `generation_item` 模板；时间按当前页面 locale 格式化；记录列表与生成链共用。
 * 【关联】templates/generation_item.html、views/dashboard.mjs、views/generations.mjs。
 */
import { geti18n, primaryLocale } from '/scripts/i18n/index.mjs'

import { renderTemplate } from '../templates.mjs'

import { bindActivate } from './activate.mjs'
import { formatTime, truncate } from './format.mjs'
import { openGenerationDialog } from './generationDialog.mjs'

/**
 * 计算生成条目的显示字段。
 * @param {object} record 记录摘要
 * @param {{ model?: boolean }} [options] 选项（`model` 为 false 时元信息不展示模型）
 * @returns {{ id: string, preview: string, meta: string, status: string, badgeClass: string }} 字段
 */
function generationItemFields(record, { model = true } = {}) {
	return {
		id: record.id,
		preview: truncate(record.charname || record.conversationId || record.id),
		meta: [record.source || '', model ? record.model : '', formatTime(record.startedAt, primaryLocale())].filter(Boolean).join(' · '),
		status: record.hasError ? geti18n('agent_studio.generation.error') : geti18n('agent_studio.generation.ok'),
		badgeClass: record.hasError ? 'badge-error' : 'badge-ghost',
	}
}

/**
 * 渲染生成列表项并绑定打开详情。
 * @param {object} record 记录摘要
 * @param {{ model?: boolean }} [options] 选项
 * @returns {Promise<HTMLElement>} 列表项
 */
export async function renderGenerationItem(record, options) {
	const item = await renderTemplate('generation_item', generationItemFields(record, options))
	bindActivate(item, () => { void openGenerationDialog(record.id) })
	return item
}
