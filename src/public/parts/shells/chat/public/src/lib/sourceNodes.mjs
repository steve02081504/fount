/**
 * 联邦 part_query 结果的来源节点展示与屏蔽（节点级 denylist）。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { confirmAction } from '/scripts/features/promptDialog.mjs'

import { addDenylistEntry } from '../endpoints/p2p.mjs'

/**
 * @param {string} nodeHash 64 位 hex
 * @returns {string} 展示用短标签
 */
export function sourceNodeShort(nodeHash) {
	const value = String(nodeHash || '')
	return value.length > 16 ? `${value.slice(0, 12)}…` : value
}

/**
 * 渲染来源节点条（每个节点带屏蔽按钮）；无来源时返回空串。
 * @param {string[] | undefined} sourceNodes 来源节点
 * @returns {string} HTML
 */
export function renderSourceNodesHtml(sourceNodes) {
	const nodes = [...new Set((sourceNodes || []).filter(Boolean))]
	if (!nodes.length) return ''
	const chips = nodes.map(nodeHash => {
		const hash = escapeHtml(nodeHash)
		const short = escapeHtml(sourceNodeShort(nodeHash))
		return `<span class="source-node-chip"><span class="source-node-hash" user-content title="${hash}">${short}</span><button type="button" class="source-node-block text-error" data-block-source-node="${hash}" data-i18n="chat.sourceNode.block"></button></span>`
	}).join('')
	return `<div class="source-nodes" data-source-node-list><span class="source-nodes-label" data-i18n="chat.sourceNode.label"></span>${chips}</div>`
}

/**
 * 处理来源节点屏蔽按钮点击：确认 → 写入节点 denylist → 移除来源 UI。
 * @param {HTMLElement} button 带 data-block-source-node 的按钮
 * @returns {Promise<void>}
 */
export async function handleSourceNodeBlockClick(button) {
	const nodeHash = button.dataset.blockSourceNode
	if (!nodeHash) return
	const ok = await confirmAction('chat.sourceNode.blockConfirm', { node: sourceNodeShort(nodeHash) })
	if (!ok) return

	const chip = button.closest('.source-node-chip')
	const list = button.closest('[data-source-node-list]')
	const item = list?.closest('[data-source-node-item]')
	try {
		await addDenylistEntry({ scope: 'node', value: nodeHash })
		chip?.remove()
		if (list instanceof HTMLElement && !list.querySelector('.source-node-chip')) {
			const target = item instanceof HTMLElement ? item : list
			target.remove()
		}
		showToastI18n('success', 'chat.sourceNode.blocked')
	}
	catch (error) {
		handleError('chat.sourceNode.blockFailed', {}, error)
	}
}
