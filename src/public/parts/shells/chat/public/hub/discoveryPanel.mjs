/**
 * Hub 群发现侧栏/模态。
 */
import { openDialogFromTemplate } from '../../../../scripts/dialog.mjs'
import { renderTemplateAsHtmlString, usingTemplates } from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { fetchDiscoveryIndex, refreshDiscoveryGossip } from '../src/api/discoveryApi.mjs'

import { escapeHtml } from './core/domUtils.mjs'
import { selectGroup } from './groupNav.mjs'

/**
 * @param {Array<{ groupId: string, title?: string, blurb?: string, sources?: Array<{ fromNodeHash?: string }> }>} entries 发现条目
 * @returns {Promise<string>} 列表 HTML 片段
 */
async function renderDiscoveryListHtml(entries) {
	if (!entries.length)
		return await renderTemplateAsHtmlString('hub/modals/discovery_empty', {})
	usingTemplates('/parts/shells:chat/src/templates')
	const parts = await Promise.all(entries.map(async entry => {
		const sources = (entry.sources || [])
			.map(source => escapeHtml(source.fromNodeHash?.slice(0, 12) || '?'))
			.join(', ')
		return renderTemplateAsHtmlString('hub/modals/discovery_row', {
			groupId: escapeHtml(entry.groupId),
			title: escapeHtml(entry.title || entry.groupId),
			blurb: escapeHtml(entry.blurb || ''),
			sources,
		})
	}))
	return parts.join('')
}

/**
 * 打开群发现列表模态。
 * @returns {Promise<void>}
 */
export async function openDiscoveryPanel() {
	void refreshDiscoveryGossip().catch(() => { })
	let entries = []
	try {
		const data = await fetchDiscoveryIndex({ limit: 80 })
		entries = data.entries || []
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.discoveryLoadFailed', { message: error.message })
		return
	}

	usingTemplates('/parts/shells:chat/src/templates')
	const listHtml = await renderDiscoveryListHtml(entries)
	await openDialogFromTemplate('hub/modals/discovery_modal', { listHtml }, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			dialog.querySelector('[data-discovery-close]')?.addEventListener('click', () => dialog.close())
			dialog.querySelector('[data-discovery-refresh]')?.addEventListener('click', async () => {
				dialog.close()
				await openDiscoveryPanel()
			})
			dialog.querySelectorAll('.hub-discovery-row[data-group-id]').forEach(row => {
				/**
				 * @returns {Promise<void>}
				 */
				const openGroup = async () => {
					const groupId = row.getAttribute('data-group-id')
					if (!groupId) return
					dialog.close()
					await selectGroup(groupId)
				}
				row.addEventListener('click', () => { void openGroup() })
				row.addEventListener('keydown', event => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault()
						void openGroup()
					}
				})
			})
		},
	})
}
