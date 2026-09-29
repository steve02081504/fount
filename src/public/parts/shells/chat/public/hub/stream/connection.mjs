/**
 * 【文件】public/hub/stream/connection.mjs
 * 【职责】群 Hub WebSocket 连接生命周期：connect / close / wait / isOpen + 断线指数退避重连。
 * 【原理】服务端在登记 UI socket 后下发 `{ type: 'subscribed' }`；客户端以该帧（而非浏览器 open）作为就绪信号，
 * 并在 close 后按退避重连，重连成功即增量刷新 view-log 与 `/state` 追赶断线期间的事件。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { setElementI18n } from '../../../../../scripts/i18n/index.mjs'
import { buildChatGroupWebSocketUrl } from '../../src/wsUrl.mjs'
import { store } from '../core/state.mjs'

import * as conn from './connectionState.mjs'
import { handleChannelMessageWire } from './handlers/channelMessage.mjs'
import { handleDagEventWire } from './handlers/dagEvent.mjs'
import { handleProfileUpdateWire } from './handlers/profileUpdate.mjs'
import { handleVolatileStreamWire } from './handlers/streamChunk.mjs'
import { attachGroupWebSocketErrorHandlers } from './outbound.mjs'
import { resetVolatileStreamState } from './volatileSlots.mjs'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

/** 期望保持连接的群/频道；断线重连依据。 @type {string | null} */
let desiredGroupId = null
/** @type {string | null} */
let desiredChannelId = null
/** 主动关闭（切群/离开）标记，阻止 close 触发重连。 */
let intentionalClose = false
/** 已收到 `subscribed` 帧的群。 @type {string | null} */
let subscribedGroupId = null
/** @type {ReturnType<typeof setTimeout> | null} */
let reconnectTimer = null
let reconnectAttempt = 0
/** 等待 `subscribed` 的调用方。 @type {{ groupId: string, resolve: (value: boolean) => void }[]} */
let subscribeWaiters = []
let reconnectTriggersBound = false
/** @type {HTMLElement | null} */
let connectionLostBadge = null

/** @returns {boolean} 群 WS 已 OPEN */
export function isGroupWebSocketOpen() {
	return !!(conn.groupWebSocket && conn.connectedGroupId && conn.groupWebSocket.readyState === WebSocket.OPEN)
}

/** @returns {void} */
export function closeGroupWebSocket() {
	intentionalClose = true
	desiredGroupId = null
	desiredChannelId = null
	subscribedGroupId = null
	clearReconnectTimer()
	resetVolatileStreamState()
	hideConnectionLostIndicator()
	try {
		conn.groupWebSocket?.close()
	}
	catch { /* empty */ }
	conn.setConnectionHandles(null, null, null)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ timeoutMs?: number }} [options] 超时
 * @returns {Promise<boolean>} 是否在超时内收到 `subscribed`
 */
export function waitForGroupWebSocketOpen(groupId, channelId, { timeoutMs = 8000 } = {}) {
	if (!groupId) return Promise.resolve(false)
	desiredGroupId = groupId
	desiredChannelId = channelId
	if (conn.groupWebSocket && conn.connectedGroupId === groupId && conn.groupWebSocket.readyState === WebSocket.OPEN) {
		conn.setActiveChannelId(channelId)
		if (subscribedGroupId === groupId) return Promise.resolve(true)
	}
	connectGroupWebSocket(groupId, channelId)
	return new Promise(resolve => {
		let settled = false
		let timer
		/** @type {{ groupId: string, resolve: (value: boolean) => void }} */
		let waiter
		/** @param {boolean} value 订阅成功与否 @returns {void} */
		const finish = value => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			subscribeWaiters = subscribeWaiters.filter(pending => pending !== waiter)
			resolve(value)
		}
		waiter = { groupId, resolve: finish }
		subscribeWaiters.push(waiter)
		timer = setTimeout(() => finish(false), timeoutMs)
	})
}

/**
 * @param {object} wireMessage WS 载荷
 * @param {string} channelId 当前频道
 * @returns {void}
 */
function handleGroupHubWireMessage(wireMessage, channelId) {
	if (!wireMessage?.type) return
	if (handleProfileUpdateWire(wireMessage)) return
	if (handleChannelMessageWire(wireMessage, channelId)) return
	handleDagEventWire(wireMessage, channelId)
}

/** @returns {void} */
function clearReconnectTimer() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}
}

/**
 * @param {string} groupId 订阅成功的群
 * @returns {void}
 */
function notifySubscribed(groupId) {
	subscribedGroupId = groupId
	reconnectAttempt = 0
	hideConnectionLostIndicator()
	const waiters = subscribeWaiters
	subscribeWaiters = []
	for (const waiter of waiters)
		if (waiter.groupId === groupId) waiter.resolve(true)
	catchUpAfterSubscribe(groupId)
}

/**
 * 订阅成功后追赶断线窗口：增量刷新 view-log 并重取 `/state`。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
function catchUpAfterSubscribe(groupId) {
	if (store.context.currentGroupId !== groupId || !store.context.currentChannelId) return
	void import('../messages/messages.mjs')
		.then(({ scheduleChannelIncrementalRefresh }) => scheduleChannelIncrementalRefresh({ immediate: true }))
		.catch(() => { /* 消息图未就绪时忽略 */ })
	void import('./stateRefresh.mjs')
		.then(({ refreshGroupState }) => refreshGroupState(groupId))
		.catch(() => { /* empty */ })
}

/**
 * 显示「连接丢失」指示（`chat.hub.stream.connectionLost` 文案）。
 * @returns {void}
 */
function showConnectionLostIndicator() {
	if (typeof document === 'undefined' || connectionLostBadge) return
	const badge = document.createElement('div')
	badge.dataset.hubConnectionLost = ''
	badge.setAttribute('role', 'status')
	badge.style.cssText = 'position:fixed;z-index:60;bottom:calc(env(safe-area-inset-bottom, 0px) + 12px);inset-inline-end:12px;padding:6px 12px;	border-radius:var(--radius-selector);background:var(--color-warning, #d97706);color:#fff;font-size:12px;box-shadow:var(--shadow-md);pointer-events:none'
	setElementI18n(badge, 'chat.hub.stream.connectionLost')
	document.body.appendChild(badge)
	connectionLostBadge = badge
}

/** @returns {void} */
function hideConnectionLostIndicator() {
	connectionLostBadge?.remove()
	connectionLostBadge = null
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
function scheduleReconnect(groupId, channelId) {
	clearReconnectTimer()
	showConnectionLostIndicator()
	const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS)
	reconnectAttempt++
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null
		if (intentionalClose || desiredGroupId !== groupId) return
		if (store.context.currentGroupId !== groupId) return
		openGroupWebSocket(groupId, desiredChannelId || channelId)
	}, delay)
}

/** 绑定 `visibilitychange` / `online` 断线补偿重连。 @returns {void} */
function bindReconnectTriggers() {
	if (reconnectTriggersBound || typeof document === 'undefined') return
	reconnectTriggersBound = true
	/** @returns {void} */
	const maybeReconnect = () => {
		if (!desiredGroupId || intentionalClose || document.hidden) return
		if (store.context.currentGroupId !== desiredGroupId) return
		const readyState = conn.groupWebSocket?.readyState
		if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) return
		reconnectAttempt = 0
		clearReconnectTimer()
		openGroupWebSocket(desiredGroupId, desiredChannelId)
	}
	document.addEventListener('visibilitychange', maybeReconnect)
	window.addEventListener('online', maybeReconnect)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function connectGroupWebSocket(groupId, channelId) {
	if (!groupId) return
	if (conn.groupWebSocket && conn.connectedGroupId === groupId) {
		conn.setActiveChannelId(channelId)
		const readyState = conn.groupWebSocket.readyState
		if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
			desiredGroupId = groupId
			desiredChannelId = channelId
			return
		}
	}
	reconnectAttempt = 0
	clearReconnectTimer()
	if (conn.groupWebSocket) closeGroupWebSocket()
	desiredGroupId = groupId
	desiredChannelId = channelId
	openGroupWebSocket(groupId, channelId)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
function openGroupWebSocket(groupId, channelId) {
	const ownerNodeHash = store.viewer.nodeHash
	if (!ownerNodeHash) {
		showToastI18n('warning', 'chat.hub.profilePopup.noFedIdentity')
		return
	}
	bindReconnectTriggers()
	intentionalClose = false
	subscribedGroupId = null
	const socket = new WebSocket(buildChatGroupWebSocketUrl(ownerNodeHash, groupId))
	conn.setConnectionHandles(socket, groupId, channelId)
	attachGroupWebSocketErrorHandlers(socket)
	socket.addEventListener('open', () => {
		if (conn.groupWebSocket !== socket) return
		if (store.viewer.nodeHash && socket.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify({
				type: 'group_ws_rpc_identity',
				clientNodeId: store.viewer.nodeHash,
			}))
	})
	socket.addEventListener('message', event => {
		if (conn.groupWebSocket !== socket) return
		let wireMessage
		try {
			wireMessage = JSON.parse(event.data)
		}
		catch {
			return
		}
		if (!wireMessage?.type) return
		if (wireMessage.type === 'subscribed') {
			notifySubscribed(groupId)
			return
		}
		const currentChannelId = conn.activeChannelId || channelId
		handleGroupHubWireMessage(wireMessage, currentChannelId)
		void handleVolatileStreamWire(wireMessage, currentChannelId)
	})
	socket.addEventListener('close', () => {
		if (conn.groupWebSocket !== socket) return
		conn.setConnectionHandles(null, null, null)
		subscribedGroupId = null
		resetVolatileStreamState()
		if (!intentionalClose && desiredGroupId === groupId)
			scheduleReconnect(groupId, channelId)
	})
}
