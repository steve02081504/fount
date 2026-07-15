import { bindVerticalSnap } from '../lib/verticalSnap.mjs'
import { activateView } from '../viewChrome.mjs'
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
/** @type {string} */
let liveScope = 'local'

/**
 * @param {object} appContext 应用上下文
 * @param {string} [targetEntityHash] 定位主播
 * @param {string} [targetLiveId] 定位直播
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

	ensureLiveScopeTabs(appContext)

	const data = await appContext.socialApi(`/live/feed?scope=${encodeURIComponent(liveScope)}`).catch(() => ({ items: [] }))
	const items = data.items || []

	if (!items.length) {
		container.innerHTML = `<div class="live-slide"><p class="live-empty">${escapeHtml(appContext.geti18n('social.live.empty'))}</p></div>`
		return
	}

	if (liveScope === 'nearby') {
		renderLiveHallGrid(appContext, container, items)
		return
	}

	for (const item of items) {
		const slide = buildLiveSlide(appContext, item)
		container.appendChild(slide)
	}

	snapBind = bindVerticalSnap(container, {
		/**
		 * @param {unknown} _ unused
		 * @param {HTMLElement} el slide
		 * @returns {void}
		 */
		onEnter: (_, el) => {
			activeRoomWs?.close()
			activeRoomWs = null
			activeAvSession?.close()
			activeAvSession = null
			const { entityHash, liveId } = el.dataset
			if (entityHash && liveId)
				connectLiveRoom(appContext, el, entityHash, liveId, el.dataset)
		},
		/**
		 * @returns {void}
		 */
		onLeave: () => {
			activeRoomWs?.close()
			activeRoomWs = null
			activeAvSession?.close()
			activeAvSession = null
		},
	})

	if (targetEntityHash && targetLiveId) 
		for (const slide of container.children) 
			if (slide.dataset.entityHash === targetEntityHash && slide.dataset.liveId === targetLiveId) {
				slide.scrollIntoView()
				break
			}
		
	
}

/**
 * @param {object} appContext ctx
 * @returns {void}
 */
function ensureLiveScopeTabs(appContext) {
	let tabs = document.getElementById('liveScopeTabs')
	if (!tabs) {
		const liveView = document.getElementById('liveView')
		if (!liveView) return
		tabs = document.createElement('div')
		tabs.id = 'liveScopeTabs'
		tabs.className = 'live-scope-tabs'
		tabs.innerHTML = `
			<button type="button" data-scope="local" class="live-scope-btn"></button>
			<button type="button" data-scope="nearby" class="live-scope-btn"></button>
			<button type="button" data-scope="broadcast" class="live-scope-btn" data-view-broadcast></button>
		`
		liveView.prepend(tabs)
		tabs.addEventListener('click', event => {
			const btn = event.target.closest('[data-scope]')
			if (!(btn instanceof HTMLElement)) return
			if (btn.dataset.viewBroadcast != null) {
				activateView('liveBroadcast')
				return
			}
			liveScope = btn.dataset.scope || 'local'
			void loadLiveView(appContext)
		})
	}
	for (const btn of tabs.querySelectorAll('[data-scope]')) {
		if (!(btn instanceof HTMLElement)) continue
		if (btn.dataset.viewBroadcast != null) {
			btn.textContent = appContext.geti18n('social.live.broadcast.open')
			continue
		}
		btn.textContent = appContext.geti18n(
			btn.dataset.scope === 'nearby' ? 'social.live.hall' : 'social.live.local',
		)
		btn.classList.toggle('is-active', btn.dataset.scope === liveScope)
	}
}

/**
 * @param {object} appContext ctx
 * @param {HTMLElement} container 容器
 * @param {object[]} items 条目
 * @returns {void}
 */
function renderLiveHallGrid(appContext, container, items) {
	const grid = document.createElement('div')
	grid.className = 'live-hall-grid'
	for (const item of items) {
		const card = document.createElement('button')
		card.type = 'button'
		card.className = 'live-hall-card'
		card.innerHTML = `
			<div class="live-hall-avatar" data-avatar-for="${escapeHtml(item.entityHash || '')}"></div>
			<div class="live-hall-meta">
				<div class="live-hall-title">${escapeHtml(item.title || '')}</div>
				<div class="live-hall-stats">${appContext.geti18n('social.live.viewers', { n: item.viewerCount || 0 })}
					· ${appContext.geti18n('social.live.likes', { n: item.likeCount || 0 })}</div>
			</div>
		`
		card.addEventListener('click', () => {
			liveScope = 'local'
			container.replaceChildren()
			const slide = buildLiveSlide(appContext, item)
			container.appendChild(slide)
			connectLiveRoom(appContext, slide, item.entityHash, item.liveId, {
				bridgeOrigin: item.bridgeOrigin || '',
				watchSecret: item.watchSecret || '',
				federated: item.federated ? '1' : '',
			})
		})
		grid.appendChild(card)
	}
	container.appendChild(grid)
}

/**
 * @param {object} appContext ctx
 * @param {object} item 条目
 * @returns {HTMLElement} slide
 */
function buildLiveSlide(appContext, item) {
	const slide = document.createElement('div')
	slide.className = 'live-slide'
	slide.dataset.entityHash = item.entityHash || ''
	slide.dataset.liveId = item.liveId || ''
	if (item.federated) slide.dataset.federated = '1'
	if (item.bridgeOrigin) slide.dataset.bridgeOrigin = item.bridgeOrigin
	if (item.watchSecret) slide.dataset.watchSecret = item.watchSecret

	slide.innerHTML = `
		<div class="live-av-wrap">
			<canvas class="live-av-canvas" width="640" height="480"></canvas>
			<canvas class="live-av-canvas live-av-canvas-peer hidden" width="640" height="480"></canvas>
		</div>
		<div class="live-placeholder">
			<span class="live-badge">LIVE</span>
			<div class="live-title">${escapeHtml(item.title || item.authorName || '')}</div>
			<p class="live-viewer-count" data-viewer-count>${appContext.geti18n('social.live.viewers', { n: item.viewerCount || 0 })}</p>
			<p class="live-like-count" data-like-count>${appContext.geti18n('social.live.likes', { n: item.likeCount || 0 })}</p>
		</div>
		<div class="live-overlay">
			<div class="danmaku-area" data-danmaku></div>
			<div class="live-bottom">
				<div class="live-info">
					<span class="live-author">${escapeHtml(item.authorName || '')}</span>
					<span class="live-viewer-count" data-viewer-count>${appContext.geti18n('social.live.viewers', { n: item.viewerCount || 0 })}</span>
					<span class="live-like-count" data-like-count>${appContext.geti18n('social.live.likes', { n: item.likeCount || 0 })}</span>
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

	const sendBtn = slide.querySelector('.live-danmaku-send-btn')
	const danmakuInput = slide.querySelector('.live-danmaku-field')
	sendBtn?.addEventListener('click', () => sendDanmaku(slide))
	danmakuInput?.addEventListener('keydown', event => {
		if (event.key === 'Enter') sendDanmaku(slide)
	})

	let lastTap = 0
	slide.addEventListener('pointerup', async event => {
		if (event.target.closest('.live-danmaku-input') || event.target.closest('.live-actions')) return
		const now = Date.now()
		if (now - lastTap < 350) {
			lastTap = 0
			await sendLiveLike(slide)
		}
		else lastTap = now
	})

	slide.querySelector('.live-like-btn')?.addEventListener('click', async event => {
		event.stopPropagation()
		await sendLiveLike(slide)
	})

	return slide
}

/**
 * @param {HTMLElement} slide slide
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
 * @param {HTMLElement} slide slide
 * @returns {Promise<void>}
 */
async function sendLiveLike(slide) {
	if (activeRoomWs?.readyState === WebSocket.OPEN)
		activeRoomWs.send(JSON.stringify({ type: 'like' }))
	showHeartFloat(slide)
}

/**
 * @param {HTMLElement} slide slide
 * @returns {void}
 */
function showHeartFloat(slide) {
	const heart = document.createElement('div')
	heart.className = 'heart-anim'
	heart.textContent = '❤️'
	heart.style.cssText = 'position:absolute;left:50%;bottom:2rem;animation:heartFloat 1s ease-out forwards;pointer-events:none;'
	slide.appendChild(heart)
	setTimeout(() => heart.remove(), 1100)
}

/**
 * @param {object} appContext ctx
 * @param {HTMLElement} slide slide
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @param {DOMStringMap | object} [meta] 联邦线索
 * @returns {void}
 */
function connectLiveRoom(appContext, slide, entityHash, liveId, meta = {}) {
	const federated = meta.federated === '1' || meta.federated === true
	const qs = federated
		? `?proxy=1&bridgeOrigin=${encodeURIComponent(meta.bridgeOrigin || '')}&watchSecret=${encodeURIComponent(meta.watchSecret || '')}`
		: ''
	const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/parts/shells:social/live/${entityHash}/${liveId}${qs}`
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
		else if (msg.type === 'viewer_count' || msg.type === 'link_stats') {
			const n = msg.viewerCount ?? msg.count ?? 0
			for (const el of slide.querySelectorAll('[data-viewer-count]'))
				el.textContent = appContext.geti18n('social.live.viewers', { n })
			if (msg.likeCount != null)
				for (const el of slide.querySelectorAll('[data-like-count]'))
					el.textContent = appContext.geti18n('social.live.likes', { n: msg.likeCount })
		}
		else if (msg.type === 'like_count') 
			for (const el of slide.querySelectorAll('[data-like-count]'))
				el.textContent = appContext.geti18n('social.live.likes', { n: msg.count ?? 0 })
		
		else if (msg.type === 'hello' && msg.likeCount != null) {
			for (const el of slide.querySelectorAll('[data-like-count]'))
				el.textContent = appContext.geti18n('social.live.likes', { n: msg.likeCount })
			if (msg.link)
				slide.classList.add('live-linked')
		}
		else if (msg.type === 'link_started')
			slide.classList.add('live-linked')
		else if (msg.type === 'link_ended')
			slide.classList.remove('live-linked')
	})

	ws.addEventListener('close', () => {
		if (activeRoomWs === ws) activeRoomWs = null
	})

	const canvas = slide.querySelector('.live-av-canvas')
	if (canvas instanceof HTMLCanvasElement) {
		const finalAvUrl = federated
			? `${buildSocialLiveAvWsUrl(entityHash, liveId)}?proxy=1&bridgeOrigin=${encodeURIComponent(meta.bridgeOrigin || '')}&watchSecret=${encodeURIComponent(meta.watchSecret || '')}`
			: buildSocialLiveAvWsUrl(entityHash, liveId)
		void joinAvRelayRoom({
			wsUrl: finalAvUrl,
			asPublisher: false,
			canvas,
		}).then(session => {
			activeAvSession = session
			slide.querySelector('.live-placeholder')?.classList.add('hidden')
		}).catch(() => { /* keep placeholder */ })
	}
}

/**
 * @param {HTMLElement} slide slide
 * @param {string} text 弹幕
 * @param {string} [author] 作者
 * @returns {void}
 */
function addDanmakuItem(slide, text, author) {
	const area = slide.querySelector('[data-danmaku]')
	if (!area) return
	const item = document.createElement('div')
	item.className = 'danmaku-item'
	item.textContent = author ? `${author}: ${text}` : text
	item.style.top = `${Math.floor(Math.random() * 80)}%`
	area.appendChild(item)
	item.addEventListener('animationend', () => item.remove())
}

/**
 * @param {object} appContext ctx
 * @returns {void}
 */
export function initLiveBroadcastView(appContext) {
	const startBtn = document.getElementById('liveStartButton')
	const stopBtn = document.getElementById('liveStopButton')
	const statusEl = document.getElementById('liveBroadcastStatus')
	const previewCanvas = document.getElementById('liveBroadcastCanvas')
	const linkPeerInput = document.getElementById('liveLinkPeerInput')
	const linkInviteBtn = document.getElementById('liveLinkInviteButton')
	let activeLiveId = null
	/** @type {{ close: () => void, toggleMute?: () => boolean, toggleVideo?: () => boolean } | null} */
	let publishSession = null

	startBtn?.addEventListener('click', async () => {
		try {
			const title = document.getElementById('liveTitleInput')?.value?.trim() || ''
			const data = await appContext.socialApi('/live/start', {
				method: 'POST',
				body: JSON.stringify({ title, bridgeOrigin: location.origin }),
			})
			activeLiveId = data.liveId
			startBtn.classList.add('hidden')
			stopBtn?.classList.remove('hidden')
			document.getElementById('liveLinkRow')?.classList.remove('hidden')
			if (statusEl) statusEl.textContent = appContext.geti18n('social.live.broadcast.started')
			if (previewCanvas instanceof HTMLCanvasElement && data.entityHash && data.liveId) 
				publishSession = await joinAvRelayRoom({
					wsUrl: buildSocialLiveAvWsUrl(data.entityHash, data.liveId),
					asPublisher: true,
					canvas: previewCanvas,
				})
			
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
			document.getElementById('liveLinkRow')?.classList.add('hidden')
			startBtn?.classList.remove('hidden')
			if (statusEl) statusEl.textContent = appContext.geti18n('social.live.broadcast.stopped')
		}
		catch (err) {
			if (statusEl) statusEl.textContent = String(err?.message || err)
		}
	})

	linkInviteBtn?.addEventListener('click', async () => {
		if (!activeLiveId) return
		const raw = linkPeerInput?.value?.trim() || ''
		const [peerEntityHash, peerLiveId] = raw.split(':').map(s => s.trim())
		if (!peerEntityHash || !peerLiveId) {
			if (statusEl) statusEl.textContent = appContext.geti18n('social.live.link.needPeer')
			return
		}
		try {
			const result = await appContext.socialApi(`/live/${activeLiveId}/link/invite`, {
				method: 'POST',
				body: JSON.stringify({ peerEntityHash, peerLiveId, bridgeOrigin: location.origin }),
			})
			if (statusEl)
				statusEl.textContent = appContext.geti18n(
					result.status === 'linked' ? 'social.live.link.linked' : 'social.live.link.invited',
				)
		}
		catch (err) {
			if (statusEl) statusEl.textContent = String(err?.message || err)
		}
	})
}
