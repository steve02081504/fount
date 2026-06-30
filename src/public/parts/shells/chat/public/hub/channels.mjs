/**
 * 【文件】public/hub/channels.mjs
 * 【职责】非标准文本频道的主栏渲染：列表频道、流媒体频道与 WebRTC 流媒体壳层模板挂载。
 * 【原理】`renderListChannel`、`renderStreamingChannel`、`renderWebRtcStreamingChannel` 替换主消息区布局；列表频道内嵌项由 `messages` 管道渲染；流媒体频道展示直播占位而非聊天气泡。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/template、core/domUtils、streamingAv。
 */
import {
	mountTemplate,
	renderTemplateAsHtmlString,
	renderTemplateNoScriptActivation,
} from '../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import {
	getHubAvSession,
	joinHubAvSession,
	leaveHubAvSession,
	setHubAvToolbarInCall,
	wireHubAvToolbar,
} from './streamingAv.mjs'

const AV_PRESETS = [
	{ key: 'thumb', i18nKey: 'chat.hub.streamAvPresetThumb' },
	{ key: 'low', i18nKey: 'chat.hub.streamAvPresetLow' },
	{ key: 'med', i18nKey: 'chat.hub.streamAvPresetMed', selected: true },
	{ key: 'high', i18nKey: 'chat.hub.streamAvPresetHigh' },
]

/**
 * @param {string} type 频道类型
 * @returns {Promise<string>} 侧栏用图标 HTML
 */
export async function channelTypeIconHtml(type) {
	return renderTemplateAsHtmlString('hub/nav/channel_type_icon', { type })
}

/**
 * 将频道按 `parentChannelId` 建树（允许环：未入树的节点补在末尾）。
 * @param {Record<string, object>} channels 频道表
 * @returns {{ ordered: { id: string, channel: object, depth: number }[] }} 扁平有序频道行
 */
export function buildChannelTree(channels) {
	/** @type {{ id: string, channel: object }[]} */
	const nodes = Object.entries(channels || {}).map(([id, channel]) => ({ id, channel }))
	const childIds = new Set()
	for (const { id, channel } of nodes) {
		const parentId = channel?.parentChannelId
		if (parentId && channels[parentId]) childIds.add(id)
	}
	const roots = nodes.filter(node => !childIds.has(node.id))
	/** @type {Map<string, string[]>} */
	const byParent = new Map()
	for (const { id, channel } of nodes) {
		const parentId = channel?.parentChannelId
		if (parentId && channels[parentId]) {
			if (!byParent.has(parentId)) byParent.set(parentId, [])
			byParent.get(parentId).push(id)
		}
	}
	/**
	 * @param {string} channelId 频道 id
	 * @param {number} depth 缩进深度
	 * @returns {{ id: string, channel: object, depth: number }[]} 子树扁平列表
	 */
	function flatten(channelId, depth) {
		const channel = channels[channelId]
		if (!channel) return []
		const row = [{ id: channelId, channel, depth }]
		for (const childId of byParent.get(channelId) || [])
			row.push(...flatten(childId, depth + 1))
		return row
	}
	/** @type {{ id: string, channel: object, depth: number }[]} */
	const ordered = []
	for (const root of roots)
		ordered.push(...flatten(root.id, 0))
	for (const { id, channel } of nodes)
		if (!ordered.some(row => row.id === id))
			ordered.push({ id, channel, depth: 0 })

	return { ordered }
}

/**
 * @param {HTMLElement} container 消息区根
 * @param {string} channelId 列表频道 id
 * @param {object} channel 频道元数据
 * @param {(targetChannelId: string) => void | Promise<void>} onOpenChannel 点击子频道
 * @param {Array<{ title?: string, description?: string, targetChannelId?: string, url?: string }>} items 条目
 * @returns {void}
 */
async function renderListItems(container, channelId, channel, onOpenChannel, items) {
	if (!items.length) {
		await mountTemplate(container, 'hub/channels/list_empty', {
			channelName: escapeHtml(channel?.name || channelId),
		})
		return
	}
	await mountTemplate(container, 'hub/channels/list_cards', { items })
	container.querySelectorAll('.hub-list-jump').forEach(jumpButton => {
		jumpButton.addEventListener('click', () => {
			const targetChannelId = jumpButton.getAttribute('data-target-channel')
			if (targetChannelId) void onOpenChannel(targetChannelId)
		})
	})
}

/**
 * @param {HTMLElement} hint 提示元素
 * @param {string} key i18n 键
 * @param {Record<string, string>} [params] 插值参数
 * @returns {void}
 */
function setListEditorHint(hint, key, params = {}) {
	if (!hint) return
	hint.dataset.i18n = key
	for (const [k, v] of Object.entries(params))
		hint.dataset[k] = v
}

/**
 * @param {object} channel 频道元数据
 * @returns {{ channelName: string, useChannelName: boolean }} 流媒体标题模板数据
 */
function streamTitleData(channel) {
	const name = String(channel?.name || '').trim()
	return {
		channelName: escapeHtml(name),
		useChannelName: !!name,
	}
}

/**
 * 渲染 list 频道主区（条目卡片 + 可选 JSON 编辑面板）。
 * @param {HTMLElement} container 消息区根
 * @param {string} groupId 群 ID
 * @param {string} channelId 列表频道 id
 * @param {object} channel 频道元数据（含 manualItems）
 * @param {(targetChannelId: string) => void | Promise<void>} onOpenChannel 点击子频道
 * @param {{ canEdit?: boolean, onSave?: (items: object[]) => Promise<void> }} [opts] 编辑权限与保存回调
 * @returns {Promise<void>}
 */
export async function renderListChannel(container, groupId, channelId, channel, onOpenChannel, opts = {}) {
	void groupId
	const items = Array.isArray(channel?.manualItems) ? channel.manualItems : []
	await mountTemplate(container, 'hub/channels/list_shell', {})
	const listHost = container.querySelector('.hub-list-body')
	if (!listHost) return
	await renderListItems(listHost, channelId, channel, onOpenChannel, items)

	if (!opts.canEdit) return

	const editor = await renderTemplateNoScriptActivation('hub/channels/list_editor', {})
	editor.className = 'hub-list-editor'
	const ta = /** @type {HTMLTextAreaElement} */ editor.querySelector('.hub-list-editor-input')
	const hint = editor.querySelector('.hub-list-editor-hint')
	ta.value = JSON.stringify(items, null, 2)
	editor.querySelector('.hub-list-save')?.addEventListener('click', async () => {
		if (hint instanceof HTMLElement) {
			delete hint.dataset.i18n
			hint.textContent = ''
		}
		let parsed
		try {
			parsed = JSON.parse(ta.value)
			if (!Array.isArray(parsed)) throw new Error('expected JSON array')
		}
		catch (e) {
			setListEditorHint(hint, 'chat.hub.listJsonInvalid', { message: e.message })
			return
		}
		try {
			await opts.onSave(parsed)
			await renderListItems(listHost, channelId, channel, onOpenChannel, parsed)
			channel.manualItems = parsed
			setListEditorHint(hint, 'chat.hub.listSaved')
		}
		catch (error) {
			if (!(hint instanceof HTMLElement)) return
			const errorMessage = error.message || ''
			if (errorMessage) {
				delete hint.dataset.i18n
				hint.textContent = errorMessage
			}
			else setListEditorHint(hint, 'chat.hub.listSaveFailed')
		}
	})
	container.appendChild(editor)
}

/**
 * 渲染 streaming 频道（嵌入 SFU URL，优先带签名的 embedUrl）。
 * @param {HTMLElement} container 消息区根
 * @param {object} channel 频道元数据
 * @param {{ streamingSfuWss?: string, embedUrl?: string, streamError?: string }} opts 群设置与签发 URL
 * @returns {Promise<void>}
 */
export async function renderStreamingChannel(container, channel, opts = {}) {
	const embed = opts.embedUrl?.trim() || ''
	const wss = opts.streamingSfuWss?.trim() || ''
	const src = embed || (wss.startsWith('https://') || wss.startsWith('http://') ? wss : '')
	const title = streamTitleData(channel)

	if (src) {
		await mountTemplate(container, 'hub/channels/stream_sfu', {
			...title,
			mode: 'iframe',
			src,
			streamError: opts.streamError ? escapeHtml(opts.streamError) : '',
		})
		container.querySelector('.hub-stream-refresh-button')?.addEventListener('click', () => {
			void opts.onRefreshAuth?.()
		})
		return
	}

	const emptyI18nKey = opts.streamError
		? ''
		: wss
			? 'chat.hub.streamEmbedHttpsRequired'
			: 'chat.hub.streamWebRtcHint'
	await mountTemplate(container, 'hub/channels/stream_sfu', {
		...title,
		mode: 'empty',
		src: '',
		streamError: opts.streamError ? escapeHtml(opts.streamError) : '',
		emptyI18nKey,
	})
}

/**
 * 渲染流媒体频道（无外部 SFU 时：WebCodecs + av-relay）。
 * @param {HTMLElement} container 消息区根
 * @param {object} channel 频道元数据
 * @param {{ groupId: string, channelId: string, clientId: string }} opts 本机身份
 * @returns {Promise<void>}
 */
export async function renderWebRtcStreamingChannel(container, channel, opts) {
	await mountTemplate(container, 'hub/channels/stream_webrtc', {
		...streamTitleData(channel),
		presets: AV_PRESETS,
	})

	const presetSelect = /** @type {HTMLSelectElement | null} */ document.getElementById('hub-streaming-av-preset')
	const peerLabel = document.getElementById('hub-streaming-av-peer-label')
	const toolbar = document.getElementById('hub-streaming-av-toolbar')
	const avGrid = document.getElementById('hub-streaming-av-grid')
	const localVideo = /** @type {HTMLVideoElement | null} */ document.getElementById('hub-streaming-av-local-video')
	if (!presetSelect || !peerLabel || !toolbar || !avGrid || !localVideo) return

	void wireHubAvToolbar(toolbar, {
		/** @returns {Promise<void>} */
		onJoin: async () => {
			presetSelect.disabled = true
			await joinHubAvSession({
				groupId: opts.groupId,
				channelId: opts.channelId,
				presetKey: presetSelect.value,
				avGrid,
				videoLocal: localVideo,
				/**
				 * @param {number} count 房间人数
				 * @returns {void}
				 */
				onPeerCount: count => {
					peerLabel.dataset.i18n = 'chat.hub.streamAvPeers'
					peerLabel.dataset.count = String(count)
				},
			})
			setHubAvToolbarInCall(toolbar, !!getHubAvSession())
		},
		/** @returns {Promise<void>} */
		onLeave: async () => {
			await leaveHubAvSession()
			localVideo.srcObject = null
			avGrid.querySelectorAll('.streaming-av-tile:not([data-peer-id="local"])').forEach(t => t.remove())
			delete peerLabel.dataset.i18n
			delete peerLabel.dataset.count
			peerLabel.textContent = ''
			presetSelect.disabled = false
			setHubAvToolbarInCall(toolbar, false)
		},
		/** @returns {boolean} 静音后为 true */
		onMute: () => getHubAvSession()?.toggleMute() ?? false,
		/** @returns {boolean} 关闭视频后为 true */
		onVideo: () => getHubAvSession()?.toggleVideo() ?? false,
	})
}
