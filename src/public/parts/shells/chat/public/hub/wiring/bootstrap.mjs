/**
 * 【文件】public/hub/wiring/bootstrap.mjs
 * 【职责】Hub 轻量事件绑定：不依赖 messages/init 重模块图，保证建群、composer、hash 导航等壳层交互尽快可用。
 * 【关联】groupModals、dialog、wireEvents（其余绑定延后加载）
 */
import { onServerEvent } from '../../../../../scripts/api/server_events.mjs'
import { openDialogFromTemplate } from '../../../../../scripts/features/dialog.mjs'
import { usingTemplates } from '../../../../../scripts/features/template.mjs'
import { iconifyImg } from '../../src/lib/emojiSvg.mjs'
import { bindComposerSubmit } from '../../src/ui/composerKeys.mjs'
import { joinGroupById, showCreateGroupModal } from '../../src/ui/groupModals.mjs'
import { store } from '../core/state.mjs'
import { reportTyping } from '../stream/outbound.mjs'

/** @returns {Promise<void>} 惰性加载 messages 图并提交 composer */
function submitComposerLazy() {
	return import('../messages/messages.mjs').then(({ submitComposer }) => submitComposer())
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
	const messageInput = /** @type {HTMLTextAreaElement | null} */ document.getElementById('message-input')
	if (!messageInput) return
	bindComposerSubmit(messageInput, () => { void submitComposerLazy() })
	messageInput.addEventListener('input', () => {
		resizeMessageInput(messageInput)
		if (messageInput.value.trim())
			reportTyping(store.context?.currentChannelId || 'default')
	})
	document.getElementById('send-button')?.addEventListener('click', () => {
		void submitComposerLazy()
		messageInput.focus()
	})
	void import('../composerReply.mjs').then(({ wireReplyBanner }) => wireReplyBanner())
}

/** 注册左侧群组/好友/提及模式切换（统一走 setMode）。 @returns {void} */
function wireModeTabsEarly() {
	document.querySelectorAll('.server-item[data-mode]').forEach(el => {
		el.addEventListener('click', () => {
			const mode = el.dataset.mode
			if (mode) void import('../mode.mjs').then(({ setMode }) => setMode(mode))
		})
	})
}

/** 注册 hash 导航（统一走 hashNav.navigateFromHash）。 @returns {void} */
function wireHashNavigation() {
	window.addEventListener('hashchange', () => {
		void import('../hashNav.mjs').then(({ navigateFromHash }) => navigateFromHash())
	})
}

/** @type {ReturnType<typeof setTimeout> | null} */
let externalJoinRefreshTimer = null

/** 协议页 / 其他标签入群后刷新侧栏，并在 hash 指向该群时补导航。 @returns {Promise<void>} */
async function refreshHubAfterExternalJoin() {
	const { loadGroups } = await import('../serverBar.mjs')
	const { parseHash } = await import('../core/urlHash.mjs')
	const { navigateFromHash } = await import('../hashNav.mjs')
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
	void import('../../src/hubBroadcast.mjs').then(({ wireHubGroupJoinedListener }) => {
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
				void showCreateGroupModal(dialog)
			})
			dialog.querySelector('[data-action="join"]')?.addEventListener('click', () => {
				void joinGroupById(dialog)
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
	document.getElementById('add-server-button')?.addEventListener('click', showServerActionPicker)
	document.getElementById('toggle-members-button')?.addEventListener('click', () => {
		document.getElementById('member-bar')?.classList.toggle('member-bar--open')
	})
	document.getElementById('member-backdrop')?.addEventListener('click', () => {
		document.getElementById('member-bar')?.classList.remove('member-bar--open')
	})
	document.getElementById('top-back-button')?.addEventListener('click', () => {
		void import('../hubPane.mjs').then(({ showHubNavPane }) => showHubNavPane())
	})
	wireMobileHeaderOverflow()
	wireComposerMoreMenu()
	// 草稿自动保存接线
	void import('../composerDraft.mjs').then(({ wireDraftAutoSave }) => {
		wireDraftAutoSave(() => ({
			groupId: store.context.currentGroupId,
			channelId: store.context.currentChannelId,
		}))
	})
	// 离线队列接线
	void import('../sendQueue.mjs').then(({ wireSendQueueDrain }) => { wireSendQueueDrain() })
}

/** 移动端顶栏 ⋯ 菜单与全宽搜索条。 @returns {void} */
function wireMobileHeaderOverflow() {
	/**
	 * @param {string} overflowId overflow 菜单按钮 id
	 * @param {string} desktopId 对应桌面按钮 id
	 * @returns {void}
	 */
	const clickThrough = (overflowId, desktopId) => {
		document.getElementById(overflowId)?.addEventListener('click', () => {
			document.getElementById(desktopId)?.click()
			document.activeElement instanceof HTMLElement && document.activeElement.blur()
		})
	}
	clickThrough('overflow-pins', 'pins-button')
	clickThrough('overflow-bookmarks', 'bookmarks-button')
	clickThrough('overflow-files', 'header-files-button')

	const mobileBar = document.getElementById('mobile-search-bar')
	const mobileInput = /** @type {HTMLInputElement | null} */ document.getElementById('mobile-search-input')
	const desktopInput = /** @type {HTMLInputElement | null} */ document.getElementById('header-search')

	document.getElementById('overflow-search')?.addEventListener('click', () => {
		const moreBtn = document.getElementById('header-more-button')
		if (moreBtn instanceof HTMLElement) moreBtn.blur()
		mobileBar?.classList.add('mobile-search-bar--open')
		if (mobileInput && desktopInput) mobileInput.value = desktopInput.value
		const desktopScope = document.getElementById('search-scope')?.dataset?.value
		if (desktopScope)
			void import('../search.mjs').then(({ setHubSearchScope }) => setHubSearchScope(desktopScope))
		mobileInput?.focus()
	})
	document.getElementById('mobile-search-close')?.addEventListener('click', () => {
		mobileBar?.classList.remove('mobile-search-bar--open')
	})
	mobileInput?.addEventListener('input', () => {
		if (!desktopInput) return
		desktopInput.value = mobileInput.value
		desktopInput.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

/** 移动端 composer「+」菜单：转发到桌面工具按钮。 @returns {void} */
function wireComposerMoreMenu() {
	const map = [
		['composer-more-voice', 'voice-button'],
		['composer-more-photo', 'photo-button'],
		['composer-more-upload', 'upload-button'],
		['composer-more-vote', 'vote-button'],
		['composer-more-sticker', 'sticker-button'],
	]
	for (const [moreId, desktopId] of map)
		document.getElementById(moreId)?.addEventListener('click', () => {
			document.getElementById(desktopId)?.click()
			document.activeElement instanceof HTMLElement && document.activeElement.blur()
		})
}
