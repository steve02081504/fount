/**
 * 【文件】public/hub/wireBootstrap.mjs
 * 【职责】Hub 轻量事件绑定：不依赖 messages/init 重模块图，保证建群、composer、hash 导航等壳层交互尽快可用。
 * 【关联】groupModals、dialog、wireEvents（其余绑定延后加载）
 */
import { openDialogFromTemplate } from '../../../../scripts/dialog.mjs'
import { usingTemplates } from '../../../../scripts/template.mjs'
import { iconifyImg } from '../src/lib/emojiSvg.mjs'
import { bindComposerSubmit } from '../src/ui/composerKeys.mjs'
import { joinGroupById, showCreateGroupModal } from '../src/ui/groupModals.mjs'

/** @returns {Promise<void>} 惰性加载 messages 图并提交 composer */
function submitComposerLazy() {
	return import('./messages/messages.mjs').then(({ submitComposer }) => submitComposer())
}

/**
 * 按内容高度调整主输入框（上限见 CSS `max-h-40`）。
 * @param {HTMLTextAreaElement} textarea 消息输入框
 * @returns {void}
 */
function resizeMessageInput(textarea) {
	textarea.style.height = 'auto'
	textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
}

/** 注册 composer 发送与快捷键（同步，供 E2E 与首屏导航使用）。 @returns {void} */
function wireComposerControls() {
	const messageInput = /** @type {HTMLTextAreaElement | null} */ document.getElementById('hub-message-input')
	if (!messageInput) return
	bindComposerSubmit(messageInput, () => { void submitComposerLazy() })
	messageInput.addEventListener('input', () => { resizeMessageInput(messageInput) })
	document.getElementById('hub-send-button')?.addEventListener('click', () => {
		void submitComposerLazy()
		messageInput.focus()
	})
}

/** 注册左侧群组/好友模式切换（惰性加载 setMode）。 @returns {void} */
function wireModeTabsEarly() {
	document.querySelectorAll('.hub-server-item[data-mode]').forEach(el => {
		el.addEventListener('click', () => {
			const mode = el.dataset.mode
			if (mode) void import('./mode.mjs').then(({ setMode }) => setMode(mode))
		})
	})
}

/** 注册 hash 导航（统一走 hashNav.navigateFromHash）。 @returns {void} */
function wireHashNavigation() {
	window.addEventListener('hashchange', () => {
		void import('./hashNav.mjs').then(({ navigateFromHash }) => navigateFromHash())
	})
}

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
	wireComposerControls()
	wireModeTabsEarly()
	wireHashNavigation()
	document.getElementById('hub-add-server-button')?.addEventListener('click', showServerActionPicker)
	document.getElementById('hub-toggle-members-button')?.addEventListener('click', () => {
		document.getElementById('hub-member-bar')?.classList.toggle('hub-member-bar--open')
	})
}
