import { wireCallHeaderButton } from '../call.mjs'
import { store } from '../core/state.mjs'
import { wireForkActions } from '../federation/forkActions.mjs'
import { showGroupHeaderMenu } from '../groupContextMenu.mjs'
import { wirePinsBookmarksPanels } from '../pinsBookmarks.mjs'
import { wirePresenceInteractions } from '../presence.mjs'
import { wireProfilePopupDismiss } from '../profilePopup.mjs'
import { scheduleHubMessageSearch } from '../search.mjs'

/** @returns {void} */
export function wireHeaderEvents() {
	wirePresenceInteractions()
	wireProfilePopupDismiss()
	wirePinsBookmarksPanels()
	wireCallHeaderButton()

	document.getElementById('prefs-button')?.addEventListener('click', () => {
		void import('../hubPrefs.mjs').then(({ openHubPrefsModal }) => openHubPrefsModal({
			/** @returns {string | null | undefined} 当前 Hub 所选群组 id。 */
			getGroupId: () => store.context.currentGroupId,
		}))
	})

	document.getElementById('header-search').addEventListener('input', (event) => {
		const query = event.target.value.trim()
		const queryLower = query.toLowerCase()
		const chType = store.context.currentState?.channels?.[store.context.currentChannelId]?.type || 'text'
		if (store.context.currentGroupId && store.context.currentChannelId && chType === 'text') {
			if (query.length >= 2) scheduleHubMessageSearch(query)
			store.messages.channelSearchQuery = queryLower || null
			void (async () => {
				const { refreshChannelViewDom } = await import('../messages/messages.mjs')
				const container = document.getElementById('messages')
				await refreshChannelViewDom(container, false)
			})()
			return
		}
		document.querySelectorAll('#messages .message, #messages .char-entry, #messages .system-message').forEach((element) => {
			element.style.display = !queryLower || (element.textContent || '').toLowerCase().includes(queryLower) ? '' : 'none'
		})
	})
	document.getElementById('header-search').addEventListener('focus', (event) => {
		event.target.style.borderColor = 'var(--accent)'
	})
	document.getElementById('header-search').addEventListener('blur', (event) => {
		event.target.style.borderColor = 'transparent'
	})

	document.getElementById('group-header').addEventListener('click', (event) => {
		if (!store.context.currentGroupId) return
		void showGroupHeaderMenu(event.currentTarget instanceof HTMLElement ? event.currentTarget : document.getElementById('group-header'))
	})

	document.getElementById('user-bar').addEventListener('click', (event) => {
		if (event.target.closest('a[href]')) return
		void import('../hubStatus.mjs').then(({ showStatusMenu }) =>
			showStatusMenu(document.getElementById('user-bar')),
		)
	})

	wireForkActions()
}

/** @returns {void} */
export function wireShiftKeyHint() {
	let shiftActive = false
	document.addEventListener('keydown', event => {
		if (event.key === 'Shift' && !shiftActive) {
			shiftActive = true
			document.body.classList.add('shift-active')
		}
	})
	document.addEventListener('keyup', event => {
		if (event.key === 'Shift') {
			shiftActive = false
			document.body.classList.remove('shift-active')
		}
	})
	window.addEventListener('blur', () => {
		shiftActive = false
		document.body.classList.remove('shift-active')
	})
}
