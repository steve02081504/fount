import { switchView } from '../navigation.mjs'
import { updateNotificationBadge } from '../views/notifications.mjs'

import { effectiveActingEntityHash } from './apiClient.mjs'
import { renderAvatarHtml } from './display.mjs'

/**
 * 填充身份切换下拉并绑定 change。
 * @param {object} appContext 应用上下文
 * @param {object} viewer `/viewer` 响应
 * @returns {void}
 */
export function mountActingEntitySwitcher(appContext, viewer) {
	const select = document.getElementById('actingEntitySelect')
	if (!(select instanceof HTMLSelectElement)) return

	appContext.state.viewerEntityHash = viewer.viewerEntityHash ?? null
	appContext.state.availableAgents = viewer.agents || []

	select.replaceChildren()
	if (viewer.viewerEntityHash) {
		const operatorOption = document.createElement('option')
		operatorOption.value = ''
		operatorOption.textContent = viewer.operator?.displayName
			? appContext.geti18n('social.actor.operator') + ` (${viewer.operator.displayName})`
			: appContext.geti18n('social.actor.operator')
		select.appendChild(operatorOption)
	}
	for (const agent of appContext.state.availableAgents) {
		const option = document.createElement('option')
		option.value = agent.entityHash
		option.textContent = appContext.geti18n('social.actor.agent', {
			name: agent.displayName || agent.charPartName || agent.entityHash.slice(0, 8),
		})
		select.appendChild(option)
	}

	if (!viewer.viewerEntityHash && !appContext.state.availableAgents.length) {
		select.classList.add('hidden')
		return
	}
	select.classList.remove('hidden')

	const current = appContext.state.actingEntityHash || ''
	select.value = current

	/**
	 *
	 */
	select.onchange = () => {
		void onActingEntityChanged(appContext, select.value || null)
	}
}

/**
 * 更新 composer 区当前 acting 头像。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function refreshComposerAvatar(appContext) {
	const slot = document.getElementById('viewerComposerAvatar')
	const hash = effectiveActingEntityHash()
	if (!slot || !hash) return
	slot.innerHTML = renderAvatarHtml(hash, { name: appContext.state.actingDisplayName })
}

/**
 * @param {object} appContext 应用上下文
 * @param {string | null} entityHash agent hash；null = operator
 * @returns {Promise<void>}
 */
async function onActingEntityChanged(appContext, entityHash) {
	const normalized = entityHash?.trim().toLowerCase() || null
	appContext.state.actingEntityHash = normalized
	if (!normalized)
		appContext.state.actingDisplayName = appContext.state.viewerEntityHash
			? appContext.geti18n('social.actor.operator')
			: null
	else {
		const agent = appContext.state.availableAgents.find(row => row.entityHash === normalized)
		appContext.state.actingDisplayName = agent?.displayName || agent?.charPartName || normalized
	}

	refreshComposerAvatar(appContext)
	appContext.state.feedCursor = null
	appContext.state.notificationsCursor = null
	appContext.state.notificationsSeenAt = null

	const activeView = document.querySelector('.nav-btn.active')?.dataset?.view || 'feed'
	await switchView(appContext, activeView)
	await updateNotificationBadge(appContext)
}

/**
 * @param {object} appContext 应用上下文
 * @param {object} viewer `/viewer` 响应
 * @returns {void}
 */
export function bootstrapActingEntity(appContext, viewer) {
	mountActingEntitySwitcher(appContext, viewer)
	refreshComposerAvatar(appContext)
}
