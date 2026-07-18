/**
 * Hub 跨群 inbox 视图（#inbox）。
 */
import { mountTemplate, renderTemplate } from '../../../../scripts/features/template.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

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

/** @type {number} */
let loadGeneration = 0

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
	const authorLabel = resolveDisplayName({
		entityHash: row.authorEntityHash,
		alias: aliasForEntity(row.authorEntityHash),
		profileName: row.authorDisplayName,
	})
	const groupLabel = await groupDisplayName(row.groupId, row.groupName)
	const channelLabel = String(row.channelName || row.channelId)
	const previewLabel = String(row.textPreview || '')
	const date = new Date(Number(row.at) || Date.now())
	return renderTemplate('hub/inbox/row', {
		groupId: String(row.groupId),
		channelId: String(row.channelId),
		eventId: String(row.eventId),
		author: escapeHtml(authorLabel),
		initial: escapeHtml(Array.from(authorLabel)[0] || '?'),
		groupName: escapeHtml(groupLabel),
		channelName: escapeHtml(channelLabel),
		preview: escapeHtml(previewLabel),
		time: escapeHtml(formatInboxTime(row.at)),
		dateTime: date.toISOString(),
		fullTime: date.toLocaleString(),
	})
}

/**
 * @param {HTMLElement} host 列表容器
 * @param {object[]} rows 新页
 * @param {boolean} replace 是否替换
 * @returns {Promise<void>}
 */
async function paintInboxRows(host, rows, replace = false) {
	if (replace) host.replaceChildren()
	host.append(...await Promise.all(rows.map(renderInboxRow)))
	ensureScrollSentinel(host, 'hubInboxScrollSentinel')
}

const EMPTY_STATES = {
	mention: {
		icon: 'line-md/at',
		titleKey: 'chat.hub.inbox.emptyMentionTitle',
		descriptionKey: 'chat.hub.inbox.emptyMentionDescription',
	},
	message: {
		icon: 'line-md/chat',
		titleKey: 'chat.hub.inbox.emptyMessageTitle',
		descriptionKey: 'chat.hub.inbox.emptyMessageDescription',
	},
	care: {
		icon: 'line-md/heart',
		titleKey: 'chat.hub.inbox.emptyCareTitle',
		descriptionKey: 'chat.hub.inbox.emptyCareDescription',
	},
	vote_closed: {
		icon: 'line-md/confirm-circle',
		titleKey: 'chat.hub.inbox.emptyVoteTitle',
		descriptionKey: 'chat.hub.inbox.emptyVoteDescription',
	},
}

/**
 * @param {HTMLElement} host 列表容器
 * @returns {Promise<void>}
 */
async function paintInboxEmpty(host) {
	await mountTemplate(host, 'hub/inbox/empty', EMPTY_STATES[activeKind])
}

/**
 * @param {number} generation 当前筛选条件的加载代次
 * @returns {Promise<void>}
 */
async function loadInboxPage(generation = loadGeneration) {
	if (loading) return
	loading = true
	const requestedCursor = nextCursor
	const host = document.getElementById('hub-inbox-list')
	if (host && !requestedCursor) host.setAttribute('aria-busy', 'true')
	try {
		const data = await fetchInboxPage({
			limit: 30,
			cursor: requestedCursor || undefined,
			kinds: [activeKind],
		})
		if (generation !== loadGeneration) return
		const currentHost = document.getElementById('hub-inbox-list')
		if (!currentHost) return
		await paintInboxRows(currentHost, data.items || [], !requestedCursor)
		nextCursor = data.nextCursor
		bindInfiniteScroll({
			root: currentHost.closest('.hub-inbox-scroll') || null,
			sentinel: ensureScrollSentinel(currentHost, 'hubInboxScrollSentinel'),
			/** @returns {boolean} 是否还有下一页 */
			hasMore: () => !!nextCursor,
			/** @returns {Promise<void>} 加载下一页 */
			onLoad: () => loadInboxPage(),
		})
		if (!currentHost.querySelector('.hub-inbox-row') && !nextCursor)
			await paintInboxEmpty(currentHost)
	}
	catch (error) {
		if (generation !== loadGeneration) return
		handleUIError(error, 'chat.hub.inbox.loadFailed')
		if (host && !host.querySelector('.hub-inbox-row')) await mountTemplate(host, 'hub/empty/error', {
			i18nKey: 'chat.hub.inbox.loadFailed',
			errorMessage: error.message,
		})
	}
	finally {
		if (generation === loadGeneration) {
			loading = false
			document.getElementById('hub-inbox-list')?.removeAttribute('aria-busy')
		}
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
		})().catch(error => handleUIError(error, 'chat.hub.inbox.jumpFailed'))
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
	loadGeneration++
	loading = false
	disconnectInfiniteScroll()
	for (const tab of document.querySelectorAll('.hub-inbox-tab')) {
		const active = tab.dataset.kind === kind
		tab.classList.toggle('hub-inbox-tab-active', active)
		tab.setAttribute('aria-selected', String(active))
		tab.tabIndex = active ? 0 : -1
	}
	const list = document.getElementById('hub-inbox-list')
	list?.setAttribute('aria-labelledby', `hub-inbox-tab-${kind.replace('_', '-')}`)
	await loadInboxPage()
}

/**
 * @param {HTMLElement} tablist 收件箱筛选标签容器
 * @returns {void}
 */
function wireInboxTabs(tablist) {
	const tabs = Array.from(tablist.querySelectorAll('.hub-inbox-tab'))
	for (const tab of tabs)
		tab.addEventListener('click', () => void switchInboxKind(tab.dataset.kind || 'mention'))
	tablist.addEventListener('keydown', event => {
		const currentIndex = tabs.indexOf(document.activeElement)
		if (currentIndex < 0) return
		let nextIndex
		if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
		else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
		else if (event.key === 'Home') nextIndex = 0
		else if (event.key === 'End') nextIndex = tabs.length - 1
		else return
		event.preventDefault()
		tabs[nextIndex].focus()
		void switchInboxKind(tabs[nextIndex].dataset.kind || 'mention')
	})
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
	loadGeneration++
	loading = false

	const channelList = document.getElementById('hub-channel-list')
	if (channelList)
		await mountTemplate(channelList, 'hub/nav/side_muted', { i18nKey: 'chat.hub.inbox.sidebarHint' })
	document.getElementById('hub-member-list').replaceChildren()
	document.getElementById('hub-info-card-host').replaceChildren()
	document.getElementById('hub-group-name-display').dataset.i18n = 'chat.hub.inbox.title'

	const messagesHost = document.getElementById('hub-messages')
	await mountTemplate(messagesHost, 'hub/inbox/panel')
	document.getElementById('hub-channel-name-display').dataset.i18n = 'chat.hub.inbox.title'
	const { disableComposer, refreshHubHeaderButtons } = await import('./messages/composerController.mjs')
	disableComposer()
	refreshHubHeaderButtons()

	const listHost = document.getElementById('hub-inbox-list')
	if (listHost && !listHost.dataset.wired) {
		listHost.dataset.wired = '1'
		wireInboxRowClicks(listHost)
	}
	const tablist = messagesHost.querySelector('.hub-inbox-tabs')
	if (tablist) wireInboxTabs(tablist)
	await loadInboxPage()
	try {
		await markInboxSeen()
	}
	catch (error) {
		handleUIError(error, 'chat.hub.inbox.markSeenFailed')
	}
}

/** @returns {boolean} 当前是否为 inbox 模式 */
export function isInboxModeActive() {
	return hubStore.context.currentMode === 'inbox' || window.location.hash.slice(1) === INBOX_HASH
}

/** @returns {void} */
export function closeInboxView() {
	disconnectInfiniteScroll()
	loadGeneration++
	loading = false
	nextCursor = null
}
