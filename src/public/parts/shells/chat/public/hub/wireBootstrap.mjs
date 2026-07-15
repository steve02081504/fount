/**
 * 【文件】public/hub/wireBootstrap.mjs
 * 【职责】Hub 轻量事件绑定：不依赖 messages/init 重模块图，保证建群、composer、hash 导航等壳层交互尽快可用。
 * 【关联】groupModals、dialog、wireEvents（其余绑定延后加载）
 */
import { onServerEvent } from '../../../../scripts/api/server_events.mjs'
import { openDialogFromTemplate } from '../../../../scripts/features/dialog.mjs'
import { usingTemplates } from '../../../../scripts/features/template.mjs'
import { reportTyping } from '../src/groupWsClient.mjs'
import { iconifyImg } from '../src/lib/emojiSvg.mjs'
import { bindComposerSubmit } from '../src/ui/composerKeys.mjs'
import { joinGroupById, showCreateGroupModal } from '../src/ui/groupModals.mjs'

import { hubStore } from './core/state.mjs'

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
	messageInput.addEventListener('input', () => {
		resizeMessageInput(messageInput)
		if (messageInput.value.trim())
			reportTyping(hubStore.context?.currentChannelId || 'default')
	})
	document.getElementById('hub-send-button')?.addEventListener('click', () => {
		void submitComposerLazy()
		messageInput.focus()
	})
}

/** 注册左侧群组/好友/提及模式切换（统一走 setMode）。 @returns {void} */
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

/** @type {ReturnType<typeof setTimeout> | null} */
let externalJoinRefreshTimer = null

/** 协议页 / 其他标签入群后刷新侧栏，并在 hash 指向该群时补导航。 @returns {Promise<void>} */
async function refreshHubAfterExternalJoin() {
	const { loadGroups } = await import('./serverBar.mjs')
	const { parseHash } = await import('./core/urlHash.mjs')
	const { navigateFromHash } = await import('./hashNav.mjs')
	await loadGroups()
	const { groupId } = parseHash()
	if (groupId) await navigateFromHash()
}

/**
 * 去抖触发外部入群后的 Hub 刷新。
 * @returns {void}
 */
function scheduleHubGroupsRefresh() {
	if (externalJoinRefreshTimer) clearTimeout(externalJoinRefreshTimer)
	externalJoinRefreshTimer = setTimeout(() => {
		externalJoinRefreshTimer = null
		void refreshHubAfterExternalJoin()
	}, 300)
}

/** 监听 focus / 跨标签入群 / 服务端 runpart join，覆盖 protocolhandler 与多标签场景。 @returns {void} */
function wireExternalJoinRefresh() {
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) scheduleHubGroupsRefresh()
	})
	window.addEventListener('focus', scheduleHubGroupsRefresh)
	onServerEvent('chat-group-joined', () => { scheduleHubGroupsRefresh() })
	void import('../src/hubBroadcast.mjs').then(({ wireHubGroupJoinedListener }) => {
		wireHubGroupJoinedListener(() => { scheduleHubGroupsRefresh() })
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
	wireExternalJoinRefresh()
	document.getElementById('hub-add-server-button')?.addEventListener('click', showServerActionPicker)
	document.getElementById('hub-toggle-members-button')?.addEventListener('click', () => {
		document.getElementById('hub-member-bar')?.classList.toggle('hub-member-bar--open')
	})
	// 草稿自动保存接线
	void import('./composerDraft.mjs').then(({ wireDraftAutoSave }) => {
		wireDraftAutoSave(() => ({
			groupId: hubStore.context.currentGroupId,
			channelId: hubStore.context.currentChannelId,
		}))
	})
	// 离线队列接线
	void import('./sendQueue.mjs').then(({ wireSendQueueDrain }) => { wireSendQueueDrain() })
}
