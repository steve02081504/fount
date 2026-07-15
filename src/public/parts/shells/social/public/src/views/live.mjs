import { bindVerticalSnap } from '../lib/verticalSnap.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import {
	buildSocialLiveAvWsUrl,
	joinAvRelayRoom,
} from '/parts/shells:chat/shared/avRelayClient.mjs'

/** @type {{ disconnect: () => void, observe: (el: HTMLElement) => void } | null} */
let snapBind = null
/** @type {WebSocket | null} */
let activeRoomWs = null
/** @type {{ close: () => void } | null} */
let activeAvSession = null

/**
 * 加载并渲染直播流列表。
 * @param {object} appContext 应用上下文
 * @param {string} [targetEntityHash] 定位到指定主播
 * @param {string} [targetLiveId] 定位到指定直播 id
 * @returns {Promise<void>}
 */
export async function loadLiveView(appContext, targetEntityHash, targetLiveId) {
	const container = document.getElementById('liveSnapContainer')
	if (!container) return

	activeRoomWs?.close()
	activeRoomWs = null
	activeAvSession?.close()
	activeAvSession = null
	snapBind?.disconnect()
	snapBind = null
	container.replaceChildren()

	const data = await appContext.socialApi('/live/feed').catch(() => ({ items: [] }))
	const items = data.items || []

	if (!items.length) {
		container.innerHTML = `<div class="live-slide"><p class="live-empty">${escapeHtml(appContext.geti18n('social.live.empty'))}</p></div>`
		return
	}

	for (const item of items) {
		const slide = buildLiveSlide(appContext, item)
		container.appendChild(slide)
	}

	snapBind = bindVerticalSnap(container, {
		onEnter: (_, el) => {
			activeRoomWs?.close()
			activeRoomWs = null
			activeAvSession?.close()
			activeAvSession = null
			const { entityHash, liveId } = el.dataset
			if (entityHash && liveId)
				connectLiveRoom(appContext, el, entityHash, liveId)
		},
		onLeave: () => {
			activeRoomWs?.close()
			activeRoomWs = null
			activeAvSession?.close()
			activeAvSession = null
		},
	})

	// 定位目标直播
	if (targetEntityHash && targetLiveId) {
		for (const slide of container.children) {
			if (slide.dataset.entityHash === targetEntityHash && slide.dataset.liveId === targetLiveId) {
				slide.scrollIntoView()
				break
			}
		}
	}
}

/**
 * @param {object} appContext 应用上下文
 * @param {object} item 直播条目
 * @returns {HTMLElement} slide 元素
 */
function buildLiveSlide(appContext, item) {
	const slide = document.createElement('div')
	slide.className = 'live-slide'
	slide.dataset.entityHash = item.entityHash || ''
	slide.dataset.liveId = item.liveId || ''

	slide.innerHTML = `
		<canvas class="live-av-canvas" width="640" height="480"></canvas>
		<div class="live-placeholder">
			<span class="live-badge">LIVE</span>
			<div class="live-title">${escapeHtml(item.title || item.authorName || '')}</div>
			<p class="live-viewer-count" data-viewer-count>${appContext.geti18n('social.live.viewers', { n: item.viewerCount || 0 })}</p>
		</div>
		<div class="live-overlay">
			<div class="danmaku-area" data-danmaku></div>
			<div class="live-bottom">
				<div class="live-info">
					<span class="live-author">${escapeHtml(item.authorName || '')}</span>
					<span class="live-viewer-count" data-viewer-count>${appContext.geti18n('social.live.viewers', { n: item.viewerCount || 0 })}</span>
				</div>
				<div class="live-danmaku-input">
					<input type="text" class="live-danmaku-field" maxlength="100"
						placeholder="${escapeHtml(appContext.geti18n('social.live.danmakuPlaceholder'))}" />
					<button type="button" class="live-danmaku-send-btn">${escapeHtml(appContext.geti18n('social.live.danmakuSend'))}</button>
				</div>
			</div>
		</div>
		<div class="live-actions">
			<button type="button" class="live-action-btn live-like-btn">
				<span class="s-ic s-ic-like" aria-hidden="true"></span>
			</button>
		</div>
	`

	// 发弹幕
	const sendBtn = slide.querySelector('.live-danmaku-send-btn')
	const danmakuInput = slide.querySelector('.live-danmaku-field')
	sendBtn?.addEventListener('click', () => sendDanmaku(slide))
	danmakuInput?.addEventListener('keydown', event => {
		if (event.key === 'Enter') sendDanmaku(slide)
	})

	// 双击 + 点赞按钮飘心
	let lastTap = 0
	slide.addEventListener('pointerup', async event => {
		if (event.target.closest('.live-danmaku-input') || event.target.closest('.live-actions')) return
		const now = Date.now()
		if (now - lastTap < 350) {
			lastTap = 0
			await sendLiveLike(appContext, slide)
		}
		else lastTap = now
	})

	slide.querySelector('.live-like-btn')?.addEventListener('click', async event => {
		event.stopPropagation()
		await sendLiveLike(appContext, slide)
	})

	return slide
}

/**
 * @param {HTMLElement} slide slide 元素
 * @returns {void}
 */
function sendDanmaku(slide) {
	const input = slide.querySelector('.live-danmaku-field')
	if (!(input instanceof HTMLInputElement) || !input.value.trim()) return
	const text = input.value.trim()
	input.value = ''
	if (activeRoomWs?.readyState === WebSocket.OPEN)
		activeRoomWs.send(JSON.stringify({ type: 'danmaku', text }))
}

/**
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} slide slide 元素
 * @returns {Promise<void>}
 */
async function sendLiveLike(appContext, slide) {
	const { entityHash, liveId } = slide.dataset
	if (!entityHash || !liveId) return
	if (activeRoomWs?.readyState === WebSocket.OPEN)
		activeRoomWs.send(JSON.stringify({ type: 'like' }))
	showHeartFloat(slide)
	// 乐观更新，不关心失败
	void appContext.socialApi(`/live/${entityHash}/${liveId}/like`, { method: 'POST' }).catch(() => {})
}

/**
 * @param {HTMLElement} slide slide 元素
 * @returns {void}
 */
function showHeartFloat(slide) {
	const area = slide.querySelector('.live-actions')
	if (!area) return
	const heart = document.createElement('div')
	heart.className = 'heart-anim'
	heart.textContent = '❤️'
	heart.style.cssText = 'position:absolute;left:50%;bottom:2rem;animation:heartFloat 1s ease-out forwards;pointer-events:none;'
	slide.appendChild(heart)
	setTimeout(() => heart.remove(), 1100)
}

/**
 * 连接直播间 WebSocket（弹幕/点赞/观看人数）。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} slide slide 元素
 * @param {string} entityHash 主播 entityHash
 * @param {string} liveId 直播 id
 * @returns {void}
 */
function connectLiveRoom(appContext, slide, entityHash, liveId) {
	const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/parts/shells:social/live/${entityHash}/${liveId}`
	const ws = new WebSocket(wsUrl)
	activeRoomWs = ws

	ws.addEventListener('message', event => {
		let msg = null
		try { msg = JSON.parse(event.data) } catch { return }
		if (!msg?.type) return

		if (msg.type === 'danmaku' && msg.text)
			addDanmakuItem(slide, msg.text, msg.authorName)
		else if (msg.type === 'like')
			showHeartFloat(slide)
		else if (msg.type === 'viewer_count') {
			for (const el of slide.querySelectorAll('[data-viewer-count]'))
				el.textContent = appContext.geti18n('social.live.viewers', { n: msg.count ?? 0 })
		}
	})

	ws.addEventListener('close', () => {
		if (activeRoomWs === ws) activeRoomWs = null
	})

	const canvas = slide.querySelector('.live-av-canvas')
	if (canvas instanceof HTMLCanvasElement) {
		void joinAvRelayRoom({
			wsUrl: buildSocialLiveAvWsUrl(entityHash, liveId),
			asPublisher: false,
			canvas,
		}).then(session => {
			activeAvSession = session
			slide.querySelector('.live-placeholder')?.classList.add('hidden')
		}).catch(() => { /* 无流时保留 LIVE 占位 */ })
	}
}

/**
 * @param {HTMLElement} slide slide 元素
 * @param {string} text 弹幕文本
 * @param {string} [author] 作者名
 * @returns {void}
 */
function addDanmakuItem(slide, text, author) {
	const area = slide.querySelector('[data-danmaku]')
	if (!area) return
	const item = document.createElement('div')
	item.className = 'danmaku-item'
	item.textContent = author ? `${author}: ${text}` : text
	const topPct = Math.floor(Math.random() * 80)
	item.style.top = `${topPct}%`
	area.appendChild(item)
	item.addEventListener('animationend', () => item.remove())
}

/**
 * 初始化开播控制面板。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function initLiveBroadcastView(appContext) {
	const startBtn = document.getElementById('liveStartButton')
	const stopBtn = document.getElementById('liveStopButton')
	const statusEl = document.getElementById('liveBroadcastStatus')
	const previewCanvas = document.getElementById('liveBroadcastCanvas')
	let activeLiveId = null
	/** @type {{ close: () => void, toggleMute?: () => boolean, toggleVideo?: () => boolean } | null} */
	let publishSession = null

	startBtn?.addEventListener('click', async () => {
		try {
			const title = document.getElementById('liveTitleInput')?.value?.trim() || ''
			const data = await appContext.socialApi('/live/start', {
				method: 'POST',
				body: JSON.stringify({ title }),
			})
			activeLiveId = data.liveId
			startBtn.classList.add('hidden')
			stopBtn?.classList.remove('hidden')
			if (statusEl) statusEl.textContent = appContext.geti18n('social.live.broadcast.started')
			if (previewCanvas instanceof HTMLCanvasElement && data.entityHash && data.liveId) {
				publishSession = await joinAvRelayRoom({
					wsUrl: buildSocialLiveAvWsUrl(data.entityHash, data.liveId),
					asPublisher: true,
					canvas: previewCanvas,
				})
			}
		}
		catch (err) {
			if (statusEl) statusEl.textContent = String(err?.message || err)
		}
	})

	stopBtn?.addEventListener('click', async () => {
		if (!activeLiveId) return
		try {
			publishSession?.close()
			publishSession = null
			await appContext.socialApi('/live/stop', { method: 'POST', body: JSON.stringify({ liveId: activeLiveId }) })
			activeLiveId = null
			stopBtn.classList.add('hidden')
			startBtn?.classList.remove('hidden')
			if (statusEl) statusEl.textContent = appContext.geti18n('social.live.broadcast.stopped')
		}
		catch (err) {
			if (statusEl) statusEl.textContent = String(err?.message || err)
		}
	})
}
