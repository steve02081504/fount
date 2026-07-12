/**
 * Hub 跨群 inbox 视图（#mentions）。
 */
import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'

import { aliasForEntity } from '../shared/aliases.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { groupDisplayName } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { MENTIONS_HASH, updateMentionsHash } from './core/urlHash.mjs'
import { closeGroupWebSocket } from './groupStream.mjs'
import { fetchMentionsPage, markMentionsSeen } from './mentionsInbox.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import { scrollToMessageEventId } from './messages/messages.mjs'
import { clearPrivateGroupState } from './privateGroup.mjs'

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
function formatMentionTime(at) {
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
async function renderMentionRow(row) {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'hub-mention-row'
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
	const time = escapeHtml(formatMentionTime(row.at))
	button.innerHTML = `
		<div class="hub-mention-row-head">
			<strong>${author}</strong>
			<span class="hub-mention-row-time">${time}</span>
		</div>
		<div class="hub-mention-row-meta">${groupName} · #${channelName}</div>
		<div class="hub-mention-row-preview">${preview}</div>
	`
	return button
}

/**
 * @param {HTMLElement} host 列表容器
 * @param {object[]} rows 新页
 * @param {boolean} replace 是否替换
 * @returns {Promise<void>}
 */
async function paintMentionRows(host, rows, replace = false) {
	if (replace) host.replaceChildren()
	for (const row of rows)
		host.appendChild(await renderMentionRow(row))
	ensureScrollSentinel(host, 'hubMentionsScrollSentinel')
}

/**
 * @returns {Promise<void>}
 */
async function loadMentionsPage() {
	if (loading) return
	loading = true
	try {
		const data = await fetchMentionsPage({
			limit: 30,
			cursor: nextCursor || undefined,
			kinds: [activeKind],
		})
		const host = document.getElementById('hub-mentions-list')
		if (!host) return
		await paintMentionRows(host, data.items || [], !nextCursor)
		nextCursor = data.nextCursor
		bindInfiniteScroll({
			root: host.closest('.hub-mentions-scroll') || null,
			sentinel: ensureScrollSentinel(host, 'hubMentionsScrollSentinel'),
			hasMore: () => !!nextCursor,
			onLoad: () => loadMentionsPage(),
		})
		if (!host.querySelector('.hub-mention-row') && !nextCursor)
			host.innerHTML = '<div class="hub-mentions-empty" data-i18n="chat.hub.mentions.empty"></div>'
	}
	finally {
		loading = false
	}
}

/**
 * @param {HTMLElement} host 列表根
 * @returns {void}
 */
function wireMentionRowClicks(host) {
	host.addEventListener('click', event => {
		const row = event.target instanceof HTMLElement ? event.target.closest('.hub-mention-row') : null
		if (!row) return
		const groupId = row.dataset.groupId
		const channelId = row.dataset.channelId
		const eventId = row.dataset.eventId
		if (!groupId || !channelId || !eventId) return
		void (async () => {
			const { selectGroup } = await import('./groupNav.mjs')
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
	for (const tab of document.querySelectorAll('.hub-mentions-tab'))
		tab.classList.toggle('hub-mentions-tab-active', tab.dataset.kind === kind)
	await loadMentionsPage()
}

/**
 * 渲染并进入 #mentions 收件箱（由 setMode('mentions') 调用）。
 * @returns {Promise<void>}
 */
export async function activateMentionsView() {
	updateMentionsHash()
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
		await mountTemplate(channelList, 'hub/nav/side_muted', { i18nKey: 'chat.hub.mentions.sidebarHint' })
	document.getElementById('hub-member-list').innerHTML = ''
	document.getElementById('hub-info-card-host').innerHTML = ''
	document.getElementById('hub-group-name-display').dataset.i18n = 'chat.hub.mentions.title'

	const messagesHost = document.getElementById('hub-messages')
	messagesHost.innerHTML = `
		<div class="hub-mentions-panel">
			<div class="hub-mentions-panel-title" data-i18n="chat.hub.mentions.title"></div>
			<div class="hub-mentions-tabs" role="tablist">
				<button type="button" class="hub-mentions-tab hub-mentions-tab-active" data-kind="mention" data-i18n="chat.hub.mentions.tabMention"></button>
				<button type="button" class="hub-mentions-tab" data-kind="message" data-i18n="chat.hub.mentions.tabMessage"></button>
				<button type="button" class="hub-mentions-tab" data-kind="care" data-i18n="chat.hub.mentions.tabCare"></button>
				<button type="button" class="hub-mentions-tab" data-kind="vote_closed" data-i18n="chat.hub.mentions.tabVoteClosed"></button>
			</div>
			<div class="hub-mentions-scroll">
				<div id="hub-mentions-list" class="hub-mentions-list"></div>
			</div>
		</div>
	`
	document.getElementById('hub-channel-name-display').dataset.i18n = 'chat.hub.mentions.title'
	const { disableComposer, refreshHubHeaderButtons } = await import('./messages/composerController.mjs')
	disableComposer('chat.hub.mentions.composerDisabled')
	refreshHubHeaderButtons()

	const listHost = document.getElementById('hub-mentions-list')
	if (listHost && !listHost.dataset.wired) {
		listHost.dataset.wired = '1'
		wireMentionRowClicks(listHost)
	}
	for (const tab of document.querySelectorAll('.hub-mentions-tab'))
		tab.addEventListener('click', () => void switchInboxKind(tab.dataset.kind || 'mention'))
	await loadMentionsPage()
	await markMentionsSeen()
}

/** @returns {boolean} 当前是否为 mentions 模式 */
export function isMentionsModeActive() {
	return hubStore.context.currentMode === 'mentions' || window.location.hash.slice(1) === MENTIONS_HASH
}

/** @returns {void} */
export function closeMentionsInboxView() {
	disconnectInfiniteScroll()
	nextCursor = null
}
