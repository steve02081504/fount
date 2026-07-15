/**
 * 【文件】public/hub/call.mjs
 * 【职责】文本频道群组通话 dock：加入/离开、静音/视频/屏幕共享、人数徽标。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { buildChatCallWsUrl } from '../shared/avRelayClient.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'

import { joinCodecsAvRoom, leaveCodecsAvRoom } from './codecsAv.mjs'
import { hubStore } from './core/state.mjs'
import { fetchUserProfile } from './presence.mjs'

/** @type {import('./codecsAv.mjs').CodecsAvSession | null} */
let callSession = null
/** @type {string | null} */
let callChannelKey = null

/**
 * @returns {boolean} 是否在通话中
 */
export function isInChannelCall() {
	return !!callSession
}

/**
 * @returns {Promise<void>}
 */
export async function leaveChannelCall() {
	if (!callSession) return
	callSession = null
	callChannelKey = null
	await leaveCodecsAvRoom()
	setCallDockVisible(false)
	setCallButtonActive(false)
}

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<void>}
 */
export async function joinChannelCall(groupId, channelId) {
	const key = `${groupId}:${channelId}`
	if (callSession && callChannelKey === key) return
	await leaveChannelCall()

	const dock = ensureCallDock()
	const avGrid = dock.querySelector('#hub-call-av-grid')
	const videoLocal = dock.querySelector('#hub-call-local-video')
	const peerLabel = dock.querySelector('#hub-call-peer-label')
	setCallDockVisible(true)

	try {
		callSession = await joinCodecsAvRoom({
			groupId,
			channelId,
			presetKey: 'med',
			avGrid,
			videoLocal,
			wsUrl: buildChatCallWsUrl(groupId, channelId),
			/**
			 * @param {number} count peer 数
			 * @returns {void}
			 */
			onPeerCount: count => {
				if (peerLabel) peerLabel.textContent = String(count)
				updateCallBadge(count)
			},
			/**
			 * @param {{ entityHash: string, senderId: string }[]} peers roster
			 * @returns {void}
			 */
			onRoster: peers => updateCallBadge(peers.length),
			/**
			 * @param {string} _senderId sender hex
			 * @param {string | null} entityHash 实体
			 * @returns {string} 标签
			 */
			labelForPeer: (_senderId, entityHash) => {
				if (!entityHash) return '…'
				return resolveDisplayName({
					entityHash,
					fallbackLabel: entityHash.slice(0, 8),
				})
			},
		})
		callChannelKey = key
		setCallButtonActive(true)
		wireCallDockControls(dock)
		void hydrateCallTiles(avGrid)
	}
	catch (error) {
		console.error('call join failed:', error)
		setCallDockVisible(false)
		const errorText = error?.message || String(error)
		if (errorText.includes('WebCodecs'))
			showToastI18n('error', 'chat.hub.streamAvNoCodecs')
		else
			showToastI18n('error', 'chat.hub.callJoinFailed', { error: errorText })
	}
}

/**
 * @param {HTMLElement} grid tile 容器
 * @returns {Promise<void>}
 */
async function hydrateCallTiles(grid) {
	for (const tile of grid.querySelectorAll('[data-entity-hash]')) {
		const entityHash = tile.dataset.entityHash
		if (!entityHash) continue
		const profile = await fetchUserProfile(entityHash).catch(() => null)
		const label = tile.querySelector('.hub-streaming-av-label, [data-av-label]')
		if (label && profile)
			label.textContent = resolveDisplayName({
				entityHash,
				profileName: profile.name,
				fallbackLabel: entityHash.slice(0, 8),
			})
	}
}

/**
 * @returns {HTMLElement} dock
 */
function ensureCallDock() {
	let dock = document.getElementById('hub-call-dock')
	if (dock) return dock
	dock = document.createElement('div')
	dock.id = 'hub-call-dock'
	dock.className = 'hub-call-dock'
	dock.hidden = true
	dock.innerHTML = `
		<div class="hub-call-dock-bar">
			<span class="hub-call-dock-title" data-i18n="chat.hub.callInProgress"></span>
			<span id="hub-call-peer-label" class="hub-call-peer-label">0</span>
			<div class="hub-call-dock-actions">
				<button type="button" class="hub-icon-button" data-call-role="mute" data-i18n="chat.hub.streamAvMute"></button>
				<button type="button" class="hub-icon-button" data-call-role="video" data-i18n="chat.hub.streamAvVideo"></button>
				<button type="button" class="hub-icon-button" data-call-role="screen" data-i18n="chat.hub.callScreenShare"></button>
				<button type="button" class="hub-icon-button" data-call-role="hangup" data-i18n="chat.hub.callHangup"></button>
			</div>
		</div>
		<div class="hub-streaming-av-grid hub-call-av-grid" id="hub-call-av-grid">
			<div class="streaming-av-tile relative rounded-lg overflow-hidden bg-black min-h-0" data-peer-id="local">
				<video id="hub-call-local-video" autoplay playsinline muted class="w-full h-full object-cover"></video>
				<div class="absolute bottom-1 left-1 text-xs text-white bg-black/50 rounded px-1" data-i18n="chat.hub.streamAvYou"></div>
			</div>
		</div>
	`
	const main = document.querySelector('.hub-main') || document.body
	const header = main.querySelector('.hub-main-header')
	if (header) header.after(dock)
	else main.prepend(dock)
	return dock
}

/**
 * @param {HTMLElement} dock dock
 * @returns {void}
 */
function wireCallDockControls(dock) {
	if (dock.dataset.wired) return
	dock.dataset.wired = '1'
	const byRole = Object.fromEntries(
		[...dock.querySelectorAll('[data-call-role]')].map(callButton => [
			callButton.getAttribute('data-call-role'),
			callButton,
		]),
	)
	byRole.mute?.addEventListener('click', () => {
		const muted = callSession?.toggleMute()
		if (byRole.mute) byRole.mute.dataset.i18n = muted ? 'chat.hub.streamAvUnmute' : 'chat.hub.streamAvMute'
	})
	byRole.video?.addEventListener('click', () => {
		const off = callSession?.toggleVideo()
		if (byRole.video) byRole.video.dataset.i18n = off ? 'chat.hub.streamAvVideoOn' : 'chat.hub.streamAvVideo'
	})
	byRole.screen?.addEventListener('click', () => {
		void (async () => {
			try {
				const on = await callSession?.toggleScreen?.()
				if (byRole.screen)
					byRole.screen.dataset.i18n = on ? 'chat.hub.callScreenStop' : 'chat.hub.callScreenShare'
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.callScreenFailed', { error: error?.message || String(error) })
			}
		})()
	})
	byRole.hangup?.addEventListener('click', () => { void leaveChannelCall() })
}

/**
 * @param {boolean} visible 是否显示
 * @returns {void}
 */
function setCallDockVisible(visible) {
	const dock = document.getElementById('hub-call-dock')
	if (dock) dock.hidden = !visible
}

/**
 * @param {boolean} active 按钮高亮
 * @returns {void}
 */
function setCallButtonActive(active) {
	document.getElementById('hub-header-call-button')?.classList.toggle('is-active', active)
}

/**
 * @param {number} count 人数
 * @returns {void}
 */
function updateCallBadge(count) {
	const badge = document.getElementById('hub-call-count')
	if (!badge) return
	if (count > 0) {
		badge.hidden = false
		badge.textContent = String(count)
	}
	else badge.hidden = true
}

/**
 * 刷新频道头通话按钮徽标。
 * @returns {Promise<void>}
 */
export async function refreshCallStatusBadge() {
	const groupId = hubStore.context.currentGroupId
	const channelId = hubStore.context.currentChannelId
	if (!groupId || !channelId) {
		updateCallBadge(0)
		return
	}
	try {
		const res = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/call-status`,
			{ credentials: 'include' },
		)
		if (!res.ok) return
		const data = await res.json()
		updateCallBadge(data.active ? data.peerCount || 0 : 0)
	}
	catch { /* ignore */ }
}

/**
 * 绑定顶栏通话按钮。
 * @returns {void}
 */
export function wireCallHeaderButton() {
	const callButton = document.getElementById('hub-header-call-button')
	if (!callButton || callButton.dataset.wired) return
	callButton.dataset.wired = '1'
	callButton.addEventListener('click', () => {
		const groupId = hubStore.context.currentGroupId
		const channelId = hubStore.context.currentChannelId
		if (!groupId || !channelId) return
		if (callSession && callChannelKey === `${groupId}:${channelId}`) {
			void leaveChannelCall()
			return
		}
		void joinChannelCall(groupId, channelId)
	})
}
