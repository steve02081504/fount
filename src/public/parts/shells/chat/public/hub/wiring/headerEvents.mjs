import { wireCallHeaderButton } from '../call.mjs'
import { hubStore } from '../core/state.mjs'
import { openFederationSettingsModal } from '../federation/federationModal.mjs'
import { wireForkActions } from '../federation/forkActions.mjs'
import { showGroupHeaderMenu } from '../groupContextMenu.mjs'
import { wirePinsBookmarksPanels } from '../pinsBookmarks.mjs'
import { wirePresenceInteractions } from '../presence.mjs'
import { openGroupSettingsModal } from '../privateGroup.mjs'
import { wireProfilePopupDismiss } from '../profilePopup.mjs'
import { scheduleHubMessageSearch } from '../search.mjs'

/** @returns {void} */
export function wireHeaderEvents() {
	wirePresenceInteractions()
	wireProfilePopupDismiss()
	wirePinsBookmarksPanels()
	wireCallHeaderButton()

	document.getElementById('hub-federation-settings-button').addEventListener('click', () => {
		void openFederationSettingsModal(() => hubStore.context.currentGroupId)
	})

	document.getElementById('hub-header-search').addEventListener('input', (event) => {
		const query = event.target.value.trim()
		const queryLower = query.toLowerCase()
		const chType = hubStore.context.currentState?.channels?.[hubStore.context.currentChannelId]?.type || 'text'
		if (hubStore.context.currentGroupId && hubStore.context.currentChannelId && chType === 'text') {
			if (query.length >= 2) scheduleHubMessageSearch(query)
			hubStore.messages.channelSearchQuery = queryLower || null
			void (async () => {
				const { refreshChannelViewDom } = await import('../messages/messages.mjs')
				const container = document.getElementById('hub-messages')
				await refreshChannelViewDom(container, false)
			})()
			return
		}
		document.querySelectorAll('#hub-messages .hub-message, #hub-messages .hub-char-entry, #hub-messages .hub-system-message').forEach((element) => {
			element.style.display = !queryLower || (element.textContent || '').toLowerCase().includes(queryLower) ? '' : 'none'
		})
	})
	document.getElementById('hub-header-search').addEventListener('focus', (event) => {
		event.target.style.borderColor = 'var(--hub-accent)'
	})
	document.getElementById('hub-header-search').addEventListener('blur', (event) => {
		event.target.style.borderColor = 'transparent'
	})

	document.getElementById('hub-header-settings-button').addEventListener('click', () => {
		if (hubStore.privateGroup.groupId) openGroupSettingsModal(hubStore.privateGroup.groupId)
		else window.open('/parts/shells:chat/profile', '_blank', 'noopener')
	})

	document.getElementById('hub-group-header').addEventListener('click', (event) => {
		if (!hubStore.context.currentGroupId) return
		void showGroupHeaderMenu(event.currentTarget instanceof HTMLElement ? event.currentTarget : document.getElementById('hub-group-header'))
	})

	document.getElementById('hub-user-bar').addEventListener('click', (event) => {
		if (event.target.closest('a[href]')) return
		void import('../hubStatus.mjs').then(({ showStatusMenu }) =>
			showStatusMenu(document.getElementById('hub-user-bar')),
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
