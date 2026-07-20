/**
 * 【文件】public/hub/streamingAv.mjs
 * 【职责】Hub 顶栏音视频会话门面：封装加入/离开通话、`wireHubAvToolbar` 与 in-call 按钮态。
 * 【原理】管理 `#av-toolbar` 等控件可见性与图标切换（`setHubAvToolbarInCall`）。委托 `codecsAv` 的 relay WebSocket；离开频道时 `leaveHubAvSession` 清理会话。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】codecsAv
 */
import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'

import { joinCodecsAvRoom, leaveCodecsAvRoom } from './codecsAv.mjs'
/** @type {import('./codecsAv.mjs').CodecsAvSession | null} */
let activeAvSession = null
/** @type {string | null} */
let activeChannelId = null

/** @returns {import('./codecsAv.mjs').CodecsAvSession | null} 当前通话会话 */
export function getHubAvSession() {
	return activeAvSession
}

/**
 * 底层会话收尾时复位门面（勿再 leave，避免递归）。
 * @returns {void}
 */
function onStreamingSessionClosed() {
	activeAvSession = null
	activeChannelId = null
	const toolbar = document.getElementById('streaming-av-toolbar')
	if (toolbar) setHubAvToolbarInCall(toolbar, false)
}

/**
 * 离开当前 WebCodecs 会话并释放媒体轨道。
 * @returns {Promise<void>}
 */
export async function leaveHubAvSession() {
	if (!activeAvSession) return
	activeAvSession = null
	activeChannelId = null
	await leaveCodecsAvRoom()
	const toolbar = document.getElementById('streaming-av-toolbar')
	if (toolbar) setHubAvToolbarInCall(toolbar, false)
}

/**
 * 在流媒体频道内启动/加入 WebCodecs 中继通话。
 * @param {object} options 参数
 * @param {string} options.groupId 群 ID
 * @param {string} options.channelId 频道 ID
 * @param {string} [options.presetKey] 画质预设 thumb|low|med|high
 * @param {HTMLElement} options.avGrid 视频网格
 * @param {HTMLVideoElement | null} [options.videoLocal] 本地预览
 * @param {(count: number) => void} [options.onPeerCount] 在线人数
 * @returns {Promise<void>}
 */
export async function joinHubAvSession(options) {
	const { groupId, channelId, presetKey, avGrid, videoLocal = null, onPeerCount } = options
	if (activeAvSession && activeChannelId === channelId) return
	await leaveHubAvSession()
	// 若有文本频道通话占用底层会话，先走 call 门面挂断以复位 dock
	const { isInChannelCall, leaveChannelCall } = await import('./call.mjs')
	if (isInChannelCall()) await leaveChannelCall()
	try {
		activeAvSession = await joinCodecsAvRoom({
			groupId,
			channelId,
			presetKey,
			avGrid,
			videoLocal,
			onPeerCount,
			onClosed: onStreamingSessionClosed,
		})
		activeChannelId = channelId
	}
	catch (error) {
		console.error('hub av join failed:', error)
		activeAvSession = null
		activeChannelId = null
		const errorMessage = error?.message || String(error)
		if (errorMessage.includes('WebCodecs'))
			showToastI18n('error', 'chat.hub.streamAvNoCodecs')
		else
			showToastI18n('error', 'chat.hub.streamAvJoinFailed', { error: errorMessage })
	}
}

/**
 * @param {HTMLElement} toolbar 工具栏容器
 * @param {{ onJoin: () => void, onLeave: () => void, onMute: () => void, onVideo: () => void }} handlers 按钮回调
 * @returns {void}
 */
export async function wireHubAvToolbar(toolbar, handlers) {
	await mountTemplate(toolbar, 'hub/streaming/av_toolbar', {})
	const byRole = Object.fromEntries(
		[...toolbar.querySelectorAll('[data-streaming-av-role]')].map(roleButton => [roleButton.getAttribute('data-streaming-av-role'), roleButton]),
	)
	byRole.join?.addEventListener('click', () => { void handlers.onJoin() })
	byRole.leave?.addEventListener('click', () => { void handlers.onLeave() })
	byRole.mute?.addEventListener('click', () => {
		const muted = handlers.onMute()
		byRole.mute.dataset.i18n = muted ? 'chat.hub.streamAvUnmute' : 'chat.hub.streamAvMute'
	})
	byRole.video?.addEventListener('click', () => {
		const off = handlers.onVideo()
		byRole.video.dataset.i18n = off ? 'chat.hub.streamAvVideoOn' : 'chat.hub.streamAvVideo'
	})
	toolbar.dataset.avJoinButton = '1'
	toolbar.dataset.avLeaveButton = '1'
}

/**
 * @param {HTMLElement} toolbar 工具栏
 * @param {boolean} inCall 是否在通话中
 * @returns {void}
 */
export function setHubAvToolbarInCall(toolbar, inCall) {
	const buttons = toolbar.querySelectorAll('button')
	if (buttons.length < 4) return
	buttons[0].hidden = inCall
	buttons[1].hidden = !inCall
	buttons[2].hidden = !inCall
	buttons[3].hidden = !inCall
}
