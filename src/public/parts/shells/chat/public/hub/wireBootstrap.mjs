/**
 * 【文件】public/hub/wireBootstrap.mjs
 * 【职责】Hub 轻量事件绑定：不依赖 messages/init 重模块图，保证建群等壳层交互尽快可用。
 * 【关联】groupModals、dialog、wireEvents（完整绑定延后加载）
 */
import { openDialogFromTemplate } from '../../../../scripts/dialog.mjs'
import { usingTemplates } from '../../../../scripts/template.mjs'
import { iconifyImg } from '../src/lib/emojiSvg.mjs'
import { joinGroupById, showCreateGroupModal } from '../src/ui/groupModals.mjs'

/** 弹出「创建 / 加入群组」选择对话框。 @returns {Promise<void>} */
async function showServerActionPicker() {
	usingTemplates('/parts/shells:chat/src/templates')
	await openDialogFromTemplate('hub/modals/server_action_picker', {
		createIconHtml: iconifyImg('mdi/sparkles', { width: 28, height: 28 }),
		joinIconHtml: iconifyImg('mdi/link-variant', { width: 28, height: 28 }),
	}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			dialog.querySelector('[data-action="create"]')?.addEventListener('click', () => {
				dialog.close()
				showCreateGroupModal()
			})
			dialog.querySelector('[data-action="join"]')?.addEventListener('click', () => {
				dialog.close()
				joinGroupById()
			})
			dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close())
		},
	})
}

/** 注册 Hub 壳层关键点击（建群、成员侧栏等），供 index 同步调用。 @returns {void} */
export function wireBootstrap() {
	document.getElementById('hub-add-server-button')?.addEventListener('click', showServerActionPicker)
	document.getElementById('hub-toggle-members-button')?.addEventListener('click', () => {
		document.getElementById('hub-member-bar')?.classList.toggle('hub-member-bar--open')
	})
}
