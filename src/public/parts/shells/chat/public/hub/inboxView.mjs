/**
 * Hub 跨群 inbox 视图（#inbox）。
 */
import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'

import { groupDisplayName } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { INBOX_HASH, updateInboxHash } from './core/urlHash.mjs'
import { fetchInboxPage, markInboxSeen } from './inboxClient.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import { scrollToMessageEventId } from './messages/messages.mjs'
import { clearPrivateGroupState } from './privateGroup.mjs'
import { closeGroupWebSocket } from './stream/index.mjs'

/** @type {string | null} */
let nextCursor = null

/** @type {boolean} */
let loading = false

/** @type {string} */
let activeKind = 'mention'

const INBOX_KINDS = ['mention', 'message', 'care', 'vote_closed']

/**
 * @param {number} at 毫秒时间戳
 * @returns {string} 本地化时间字符串
 */
function formatInboxTime(at) {
	const date = new Date(Number(at) || Date.now())
	const now = new Date()
	const sameDay = date.toDateString() === now.toDateString()
	return sameDay
		? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		: date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * @param {object} row inbox 行
 * @returns {Promise<HTMLElement>} 可点击行按钮
 */
async function renderInboxRow(row) {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'hub-inbox-row'
	button.dataset.groupId = row.groupId
	button.dataset.channelId = row.channelId
	button.dataset.eventId = row.eventId
	const author = escapeHtml(resolveDisplayName({
		entityHash: row.authorEntityHash,
		alias: aliasForEntity(row.authorEntityHash),
		profileName: row.authorDisplayName,
	}))
	const groupName = escapeHtml(await groupDisplayName(row.groupId, row.groupName))
	const channelName = escapeHtml(row.channelName || row.channelId)
	const preview = escapeHtml(String(row.textPreview || ''))
	const time = escapeHtml(formatInboxTime(row.at))
	button.innerHTML = `
		<div class="hub-inbox-row-head">
			<strong>${author}</strong>
			<span class="hub-inbox-row-time">${time}</span>
		</div>
		<div class="hub-inbox-row-meta">${groupName} · #${channelName}</div>
		<div class="hub-inbox-row-preview">${preview}</div>
	`
	return button
}

/**
 * @param {HTMLElement} host 列表容器
 * @param {object[]} rows 新页
 * @param {boolean} replace 是否替换
 * @returns {Promise<void>}
 */
async function paintInboxRows(host, rows, replace = false) {
	if (replace) host.replaceChildren()
	for (const row of rows)
		host.appendChild(await renderInboxRow(row))
	ensureScrollSentinel(host, 'hubInboxScrollSentinel')
}

/**
 * @returns {Promise<void>}
 */
async function loadInboxPage() {
	if (loading) return
	loading = true
	try {
		const data = await fetchInboxPage({
			limit: 30,
			cursor: nextCursor || undefined,
			kinds: [activeKind],
		})
		const host = document.getElementById('hub-inbox-list')
		if (!host) return
		await paintInboxRows(host, data.items || [], !nextCursor)
		nextCursor = data.nextCursor
		bindInfiniteScroll({
			root: host.closest('.hub-inbox-scroll') || null,
			sentinel: ensureScrollSentinel(host, 'hubInboxScrollSentinel'),
			/** @returns {boolean} 是否还有下一页 */
			hasMore: () => !!nextCursor,
			/** @returns {Promise<void>} 加载下一页 */
			onLoad: () => loadInboxPage(),
		})
		if (!host.querySelector('.hub-inbox-row') && !nextCursor)
			host.innerHTML = '<div class="hub-inbox-empty" data-i18n="chat.hub.inbox.empty"></div>'
	}
	finally {
		loading = false
	}
}

/**
 * @param {HTMLElement} host 列表根
 * @returns {void}
 */
function wireInboxRowClicks(host) {
	host.addEventListener('click', event => {
		const row = event.target instanceof HTMLElement ? event.target.closest('.hub-inbox-row') : null
		if (!row) return
		const { groupId, channelId, eventId } = row.dataset
		if (!groupId || !channelId || !eventId) return
		void (async () => {
			const { selectGroup } = await import('./sidebar/index.mjs')
			const { setPendingScrollTarget } = await import('./messages/channelMessageStore.mjs')
			setPendingScrollTarget(eventId, groupId, channelId)
			await selectGroup(groupId, channelId)
			await scrollToMessageEventId(eventId)
		})()
	})
}

/**
 * @param {string} kind inbox kind
 * @returns {Promise<void>}
 */
async function switchInboxKind(kind) {
	if (!INBOX_KINDS.includes(kind) || kind === activeKind) return
	activeKind = kind
	nextCursor = null
	for (const tab of document.querySelectorAll('.hub-inbox-tab'))
		tab.classList.toggle('hub-inbox-tab-active', tab.dataset.kind === kind)
	await loadInboxPage()
}

/**
 * 渲染并进入 #inbox 收件箱（由 setMode('inbox') 调用）。
 * @returns {Promise<void>}
 */
export async function activateInboxView() {
	updateInboxHash()
	cancelScheduledChannelRefresh()
	closeGroupWebSocket()
	clearPrivateGroupState()
	hubStore.context.currentGroupId = null
	hubStore.context.currentChannelId = null
	hubStore.context.currentState = null
	activeKind = 'mention'
	nextCursor = null

	const channelList = document.getElementById('hub-channel-list')
	if (channelList)
		await mountTemplate(channelList, 'hub/nav/side_muted', { i18nKey: 'chat.hub.inbox.sidebarHint' })
	document.getElementById('hub-member-list').innerHTML = ''
	document.getElementById('hub-info-card-host').innerHTML = ''
	document.getElementById('hub-group-name-display').dataset.i18n = 'chat.hub.inbox.title'

	const messagesHost = document.getElementById('hub-messages')
	messagesHost.innerHTML = `
		<div class="hub-inbox-panel">
			<div class="hub-inbox-panel-title" data-i18n="chat.hub.inbox.title"></div>
			<div class="hub-inbox-tabs" role="tablist">
				<button type="button" class="hub-inbox-tab hub-inbox-tab-active" data-kind="mention" data-i18n="chat.hub.inbox.tabMention"></button>
				<button type="button" class="hub-inbox-tab" data-kind="message" data-i18n="chat.hub.inbox.tabMessage"></button>
				<button type="button" class="hub-inbox-tab" data-kind="care" data-i18n="chat.hub.inbox.tabCare"></button>
				<button type="button" class="hub-inbox-tab" data-kind="vote_closed" data-i18n="chat.hub.inbox.tabVoteClosed"></button>
			</div>
			<div class="hub-inbox-scroll">
				<div id="hub-inbox-list" class="hub-inbox-list"></div>
			</div>
		</div>
	`
	document.getElementById('hub-channel-name-display').dataset.i18n = 'chat.hub.inbox.title'
	const { disableComposer, refreshHubHeaderButtons } = await import('./messages/composerController.mjs')
	disableComposer('chat.hub.inbox.composerDisabled')
	refreshHubHeaderButtons()

	const listHost = document.getElementById('hub-inbox-list')
	if (listHost && !listHost.dataset.wired) {
		listHost.dataset.wired = '1'
		wireInboxRowClicks(listHost)
	}
	for (const tab of document.querySelectorAll('.hub-inbox-tab'))
		tab.addEventListener('click', () => void switchInboxKind(tab.dataset.kind || 'mention'))
	await loadInboxPage()
	await markInboxSeen()
}

/** @returns {boolean} 当前是否为 inbox 模式 */
export function isInboxModeActive() {
	return hubStore.context.currentMode === 'inbox' || window.location.hash.slice(1) === INBOX_HASH
}

/** @returns {void} */
export function closeInboxView() {
	disconnectInfiniteScroll()
	nextCursor = null
}
