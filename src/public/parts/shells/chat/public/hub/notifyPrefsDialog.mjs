import { openDialogFromTemplate } from '../../../../scripts/features/dialog.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { loadNotificationPreferences, saveNotificationPreferences } from '../shared/notificationPreferences.mjs'

/**
 * @param {Record<string, object>} prefs 整档偏好
 * @param {string} groupId 群 ID
 * @returns {object} 该群通知偏好
 */
function groupPrefs(prefs, groupId) {
	return prefs[groupId] || {}
}

/**
 * 打开群通知设置对话框。
 * @param {string} groupId 群 ID
 * @returns {Promise<void>} 无
 */
export async function openGroupNotifyPrefsDialog(groupId) {
	const prefs = await loadNotificationPreferences()
	const current = groupPrefs(prefs, groupId)
	await openNotifyPrefsDialog({
		titleKey: 'chat.hub.notifyPrefs.title',
		current,
		/**
		 * @param {HTMLDialogElement} dialog 对话框元素
		 * @returns {Promise<void>} 无
		 */
		onSave: async dialog => {
			const next = { ...prefs, [groupId]: readNotifyPrefsFromDialog(dialog, current) }
			await saveNotificationPreferences(next)
			showToastI18n('success', 'chat.hub.notifyPrefs.saved')
			dialog.close()
			const { renderServerBar } = await import('./serverBar.mjs')
			await renderServerBar()
		},
	})
}

/**
 * 打开频道通知设置对话框（覆盖群级偏好）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>} 无
 */
export async function openChannelNotifyPrefsDialog(groupId, channelId) {
	const prefs = await loadNotificationPreferences()
	const group = groupPrefs(prefs, groupId)
	const current = group.channels?.[channelId] || {}
	await openNotifyPrefsDialog({
		titleKey: 'chat.hub.channelContext.notifyPrefs',
		current,
		/**
		 * @param {HTMLDialogElement} dialog 对话框元素
		 * @returns {Promise<void>} 无
		 */
		onSave: async dialog => {
			const channelPrefs = readNotifyPrefsFromDialog(dialog, current)
			const nextGroup = { ...group, channels: { ...group.channels, [channelId]: channelPrefs } }
			await saveNotificationPreferences({ ...prefs, [groupId]: nextGroup })
			showToastI18n('success', 'chat.hub.notifyPrefs.saved')
			dialog.close()
		},
	})
}

/**
 * @param {{ titleKey: string, current: object, onSave: (dialog: HTMLDialogElement) => Promise<void> }} options 对话框选项
 * @returns {Promise<void>} 无
 */
async function openNotifyPrefsDialog({ titleKey, current, onSave }) {
	await openDialogFromTemplate('hub/modals/notify_prefs', {
		mode: current.mode || 'mentions',
		suppressEveryone: !!current.suppressEveryone,
		suppressRoles: !!current.suppressRoles,
		mutedUntil: current.mutedUntil ?? '',
	}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框元素
		 * @returns {void} 无
		 */
		onReady: dialog => {
			const title = dialog.querySelector('h3')
			if (title) title.dataset.i18n = titleKey
			dialog.querySelector('.notify-prefs-save')?.addEventListener('click', () => {
				void onSave(dialog).catch(error => {
					showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
				})
			})
		},
	})
}

/**
 * @param {HTMLDialogElement} dialog 对话框
 * @param {object} current 当前偏好
 * @returns {object} 对话框读取的偏好
 */
function readNotifyPrefsFromDialog(dialog, current) {
	const mode = dialog.querySelector('[name="notifyMode"]:checked')?.value || 'mentions'
	const suppressEveryone = !!dialog.querySelector('[name="suppressEveryone"]')?.checked
	const suppressRoles = !!dialog.querySelector('[name="suppressRoles"]')?.checked
	const muteSelect = /** @type {HTMLSelectElement | null} */ dialog.querySelector('[name="muteDuration"]')
	/** @type {object} */
	const next = { ...current, mode, suppressEveryone, suppressRoles }
	if (muteSelect?.value === 'forever') next.mutedUntil = true
	else if (muteSelect?.value === '1h') next.mutedUntil = Date.now() + 3600_000
	else if (muteSelect?.value === '8h') next.mutedUntil = Date.now() + 8 * 3600_000
	else delete next.mutedUntil
	return next
}
