/**
 * 【文件】public/hub/misc.mjs
 * 【职责】Hub 杂项初始化：浏览器通知权限、成就钩子，以及将 char/world part 拖入群组的导入逻辑。
 * 【原理】`setupMisc` 在 `init` 末尾注册拖放区与通知按钮；`setupPartDragDrop` 高亮可放置区域；拖入 part 可能触发群状态变更后刷新消息。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/toast、../src/achievements、../src/api/groupApi、core/state。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { initializeAchievements } from '../src/achievements.mjs'
import { groupRequest } from '../src/api/groupApi.mjs'

import { hubStore } from './core/state.mjs'

/**
 * 全局拖放 `x-fount-part` 到 Hub，向当前会话添加部件。
 * @returns {void}
 */
export function setupPartDragDrop() {
	document.body.addEventListener('dragover', event => {
		event.preventDefault()
	})
	document.body.addEventListener('drop', async event => {
		event.preventDefault()
		const partData = event?.dataTransfer?.getData?.('x-fount-part')
		if (!partData) return
		const groupId = hubStore.privateGroup.groupId || hubStore.currentGroupId
		if (!groupId) {
			showToastI18n('warning', 'chat.hub.noActiveChat')
			return
		}
		const [partType, partName] = partData.split('/')
		if (!partType || !partName)
			return showToastI18n('error', 'chat.dragAndDrop.invalidPartData')

		const channelId = hubStore.currentChannelId || 'default'
		try {
			switch (partType) {
				case 'chars':
					await groupRequest(groupId, 'char', 'POST', { charname: partName })
					showToastI18n('success', 'chat.dragAndDrop.charAdded', { partName })
					break
				case 'personas':
					await groupRequest(groupId, 'persona', 'PUT', { personaname: partName })
					showToastI18n('success', 'chat.dragAndDrop.personaSet', { partName })
					break
				case 'worlds':
					await groupRequest(groupId, 'world', 'PUT', { worldname: partName, channelId })
					showToastI18n('success', 'chat.dragAndDrop.worldSet', { partName })
					break
				case 'plugins':
					await groupRequest(groupId, 'plugin', 'POST', { pluginname: partName })
					showToastI18n('success', 'chat.dragAndDrop.pluginAdded', { partName })
					break
				default:
					showToastI18n('warning', 'chat.dragAndDrop.unsupportedPartType', { partType })
			}
		}
		catch (error) {
			showToastI18n('error', 'chat.dragAndDrop.errorAddingPart', { partName, error: error.message })
		}
	})
}

/**
 * Hub 杂项初始化：成就、通知、拖放。
 * @returns {void}
 */
export function setupMisc() {
	void initializeAchievements()
	setupPartDragDrop()
}
