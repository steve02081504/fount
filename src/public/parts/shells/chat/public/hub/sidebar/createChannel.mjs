/**
 * 【文件】public/hub/sidebar/createChannel.mjs
 * 【职责】新建频道对话框与入树刷新（可选在父频道下创建并链接）。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { autoNameChannels, createChannel, updateChannel } from '../../src/endpoints/groupChannel.mjs'
import { getGroupState } from '../../src/endpoints/groupCore.mjs'
import { openDialogFromTemplate, renderTemplate } from '../../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { store, setState } from '../core/state.mjs'
import { findParentChannelId } from '../shared/channelReorder.mjs'

import { selectChannel } from './selectChannel.mjs'

/**
 * 刷新当前群侧栏频道树。
 * @returns {Promise<void>}
 */
export async function refreshChannelSidebar() {
	setState('context.currentState', await getGroupState(store.context.currentGroupId))
	const { renderHubChannelSidebar } = await import('./index.mjs')
	await renderHubChannelSidebar(store.context.currentState)
}

/**
 * 把已创建的频道移动到指定父频道的 links 最上方（新建频道默认追加到父末尾，此处置顶）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 新频道 id
 * @param {string} parentChannelId 目标父频道 id
 * @returns {Promise<void>}
 */
async function moveChannelToTop(groupId, channelId, parentChannelId) {
	const state = await getGroupState(groupId)
	const links = (state.channels?.[parentChannelId]?.links || []).filter(id => id !== channelId)
	links.unshift(channelId)
	await updateChannel(groupId, parentChannelId, { links })
}

/**
 * 普通群新建频道的目标父：当前选中的分类 → 其父 → 根容器。
 * @returns {string | null} 目标父频道 id
 */
function inferCreateParent() {
	const state = store.context.currentState
	const rootChannelId = state?.groupSettings?.rootChannelId || null
	const currentChannelId = store.context.currentChannelId
	const current = currentChannelId ? state?.channels?.[currentChannelId] : null
	if (current?.type === 'category') return currentChannelId
	if (current) return findParentChannelId(state?.channels || {}, rootChannelId, currentChannelId)
	return rootChannelId
}

/**
 * DM 群快速新建频道：空名创建（显示"未命名"、置顶根级），随后若有默认 AI 源则自动命名/分类。
 * @returns {Promise<void>}
 */
export async function quickCreateChannel() {
	const groupId = store.context.currentGroupId
	if (!groupId) return
	try {
		const channelId = await createChannel(groupId, '')
		const rootChannelId = store.context.currentState?.groupSettings?.rootChannelId || null
		if (rootChannelId) await moveChannelToTop(groupId, channelId, rootChannelId)
		await refreshChannelSidebar()
		await selectChannel(channelId)
		await autoNameChannels(groupId).catch(() => null)
		await refreshChannelSidebar()
		showToastI18n('success', 'chat.hub.newChannel.success')
	}
	catch (error) {
		handleError('chat.hub.newChannel.failed')(error)
	}
}

/**
 * 弹出新建频道对话框。
 * @param {object} [options] 选项
 * @param {string} [options.parentChannelId] 预选父频道 id（建后链接到其下）
 * @returns {Promise<void>}
 */
export async function showCreateChannelModal(options = {}) {
	const groupId = store.context.currentGroupId
	if (!groupId) return
	await openDialogFromTemplate('channel_create_modal', {}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			/** @returns {void} */
			const close = () => dialog.close()
			dialog.querySelector('#new-channel-cancel')?.addEventListener('click', close)
			const parentSelect = dialog.querySelector('#new-channel-parent')
			const wrap = dialog.querySelector('#new-channel-parent-wrap')
			if (parentSelect instanceof HTMLSelectElement && wrap instanceof HTMLElement) {
				const categoryChannels = Object.values(store.context.currentState?.channels || {})
					.filter(ch => ch?.type === 'category')
				parentSelect.innerHTML = `<option value="" data-i18n="chat.hub.channel.noParent"></option>${renderTemplate('channel_category_options', {
					categories: categoryChannels.map(ch => ({ id: ch.id, name: ch.name || ch.id })),
					selectedCategory: options.parentChannelId || '',
				})}`
				if (categoryChannels.length) wrap.classList.remove('hidden')
			}
			dialog.querySelector('#new-channel-create')?.addEventListener('click', async () => {
				const name = dialog.querySelector('#new-channel-name')?.value?.trim()
				const type = dialog.querySelector('#new-channel-type')?.value || 'text'
				const parentChannelId = dialog.querySelector('#new-channel-parent')?.value || null
				if (!name) return
				try {
					const channelId = await createChannel(groupId, name, type, parentChannelId)
					const targetParentId = parentChannelId || inferCreateParent()
					if (targetParentId) await moveChannelToTop(groupId, channelId, targetParentId)
					close()
					await refreshChannelSidebar()
					await selectChannel(channelId)
					showToastI18n('success', 'chat.hub.newChannel.success')
				}
				catch (error) {
					handleError('chat.hub.newChannel.failed')(error)
				}
			})
		},
	})
}
