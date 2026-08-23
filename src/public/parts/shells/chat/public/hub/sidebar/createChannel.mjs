/**
 * 【文件】public/hub/sidebar/createChannel.mjs
 * 【职责】新建频道对话框与入树刷新（可选在父频道下创建并链接）。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { createChannel, updateChannel } from '../../src/endpoints/groupChannel.mjs'
import { getGroupState } from '../../src/endpoints/groupCore.mjs'
import { openDialogFromTemplate } from '../../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { store, setState } from '../core/state.mjs'

import { selectChannel } from './selectChannel.mjs'

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
		onReady: async dialog => {
			/** @returns {void} */
			const close = () => dialog.close()
			dialog.querySelector('#new-channel-cancel')?.addEventListener('click', close)
			const parentSelect = dialog.querySelector('#new-channel-parent')
			if (parentSelect) {
				const categoryChannels = Object.values(store.context.currentState?.channels || {})
					.filter(ch => ch?.type === 'category')
				if (categoryChannels.length) {
					parentSelect.classList.remove('hidden')
					const wrap = dialog.querySelector('#new-channel-parent-wrap')
					wrap?.classList.remove('hidden')
					const selected = options.parentChannelId || ''
					parentSelect.innerHTML = [
						'<option value="" data-i18n="chat.hub.channel.noParent"></option>',
						...categoryChannels.map(ch =>
							`<option value="${ch.id}" ${ch.id === selected ? 'selected' : ''}>${ch.name || ch.id}</option>`),
					].join('')
				}
			}
			dialog.querySelector('#new-channel-create')?.addEventListener('click', async () => {
				const name = dialog.querySelector('#new-channel-name')?.value?.trim()
				const type = dialog.querySelector('#new-channel-type')?.value || 'text'
				const parentChannelId = dialog.querySelector('#new-channel-parent')?.value || null
				if (!name) return
				try {
					const channelId = await createChannel(groupId, name, type, {})
					const resolvedParent = parentChannelId || options.parentChannelId || null
					if (resolvedParent) {
						const parent = store.context.currentState?.channels?.[resolvedParent]
						const links = [...parent?.links || [], channelId]
						await updateChannel(groupId, resolvedParent, { links })
						// 子频道默认同步父频道权限块
						await updateChannel(groupId, channelId, { permBlockId: resolvedParent })
					}
					close()
					setState('context.currentState', await getGroupState(groupId))
					const { renderHubChannelSidebar } = await import('./index.mjs')
					await renderHubChannelSidebar(store.context.currentState)
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
