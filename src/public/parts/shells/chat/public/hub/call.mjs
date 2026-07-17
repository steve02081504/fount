/**
 * 【文件】public/hub/call.mjs
 * 【职责】文本频道群组通话 dock：加入/离开、静音/视频/屏幕共享、人数徽标。
 */
import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { geti18n, setElementI18n } from '../../../../scripts/i18n/index.mjs'
import { buildChatCallWsUrl } from '../shared/avRelayClient.mjs'
import { customProfileAvatar } from '../shared/hashAvatar.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { iconifyImg, iconifyUrl } from '../src/lib/emojiSvg.mjs'

import { joinCodecsAvRoom, leaveCodecsAvRoom } from './codecsAv.mjs'
import { hubStore } from './core/state.mjs'
import { fetchUserProfile } from './presence.mjs'

/** @type {import('./codecsAv.mjs').CodecsAvSession | null} */
let callSession = null
/** @type {string | null} */
let callChannelKey = null
/** @type {string | null} */
let callGroupId = null
/** @type {string | null} */
let callChannelId = null
/** @type {Promise<void> | null} */
let joinInFlight = null
/** 递增以作废进行中的 join（挂断 / 重入） */
let joinGeneration = 0

const CALL_ICONS = {
	mute: 'mdi/microphone',
	unmute: 'mdi/microphone-off',
	video: 'mdi/video',
	videoOff: 'mdi/video-off',
	screen: 'mdi/monitor-share',
	screenOff: 'mdi/monitor-off',
	hangup: 'mdi/phone-hangup',
}

/**
 * @returns {boolean} 是否在通话中
 */
export function isInChannelCall() {
	return !!callSession
}

/**
 * @returns {{ groupId: string, channelId: string } | null} 当前通话频道
 */
export function getActiveCallChannel() {
	if (!callSession || !callGroupId || !callChannelId) return null
	return { groupId: callGroupId, channelId: callChannelId }
}

/**
 * 清掉门面引用并关闭底层媒体（不递增 generation）。
 * @returns {Promise<void>}
 */
async function clearCallMedia() {
	callSession = null
	callChannelKey = null
	callGroupId = null
	callChannelId = null
	await leaveCodecsAvRoom()
}

/**
 * @returns {Promise<void>}
 */
export async function leaveChannelCall() {
	joinGeneration++
	await clearCallMedia()
	resetCallUi()
}

/**
 * @returns {void}
 */
function resetCallUi() {
	setCallDockVisible(false)
	setCallButtonActive(false)
	updateCallBadge(0)
	setPeerCountLabel(document.getElementById('hub-call-peer-label'), 0)
	void refreshCallStatusBadge()
}

/**
 * @param {Element | null} peerLabel 人数标签
 * @param {number} count 去重人数
 * @returns {void}
 */
function setPeerCountLabel(peerLabel, count) {
	if (!(peerLabel instanceof HTMLElement)) return
	setElementI18n(peerLabel, 'chat.hub.callParticipants', { n: count })
}

/**
 * 底层会话被关掉时复位门面（勿再调 leaveCodecsAvRoom，避免递归）。
 * @returns {void}
 */
function onCallSessionClosed() {
	callSession = null
	callChannelKey = null
	callGroupId = null
	callChannelId = null
	resetCallUi()
}

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {{ media?: 'av' | 'audio' | 'video' }} [options] 媒体模式
 * @returns {Promise<void>}
 */
export async function joinChannelCall(groupId, channelId, options = {}) {
	const key = `${groupId}:${channelId}`
	if (callSession && callChannelKey === key) return
	if (joinInFlight) await joinInFlight.catch(() => { })
	if (callSession && callChannelKey === key) return

	const run = doJoinChannelCall(groupId, channelId, options)
	joinInFlight = run
	try {
		await run
	}
	finally {
		if (joinInFlight === run) joinInFlight = null
	}
}

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {{ media?: 'av' | 'audio' | 'video' }} [options] 媒体模式
 * @returns {Promise<void>}
 */
async function doJoinChannelCall(groupId, channelId, options = {}) {
	const gen = ++joinGeneration
	await clearCallMedia()

	const dock = await ensureCallDock()
	if (gen !== joinGeneration) return
	const avGrid = dock.querySelector('#hub-call-av-grid')
	const videoLocal = dock.querySelector('#hub-call-local-video')
	const voiceLocal = dock.querySelector('#hub-call-local-voice')
	const peerLabel = dock.querySelector('#hub-call-peer-label')
	const channelName = hubStore.context.currentState?.channels?.[channelId]?.name || channelId
	updateDockChannelLabel(dock, channelName)
	setCallDockVisible(true)

	try {
		const session = await joinCodecsAvRoom({
			groupId,
			channelId,
			presetKey: 'med',
			media: options.media || 'av',
			avGrid,
			videoLocal,
			voiceLocalHost: voiceLocal,
			wsUrl: buildChatCallWsUrl(groupId, channelId),
			onClosed: onCallSessionClosed,
			/**
			 * @param {{ entityHash: string, senderId: string }[]} peers roster
			 * @returns {void}
			 */
			onRoster: peers => {
				const unique = new Set(
					peers.map(p => String(p.entityHash || '').toLowerCase()).filter(Boolean),
				)
				const count = unique.size
				setPeerCountLabel(peerLabel, count)
				updateCallBadge(count)
			},
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
			/**
			 * @param {HTMLElement} tile tile
			 * @param {string} _senderId sender
			 * @param {string | null} entityHash 实体
			 * @returns {void}
			 */
			onPeerTile: (tile, _senderId, entityHash) => {
				void hydratePeerTile(tile, entityHash)
			},
		})
		if (gen !== joinGeneration) {
			await session.close()
			return
		}
		callSession = session
		callChannelKey = `${groupId}:${channelId}`
		callGroupId = groupId
		callChannelId = channelId
		refreshCallButtonActiveForCurrentChannel()
		wireCallDockControls(dock)
		syncDockJumpVisibility(dock)
		const localTile = avGrid?.querySelector('[data-peer-id="local"]')
		if (options.media === 'audio') {
			setCallControlHidden(dock, 'video', true)
			localTile?.classList.add('is-audio-only')
			void hydrateLocalVoiceAvatar(voiceLocal)
		}
		else {
			setCallControlHidden(dock, 'video', false)
			localTile?.classList.remove('is-audio-only')
		}
	}
	catch (error) {
		if (gen !== joinGeneration) return
		console.error('call join failed:', error)
		callSession = null
		callChannelKey = null
		callGroupId = null
		callChannelId = null
		setCallDockVisible(false)
		setCallButtonActive(false)
		const errorText = error?.message || String(error)
		if (errorText.includes('WebCodecs'))
			showToastI18n('error', 'chat.hub.streamAvNoCodecs')
		else
			showToastI18n('error', 'chat.hub.callJoinFailed', { error: errorText })
	}
}

/**
 * @param {HTMLElement} tile tile
 * @param {string | null} entityHash 实体
 * @returns {Promise<void>}
 */
async function hydratePeerTile(tile, entityHash) {
	if (!entityHash) return
	tile.dataset.entityHash = entityHash
	const profile = await fetchUserProfile(entityHash).catch(() => null)
	const labelEl = tile.querySelector('[data-av-label], .hub-streaming-av-peer-label-inner')
	const displayName = resolveDisplayName({
		entityHash,
		profileName: profile?.name,
		fallbackLabel: entityHash.slice(0, 8),
	})
	if (labelEl) labelEl.textContent = displayName
	await applyVoiceRingAvatar(tile.querySelector('.hub-streaming-av-voice-host'), {
		entityHash,
		profile,
		label: displayName,
	})
}

/**
 * @param {HTMLElement | null} voiceLocal 本地声波宿主
 * @returns {Promise<void>}
 */
async function hydrateLocalVoiceAvatar(voiceLocal) {
	const entityHash = hubStore.viewer.viewerEntityHash || ''
	if (!entityHash || !(voiceLocal instanceof HTMLElement)) return
	const profile = await fetchUserProfile(entityHash).catch(() => null)
	await applyVoiceRingAvatar(voiceLocal, {
		entityHash,
		profile,
		label: resolveDisplayName({
			entityHash,
			profileName: profile?.name,
			fallbackLabel: geti18n('chat.hub.streamAvYou') || 'you',
		}),
	})
}

/**
 * @param {Element | null} voiceHost 声波宿主
 * @param {{ entityHash: string, profile?: object | null, label: string }} options 选项
 * @returns {Promise<void>}
 */
async function applyVoiceRingAvatar(voiceHost, options) {
	if (!(voiceHost instanceof HTMLElement)) return
	const avatarEl = voiceHost.querySelector('.voice-ring-avatar')
	if (!(avatarEl instanceof HTMLElement)) return
	const avatar = customProfileAvatar(options.profile)
	if (!avatar) return
	if (avatarEl.tagName === 'IMG') {
		avatarEl.src = avatar
		return
	}
	const img = document.createElement('img')
	img.className = 'voice-ring-avatar'
	img.alt = options.label || ''
	img.src = avatar
	avatarEl.replaceWith(img)
}

/**
 * @param {HTMLElement} dock dock
 * @param {string} channelName 频道名
 * @returns {void}
 */
function updateDockChannelLabel(dock, channelName) {
	const el = dock.querySelector('[data-call-channel-name]')
	if (el) el.textContent = channelName ? `#${channelName}` : ''
}

/**
 * @param {HTMLElement} dock dock
 * @returns {void}
 */
function syncDockJumpVisibility(dock) {
	const jump = dock.querySelector('[data-call-role="jump"]')
	const staticTitle = dock.querySelector('.hub-call-dock-title-static')
	const away = !!(callGroupId && callChannelId && (
		hubStore.context.currentGroupId !== callGroupId
		|| hubStore.context.currentChannelId !== callChannelId
	))
	if (jump instanceof HTMLElement) jump.hidden = !away
	if (staticTitle instanceof HTMLElement) staticTitle.hidden = away
}

/**
 * @returns {Promise<HTMLElement>} dock
 */
async function ensureCallDock() {
	let dock = document.getElementById('hub-call-dock')
	if (dock) return dock
	dock = document.createElement('div')
	dock.id = 'hub-call-dock'
	dock.className = 'hub-call-dock'
	dock.hidden = true
	await mountTemplate(dock, 'hub/call/dock', {
		muteIconHtml: iconifyImg(CALL_ICONS.mute, { width: 20, height: 20 }),
		videoIconHtml: iconifyImg(CALL_ICONS.video, { width: 20, height: 20 }),
		screenIconHtml: iconifyImg(CALL_ICONS.screen, { width: 20, height: 20 }),
		hangupIconHtml: iconifyImg(CALL_ICONS.hangup, { width: 20, height: 20 }),
	})
	const main = document.querySelector('.hub-main') || document.body
	const header = main.querySelector('.hub-main-header')
	if (header) header.after(dock)
	else main.prepend(dock)
	return dock
}

/**
 * @param {HTMLButtonElement} button 按钮
 * @param {string} icon iconify id
 * @param {string} i18nKey title/i18n
 * @param {boolean} [active] 高亮
 * @returns {void}
 */
function setCallControlIcon(button, icon, i18nKey, active = false) {
	if (!(button instanceof HTMLElement)) return
	delete button.dataset.i18n
	const label = geti18n(i18nKey) || ''
	button.title = label
	button.setAttribute('aria-label', label)
	button.classList.toggle('is-active', active)
	const img = button.querySelector('img')
	if (img) img.src = iconifyUrl(icon)
	else button.innerHTML = iconifyImg(icon, { width: 20, height: 20 })
}

/**
 * @param {HTMLElement} dock dock
 * @param {string} role role
 * @param {boolean} hidden 隐藏
 * @returns {void}
 */
function setCallControlHidden(dock, role, hidden) {
	const btn = dock.querySelector(`[data-call-role="${role}"]`)
	if (btn instanceof HTMLElement) btn.hidden = hidden
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

	setCallControlIcon(byRole.mute, CALL_ICONS.mute, 'chat.hub.streamAvMute')
	setCallControlIcon(byRole.video, CALL_ICONS.video, 'chat.hub.streamAvVideo')
	setCallControlIcon(byRole.screen, CALL_ICONS.screen, 'chat.hub.callScreenShare')
	setCallControlIcon(byRole.hangup, CALL_ICONS.hangup, 'chat.hub.callHangup')
	if (byRole.jump instanceof HTMLElement) {
		byRole.jump.title = geti18n('chat.hub.callJumpBack') || ''
		byRole.jump.setAttribute('aria-label', byRole.jump.title)
	}

	byRole.mute?.addEventListener('click', () => {
		const muted = callSession?.toggleMute()
		setCallControlIcon(
			byRole.mute,
			muted ? CALL_ICONS.unmute : CALL_ICONS.mute,
			muted ? 'chat.hub.streamAvUnmute' : 'chat.hub.streamAvMute',
			!!muted,
		)
	})
	byRole.video?.addEventListener('click', () => {
		const off = callSession?.toggleVideo()
		setCallControlIcon(
			byRole.video,
			off ? CALL_ICONS.videoOff : CALL_ICONS.video,
			off ? 'chat.hub.streamAvVideoOn' : 'chat.hub.streamAvVideo',
			!!off,
		)
	})
	byRole.screen?.addEventListener('click', () => {
		void (async () => {
			try {
				const on = await callSession?.toggleScreen?.()
				setCallControlIcon(
					byRole.screen,
					on ? CALL_ICONS.screenOff : CALL_ICONS.screen,
					on ? 'chat.hub.callScreenStop' : 'chat.hub.callScreenShare',
					!!on,
				)
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.callScreenFailed', { error: error?.message || String(error) })
			}
		})()
	})
	byRole.hangup?.addEventListener('click', () => { void leaveChannelCall() })
	byRole.jump?.addEventListener('click', () => {
		void jumpToCallChannel()
	})
}

/**
 * @returns {Promise<void>}
 */
async function jumpToCallChannel() {
	if (!callGroupId || !callChannelId) return
	const { selectGroup, selectChannel } = await import('./sidebar/index.mjs')
	if (hubStore.context.currentGroupId !== callGroupId)
		await selectGroup(callGroupId)
	if (hubStore.context.currentChannelId !== callChannelId)
		await selectChannel(callChannelId)
	const dock = document.getElementById('hub-call-dock')
	if (dock) syncDockJumpVisibility(dock)
	refreshCallButtonActiveForCurrentChannel()
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
 * 顶栏电话按钮 active：当前浏览频道是否就是通话频道。
 * @returns {void}
 */
export function refreshCallButtonActiveForCurrentChannel() {
	const onCallChannel = !!(
		callSession
		&& callGroupId
		&& callChannelId
		&& hubStore.context.currentGroupId === callGroupId
		&& hubStore.context.currentChannelId === callChannelId
	)
	setCallButtonActive(onCallChannel)
	const dock = document.getElementById('hub-call-dock')
	if (dock && callSession) syncDockJumpVisibility(dock)
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
	refreshCallButtonActiveForCurrentChannel()
	if (callSession && callChannelKey === `${hubStore.context.currentGroupId}:${hubStore.context.currentChannelId}`)
		return
	const groupId = hubStore.context.currentGroupId
	const channelId = hubStore.context.currentChannelId
	if (!groupId || !channelId) {
		if (!callSession) updateCallBadge(0)
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
	callButton.addEventListener('click', event => {
		const groupId = hubStore.context.currentGroupId
		const channelId = hubStore.context.currentChannelId
		if (!groupId || !channelId) return
		if (callSession && callChannelKey === `${groupId}:${channelId}`) {
			void leaveChannelCall()
			return
		}
		if (callSession && callChannelKey && callChannelKey !== `${groupId}:${channelId}`) {
			void jumpToCallChannel()
			return
		}
		const media = event.shiftKey ? 'audio' : 'av'
		void joinChannelCall(groupId, channelId, { media })
	})
}
