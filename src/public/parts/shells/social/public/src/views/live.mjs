import { buildSocialLiveAvWsUrl } from '../../shared/liveAvWsUrl.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { entityAvatarUrl, renderAvatarHtml } from '../lib/display.mjs'
import { bindVerticalSnap } from '../lib/verticalSnap.mjs'
import { activateView } from '../viewChrome.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { joinAvRelayRoom } from '/parts/shells:chat/shared/avRelayClient.mjs'
import { mountVoiceRing } from '/parts/shells:chat/shared/voiceRing.mjs'
import { themeColorForEntity } from '/parts/shells:chat/shared/themeColor.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/** @type {{ disconnect: () => void, observe: (el: HTMLElement) => void } | null} */
let snapBind = null
/** @type {string} */
let liveScope = 'local'
/** @type {string | null} */
let liveCursor = null
/** @type {object[]} */
let liveShownItems = []
let livePageLoading = false
/** @type {number} */
let currentLiveIndex = -1

/**
 * 每个 slide 的连接态：信令 WS + AV session。
 * @typedef {{ signalWs: WebSocket | null, avSession: { close: () => void, setMode?: (m: string) => void, getMode?: () => string } | null }} LiveSlideConn
 */
/** @type {WeakMap<HTMLElement, { destroy?: () => void }>} */
const voiceRingMounts = new WeakMap()

/**
 * @param {string} entityHash 实体
 * @returns {Promise<object | null>} profile
 */
async function fetchEntityProfile(entityHash) {
	try {
		const res = await fetch(`/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}`, { credentials: 'include' })
		if (!res.ok) return null
		const data = await res.json()
		return data?.profile || data || null
	}
	catch { return null }
}

/**
 * @param {HTMLElement} host 宿主
 * @param {string} entityHash 主播
 * @param {() => number[]} getLevels 电平
 * @returns {Promise<void>}
 */
async function mountLiveVoiceRing(host, entityHash, getLevels) {
	voiceRingMounts.get(host)?.destroy?.()
	const profile = await fetchEntityProfile(entityHash)
	host.classList.remove('hidden')
	const mount = mountVoiceRing({
		container: host,
		avatarUrl: entityAvatarUrl(entityHash, profile),
		avatarSeed: entityHash,
		avatarLabel: profile?.name || entityHash,
		themeColor: themeColorForEntity(profile, entityHash),
		getLevels,
	})
	voiceRingMounts.set(host, mount)
}

/** @type {WeakMap<HTMLElement, LiveSlideConn>} */
const slideConnections = new WeakMap()

/**
 * @param {HTMLElement} slide slide
 * @returns {void}
 */
function closeSlideConn(slide) {
	const conn = slideConnections.get(slide)
	if (!conn) return
	conn.signalWs?.close()
	conn.avSession?.close()
	slideConnections.delete(slide)
}

/**
 * @param {HTMLElement} slide slide
 * @returns {LiveSlideConn} 连接态
 */
function getOrCreateConn(slide) {
	let conn = slideConnections.get(slide)
	if (!conn) {
		conn = { signalWs: null, avSession: null }
		slideConnections.set(slide, conn)
	}
	return conn
}

/**
 * @param {string} [targetEntityHash] 定位主播
 * @param {string} [targetLiveId] 定位直播
 * @returns {Promise<void>}
 */
export async function loadLiveView(targetEntityHash, targetLiveId) {
	const container = document.getElementById('liveSnapContainer')
	if (!container) return

	for (const child of [...container.children])
		if (child instanceof HTMLElement) closeSlideConn(child)
	snapBind?.disconnect()
	snapBind = null
	container.replaceChildren()
	liveCursor = null
	liveShownItems = []
	livePageLoading = false
	currentLiveIndex = -1

	ensureLiveScopeTabs()

	const data = await socialApi(
		`/live/feed?limit=20&scope=${encodeURIComponent(liveScope)}`,
	).catch(() => ({ items: [], nextCursor: null }))
	const items = data.items || []
	liveCursor = data.nextCursor || null

	if (!items.length) {
		container.innerHTML = `<div class="live-slide"><p class="live-empty">${escapeHtml(geti18n('social.live.empty'))}</p></div>`
		return
	}

	if (liveScope === 'nearby') {
		renderLiveHallGrid(container, items)
		return
	}

	liveShownItems = [...items]
	appendLiveSlides(container, items)

	snapBind = bindVerticalSnap(container, {
		/**
		 * @param {number} index 索引
		 * @param {HTMLElement} el slide
		 * @returns {void}
		 */
		onEnter: (index, el) => {
			currentLiveIndex = index
			activateLiveSlide(container, index)
			void maybeLoadMoreLives(container, index)
		},
		/**
		 * @param {number} _index 离开索引
		 * @param {HTMLElement} el slide
		 * @returns {void}
		 */
		onLeave: (_index, el) => {
			demoteLiveSlide(el)
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
 * @param {HTMLElement} container 容器
 * @param {object[]} items 条目
 * @returns {void}
 */
function appendLiveSlides(container, items) {
	for (const item of items) {
		const slide = buildLiveSlide(item)
		container.appendChild(slide)
		snapBind?.observe(slide)
	}
}

/**
 * @param {HTMLElement} container 容器
 * @param {number} index 当前索引
 * @returns {Promise<void>}
 */
async function maybeLoadMoreLives(container, index) {
	if (livePageLoading || liveScope === 'nearby') return
	const remaining = container.children.length - index - 1
	if (remaining > 2) return

	if (liveCursor) {
		livePageLoading = true
		try {
			const data = await socialApi(
				`/live/feed?limit=20&scope=${encodeURIComponent(liveScope)}&cursor=${encodeURIComponent(liveCursor)}`,
			).catch(() => null)
			if (!data) return
			const items = data.items || []
			liveCursor = data.nextCursor || null
			if (items.length) {
				liveShownItems.push(...items)
				appendLiveSlides(container, items)
			}
		}
		finally {
			livePageLoading = false
		}
		return
	}

	if (!liveShownItems.length) return
	livePageLoading = true
	try {
		appendLiveSlides(container, liveShownItems)
	}
	finally {
		livePageLoading = false
	}
}

/**
 * 当前条 full；下一条预连 preview。
 * @param {HTMLElement} container 容器
 * @param {number} index 当前索引
 * @returns {void}
 */
function activateLiveSlide(container, index) {
	const current = container.children[index]
	const next = container.children[index + 1]
	if (current instanceof HTMLElement)
		ensureLiveConnected(current, 'full')
	if (next instanceof HTMLElement)
		ensureLiveConnected(next, 'preview')

	for (let i = 0; i < container.children.length; i++) {
		if (i === index || i === index + 1) continue
		const el = container.children[i]
		if (el instanceof HTMLElement) closeSlideConn(el)
	}
}

/**
 * @param {HTMLElement} slide slide
 * @returns {void}
 */
function demoteLiveSlide(slide) {
	const conn = slideConnections.get(slide)
	if (!conn?.avSession) return
	if (typeof conn.avSession.setMode === 'function')
		conn.avSession.setMode('preview')
}

/**
 * @param {HTMLElement} slide slide
 * @param {'full' | 'preview'} mode 档位
 * @returns {void}
 */
function ensureLiveConnected(slide, mode) {
	const { entityHash, liveId } = slide.dataset
	if (!entityHash || !liveId) return
	const conn = getOrCreateConn(slide)
	if (!conn.signalWs || conn.signalWs.readyState > 1)
		conn.signalWs = openLiveSignalWs(slide, entityHash, liveId, slide.dataset)

	if (conn.avSession && typeof conn.avSession.setMode === 'function') {
		conn.avSession.setMode(mode)
		if (mode === 'full')
			slide.querySelector('.live-placeholder')?.classList.add('hidden')
		return
	}

	const canvas = slide.querySelector('.live-av-canvas')
	const voiceHost = slide.querySelector('[data-voice-ring]')
	const mediaKind = slide.dataset.mediaKind || 'av'
	const audioOnly = mediaKind === 'audio'
	if (audioOnly && voiceHost instanceof HTMLElement) {
		canvas?.classList.add('hidden')
		void mountLiveVoiceRing(voiceHost, entityHash, () => {
			const lv = conn.avSession?.getAudioLevels?.() || []
			return lv.length ? lv : Array(16).fill(0.05)
		})
	}
	if (!(canvas instanceof HTMLCanvasElement) && !audioOnly) return
	const federated = slide.dataset.federated === '1'
	const finalAvUrl = federated
		? `${buildSocialLiveAvWsUrl(entityHash, liveId)}?proxy=1&bridgeOrigin=${encodeURIComponent(slide.dataset.bridgeOrigin || '')}&watchSecret=${encodeURIComponent(slide.dataset.watchSecret || '')}`
		: buildSocialLiveAvWsUrl(entityHash, liveId)
	void joinAvRelayRoom({
		wsUrl: finalAvUrl,
		asPublisher: false,
		canvas: audioOnly ? null : canvas,
		mode,
		/** @param {{ video?: boolean, audio?: boolean }} meta 发布者媒体能力 */
		onPublishMeta: meta => {
			if (!meta?.video && meta?.audio && voiceHost instanceof HTMLElement) {
				canvas?.classList.add('hidden')
				void mountLiveVoiceRing(voiceHost, entityHash, () => conn.avSession?.getAudioLevels?.() || [])
			}
		},
	}).then(session => {
		const current = slideConnections.get(slide)
		if (!current || current !== conn) {
			session.close()
			return
		}
		conn.avSession = session
		if (mode === 'full' || session.getMode?.() === 'full')
			slide.querySelector('.live-placeholder')?.classList.add('hidden')
	}).catch(() => { /* keep placeholder */ })
}

/**
 * @returns {void}
 */
function ensureLiveScopeTabs() {
	const tabs = document.getElementById('liveScopeTabs')
	const goBroadcast = document.getElementById('liveGoBroadcastButton')
	if (!tabs) return
	if (!tabs.dataset.bound) {
		tabs.dataset.bound = '1'
		tabs.addEventListener('click', event => {
			const tabButton = event.target.closest('[data-scope]')
			if (!(tabButton instanceof HTMLElement)) return
			liveScope = tabButton.dataset.scope || 'local'
			void loadLiveView()
		})
		goBroadcast?.addEventListener('click', () => {
			activateView('liveBroadcast')
		})
	}
	if (goBroadcast) goBroadcast.textContent = geti18n('social.live.broadcast.open')
	for (const tabButton of tabs.querySelectorAll('[data-scope]')) {
		if (!(tabButton instanceof HTMLElement)) continue
		const active = tabButton.dataset.scope === liveScope
		tabButton.textContent = geti18n(
			tabButton.dataset.scope === 'nearby' ? 'social.live.hall' : 'social.live.local',
		)
		tabButton.classList.toggle('is-active', active)
		tabButton.setAttribute('aria-selected', active ? 'true' : 'false')
	}
}

/**
 * @param {HTMLElement} container 容器
 * @param {object[]} items 条目
 * @returns {void}
 */
function renderLiveHallGrid(container, items) {
	const grid = document.createElement('div')
	grid.className = 'live-hall-grid'
	for (const item of items) {
		const card = document.createElement('button')
		card.type = 'button'
		card.className = 'live-hall-card'
		card.innerHTML = `
			${renderAvatarHtml(item.entityHash, {
		name: item.authorName || item.title,
		avatar: item.avatarUrl || item.authorProfile?.avatar,
		infoDefaults: item.authorProfile?.infoDefaults,
	}, 'live-hall-avatar')}
			<div class="live-hall-meta">
				<div class="live-hall-title">${escapeHtml(item.title || '')}</div>
				<div class="live-hall-stats">${geti18n('social.live.viewers', { n: item.viewerCount || 0 })}
					· ${geti18n('social.live.likes', { n: item.likeCount || 0 })}</div>
			</div>
		`
		card.addEventListener('click', () => {
			liveScope = 'local'
			for (const child of [...container.children])
				if (child instanceof HTMLElement) closeSlideConn(child)
			container.replaceChildren()
			const slide = buildLiveSlide(item)
			container.appendChild(slide)
			ensureLiveConnected(slide, 'full')
		})
		grid.appendChild(card)
	}
	container.appendChild(grid)
}

/**
 * @param {object} item 条目
 * @returns {HTMLElement} slide
 */
function buildLiveSlide(item) {
	const slide = document.createElement('div')
	slide.className = 'live-slide'
	slide.dataset.entityHash = item.entityHash || ''
	slide.dataset.liveId = item.liveId || ''
	if (item.federated) slide.dataset.federated = '1'
	if (item.bridgeOrigin) slide.dataset.bridgeOrigin = item.bridgeOrigin
	if (item.watchSecret) slide.dataset.watchSecret = item.watchSecret

	if (item.mediaKind) slide.dataset.mediaKind = item.mediaKind

	slide.innerHTML = `
		<div class="live-av-wrap">
			<canvas class="live-av-canvas" width="640" height="480"></canvas>
			<div class="live-voice-ring-host hidden" data-voice-ring></div>
			<canvas class="live-av-canvas live-av-canvas-peer hidden" width="640" height="480"></canvas>
		</div>
		<div class="live-placeholder">
			<span class="live-badge">LIVE</span>
			<div class="live-title">${escapeHtml(item.title || item.authorName || '')}</div>
			<p class="live-viewer-count" data-viewer-count>${geti18n('social.live.viewers', { n: item.viewerCount || 0 })}</p>
			<p class="live-like-count" data-like-count>${geti18n('social.live.likes', { n: item.likeCount || 0 })}</p>
		</div>
		<div class="live-overlay">
			<div class="danmaku-area" data-danmaku></div>
			<div class="live-bottom">
				<div class="live-info">
					<span class="live-author">${escapeHtml(item.authorName || '')}</span>
					<span class="live-viewer-count" data-viewer-count>${geti18n('social.live.viewers', { n: item.viewerCount || 0 })}</span>
					<span class="live-like-count" data-like-count>${geti18n('social.live.likes', { n: item.likeCount || 0 })}</span>
				</div>
				<div class="live-danmaku-input">
					<input type="text" class="live-danmaku-field" maxlength="100"
						placeholder="${escapeHtml(geti18n('social.live.danmakuPlaceholder'))}" />
					<button type="button" class="live-danmaku-send-btn">${escapeHtml(geti18n('social.live.danmakuSend'))}</button>
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
	const ws = slideConnections.get(slide)?.signalWs
	if (ws?.readyState === WebSocket.OPEN)
		ws.send(JSON.stringify({ type: 'danmaku', text }))
}

/**
 * @param {HTMLElement} slide slide
 * @returns {Promise<void>}
 */
async function sendLiveLike(slide) {
	const ws = slideConnections.get(slide)?.signalWs
	if (ws?.readyState === WebSocket.OPEN)
		ws.send(JSON.stringify({ type: 'like' }))
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
 * @param {HTMLElement} slide slide
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @param {DOMStringMap | object} [meta] 联邦线索
 * @returns {WebSocket} 信令 WS
 */
function openLiveSignalWs(slide, entityHash, liveId, meta = {}) {
	const federated = meta.federated === '1' || meta.federated === true
	const qs = federated
		? `?proxy=1&bridgeOrigin=${encodeURIComponent(meta.bridgeOrigin || '')}&watchSecret=${encodeURIComponent(meta.watchSecret || '')}`
		: ''
	const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/parts/shells:social/live/${entityHash}/${liveId}${qs}`
	const ws = new WebSocket(wsUrl)

	ws.addEventListener('message', event => {
		let wireMessage = null
		try { wireMessage = JSON.parse(event.data) } catch { return }
		if (!wireMessage?.type) return

		if (wireMessage.type === 'danmaku' && wireMessage.text)
			addDanmakuItem(slide, wireMessage.text, wireMessage.authorName)
		else if (wireMessage.type === 'like')
			showHeartFloat(slide)
		else if (wireMessage.type === 'viewer_count' || wireMessage.type === 'link_stats') {
			const n = wireMessage.viewerCount ?? wireMessage.count ?? 0
			for (const el of slide.querySelectorAll('[data-viewer-count]'))
				el.textContent = geti18n('social.live.viewers', { n })
			if (wireMessage.likeCount != null)
				for (const el of slide.querySelectorAll('[data-like-count]'))
					el.textContent = geti18n('social.live.likes', { n: wireMessage.likeCount })
		}
		else if (wireMessage.type === 'like_count')
			for (const el of slide.querySelectorAll('[data-like-count]'))
				el.textContent = geti18n('social.live.likes', { n: wireMessage.count ?? 0 })
		else if (wireMessage.type === 'hello' && wireMessage.likeCount != null) {
			for (const el of slide.querySelectorAll('[data-like-count]'))
				el.textContent = geti18n('social.live.likes', { n: wireMessage.likeCount })
			if (wireMessage.link)
				slide.classList.add('live-linked')
		}
		else if (wireMessage.type === 'link_started')
			slide.classList.add('live-linked')
		else if (wireMessage.type === 'link_ended')
			slide.classList.remove('live-linked')
	})

	return ws
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
 * @returns {void}
 */
export function initLiveBroadcastView() {
	const startBtn = document.getElementById('liveStartButton')
	const stopBtn = document.getElementById('liveStopButton')
	const statusEl = document.getElementById('liveBroadcastStatus')
	const previewCanvas = document.getElementById('liveBroadcastCanvas')
	const voiceRingHost = document.getElementById('liveBroadcastVoiceRing')
	const mediaModeSelect = document.getElementById('liveMediaMode')
	const whipPanel = document.getElementById('liveWhipPanel')
	const whipUrlInput = document.getElementById('liveWhipUrl')
	const whipTokenInput = document.getElementById('liveWhipToken')
	const linkPeerInput = document.getElementById('liveLinkPeerInput')
	const linkInviteBtn = document.getElementById('liveLinkInviteButton')
	let activeLiveId = null
	let viewerEntityHash = null
	/** @type {{ close: () => void, getAudioLevels?: () => number[] } | null} */
	let publishSession = null
	/** @type {{ destroy?: () => void } | null} */
	let broadcastVoiceRing = null

	mediaModeSelect?.addEventListener('change', () => {
		const mode = mediaModeSelect.value || 'av'
		previewCanvas?.classList.toggle('hidden', mode === 'audio' || mode === 'whip')
		voiceRingHost?.classList.toggle('hidden', mode !== 'audio')
		whipPanel?.classList.toggle('hidden', mode !== 'whip')
	})

	startBtn?.addEventListener('click', async () => {
		try {
			const title = document.getElementById('liveTitleInput')?.value?.trim() || ''
			const mediaKind = mediaModeSelect?.value || 'av'
			const data = await socialApi('/live/start', {
				method: 'POST',
				body: JSON.stringify({ title, bridgeOrigin: location.origin, mediaKind }),
			})
			activeLiveId = data.liveId
			viewerEntityHash = data.entityHash
			startBtn.classList.add('hidden')
			stopBtn?.classList.remove('hidden')
			document.getElementById('liveLinkRow')?.classList.remove('hidden')
			if (statusEl) statusEl.textContent = geti18n('social.live.broadcast.started')

			if (mediaKind === 'whip') {
				const whip = `${location.origin}/api/parts/shells:social/live/${data.liveId}/whip`
				if (whipUrlInput instanceof HTMLInputElement) whipUrlInput.value = whip
				if (whipTokenInput instanceof HTMLInputElement) whipTokenInput.value = data.ingestSecret || ''
				whipPanel?.classList.remove('hidden')
				if (statusEl) statusEl.textContent = geti18n('social.live.broadcast.whipWaiting')
				return
			}

			const relayMedia = mediaKind === 'av' ? 'av' : mediaKind
			if (mediaKind === 'audio' && voiceRingHost instanceof HTMLElement) {
				previewCanvas?.classList.add('hidden')
				broadcastVoiceRing?.destroy?.()
				publishSession = await joinAvRelayRoom({
					wsUrl: buildSocialLiveAvWsUrl(data.entityHash, data.liveId),
					asPublisher: true,
					media: 'audio',
				})
				await mountLiveVoiceRing(voiceRingHost, data.entityHash, () => publishSession?.getAudioLevels?.() || [])
				broadcastVoiceRing = voiceRingMounts.get(voiceRingHost) || null
				return
			}

			if (previewCanvas instanceof HTMLCanvasElement && data.entityHash && data.liveId)
				publishSession = await joinAvRelayRoom({
					wsUrl: buildSocialLiveAvWsUrl(data.entityHash, data.liveId),
					asPublisher: true,
					canvas: previewCanvas,
					media: relayMedia,
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
			broadcastVoiceRing?.destroy?.()
			broadcastVoiceRing = null
			voiceRingHost?.classList.add('hidden')
			previewCanvas?.classList.remove('hidden')
			whipPanel?.classList.add('hidden')
			await socialApi('/live/stop', { method: 'POST', body: JSON.stringify({ liveId: activeLiveId }) })
			activeLiveId = null
			viewerEntityHash = null
			stopBtn.classList.add('hidden')
			document.getElementById('liveLinkRow')?.classList.add('hidden')
			startBtn?.classList.remove('hidden')
			if (statusEl) statusEl.textContent = geti18n('social.live.broadcast.stopped')
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
			if (statusEl) statusEl.textContent = geti18n('social.live.link.needPeer')
			return
		}
		try {
			const result = await socialApi(`/live/${activeLiveId}/link/invite`, {
				method: 'POST',
				body: JSON.stringify({ peerEntityHash, peerLiveId, bridgeOrigin: location.origin }),
			})
			if (statusEl)
				statusEl.textContent = geti18n(
					result.status === 'linked' ? 'social.live.link.linked' : 'social.live.link.invited',
				)
		}
		catch (err) {
			if (statusEl) statusEl.textContent = String(err?.message || err)
		}
	})
}
