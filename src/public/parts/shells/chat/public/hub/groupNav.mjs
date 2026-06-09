/**
 * 【文件】public/hub/groupNav.mjs
 * 【职责】群组内导航：选群/选频道、渲染群信息卡、频道树、成员列表，并持久化列表频道项排序。
 * 【原理】selectGroup 拉取 state、connectGroupWebSocket、syncGroupFromNetwork；selectChannel 更新 hubStore 并 loadMessages；
 *   模板挂载 #hub-group-info、#hub-channel-list、#hub-member-list；导航时 updateHash 同步 URL。
 * 【数据结构】依赖 hubStore.currentGroupId/channelId/currentState；频道树来自 buildChannelTree。
 * 【关联】hashNav、messages、groupStream、serverBar、banners、channels、chat。
 */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { openDialogFromTemplate } from '../../../../scripts/dialog.mjs'
import { i18nElement } from '../../../../scripts/i18n.mjs'
import {
	mountTemplate,
	renderTemplate,
	usingTemplates,
} from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import {
	federationCatchUp,
	rebindFederationRoom,
	getGroupState,
	joinGroup,
	updateChannelListItems,
	createChannel,
} from '../src/api/groupApi.mjs'
import { memberDisplaysAsAdmin } from '../src/memberDisplay.mjs'
import { resolvePowForJoin } from '../src/powJoin.mjs'
import { handleUIError, toError } from '../src/ui/errors.mjs'
import { createFileHandlers } from '../src/ui/groupFileUpload.mjs'

import {
	setPinsBookmarksWrapVisible,
	setSyncBanner,
	updateStatusBanners,
} from './banners.mjs'
import { showChannelContextMenu } from './channelContextMenu.mjs'
import { buildChannelTree, channelTypeIconHtml } from './channels.mjs'
import { authorDisplayLabel, avatarColor, avatarInitial, escapeHtml, warmCharEntityHashCache } from './core/domUtils.mjs'
import { hubStore, setHubState } from './core/state.mjs'
import { consumePendingJoin, inviteCodeFromUrl, updateFriendsHash, updateHash } from './core/urlHash.mjs'
import { resetFilesDrawerWire } from './files.mjs'
import {
	closeGroupWebSocket,
	connectGroupWebSocket,
} from './groupStream.mjs'
import { showMemberContextMenu } from './memberContextMenu.mjs'
import { collectActiveMemberHashes, computeMembersMerkleRoot } from './membersDigest.mjs'
import { clearPinPreviewCache } from './messages/pinPreview.mjs'
import { refreshPinsBookmarks } from './pinsBookmarks.mjs'
import { applyAvatarsTo } from './presence.mjs'
import { clearPrivateGroupState } from './privateGroup.mjs'
import { renderServerBar, loadGroups } from './serverBar.mjs'
import { isThreadChannel } from './threadDrawer.mjs'

/**
 * 后台重绑联邦分区房间；失败写入 debug 日志，不打扰切频道 UX。
 * @param {string} groupId 群 ID
 * @param {{ channelId?: string | null }} [opts] 活跃频道
 * @returns {Promise<void>}
 */
async function rebindFederationRoomQuiet(groupId, opts = {}) {
	if (!groupId) return
	try {
		await rebindFederationRoom(groupId, opts)
	}
	catch (error) {
		const err = toError(error)
		Sentry.captureException(err)
		console.error('hub_federation_rebind', {
			groupId,
			channelId: opts.channelId ?? null,
			error: err.message,
		})
	}
}

/**
 * @returns {boolean} 好友模式下是否处于活跃私聊会话
 */
export function isPrivateChatActive() {
	return hubStore.currentMode === 'friends' && !!hubStore.privateGroup.groupId
}

/**
 * @returns {HTMLElement | null} 频道列表挂载容器
 */
function getChannelListContainer() {
	if (isPrivateChatActive()) {
		const host = document.getElementById('hub-private-channel-list-host')
		if (host) return host
	}
	return document.getElementById('hub-channel-list')
}

/**
 * 渲染 Hub 侧栏频道区（群模式直出列表；私聊模式含返回按钮与话题列表）。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderHubChannelSidebar(state) {
	if (isPrivateChatActive()) {
		const root = document.getElementById('hub-channel-list')
		await mountTemplate(root, 'hub/nav/private_chat_sidebar_shell', {})
		root.querySelector('#hub-private-chat-back')?.addEventListener('click', () => {
			void backToFriendsList()
		})
		i18nElement(root)
	}
	await renderChannelList(state)
}

/**
 * 从私聊返回好友列表 idle 视图。
 * @returns {Promise<void>}
 */
export async function backToFriendsList() {
	const { cancelScheduledChannelRefresh, disableComposer, refreshHubHeaderButtons } = await import('./messages/messages.mjs')
	const { loadFriendsList, renderFriendsColumn } = await import('./friendsList.mjs')
	cancelScheduledChannelRefresh()
	closeGroupWebSocket()
	clearPrivateGroupState()
	setHubState('currentGroupId', null)
	setHubState('currentChannelId', null)
	setHubState('currentState', null)
	updateFriendsHash()
	disableComposer('chat.hub.composerDisabled')
	await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/idle', {
		iconHtml: '<img src="https://api.iconify.design/mdi/account-group-outline.svg" class="hub-empty-icon-img" width="48" height="48" alt="" aria-hidden="true" />',
	})
	const groupNameEl = document.getElementById('hub-group-name-display')
	if (groupNameEl) {
		groupNameEl.textContent = ''
		groupNameEl.dataset.i18n = 'chat.hub.friendsTag'
		i18nElement(groupNameEl)
	}
	const channelTitle = document.getElementById('hub-channel-name-display')
	if (channelTitle) {
		channelTitle.textContent = ''
		channelTitle.dataset.i18n = 'chat.hub.friendsHeader'
		i18nElement(channelTitle)
	}
	document.getElementById('hub-info-card-host').innerHTML = ''
	await renderFriendsColumn(await loadFriendsList())
	refreshHubHeaderButtons()
	updateStatusBanners()
}

/**
 * 渲染右侧群组信息卡。
 * @param {object} state 群组状态
 * @returns {void}
 */
export async function renderGroupInfoCard(state) {
	const host = document.getElementById('hub-info-card-host')
	const meta = state?.groupMeta || {}
	const displayName = meta.name || ''
	const description = meta.description ?? ''
	await mountTemplate(host, 'hub/nav/info_card', {
		avatarColor: avatarColor(displayName || '?'),
		avatarInitial: escapeHtml(avatarInitial(displayName || '?')),
		groupName: escapeHtml(displayName),
		nameI18nAttr: displayName ? '' : ' data-i18n="chat.hub.groupTag"',
		description: escapeHtml(description),
		descriptionI18nAttr: description ? '' : ' data-i18n="chat.hub.groupDescriptionEmpty"',
	})
}

/**
 * 渲染频道树列表。
 * @param {object} state 群组状态
 * @returns {void}
 */
export async function renderChannelList(state) {
	const container = getChannelListContainer()
	if (!container) return
	const channels = state.channels || {}
	const channelIds = Object.keys(channels)
	if (!channelIds.length) {
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noChannels' })
		return
	}
	const { ordered } = buildChannelTree(channels)
	const visible = ordered.filter(({ channel }) => !isThreadChannel(channel))
	const groupsByCat = {}
	for (const { id, channel, depth } of visible) {
		const category = channel.category || ''
		const categoryI18n = channel.category ? '' : 'chat.hub.defaultCategory'
		const catKey = category || '__default__'
		if (!groupsByCat[catKey]) groupsByCat[catKey] = { category, categoryI18n, channels: [] }
		groupsByCat[catKey].channels.push({ id, depth, ...channel })
	}
	container.replaceChildren()
	for (const catKey of Object.keys(groupsByCat)) {
		const { category, categoryI18n, channels } = groupsByCat[catKey]
		const isCollapsed = hubStore.collapsedCategories.has(catKey)
		container.appendChild(await renderTemplate('hub/nav/channel_category', {
			collapsedClass: isCollapsed ? 'collapsed' : '',
			category: escapeHtml(catKey),
			categoryName: escapeHtml(category),
			categoryI18nAttr: categoryI18n ? ` data-i18n="${categoryI18n}"` : '',
		}))
		if (!isCollapsed) {
			const listHost = container.querySelector(`.hub-category[data-cat="${CSS.escape(catKey)}"] + .hub-category-channels`)
			for (const channel of channels) {
				const active = channel.id === hubStore.currentChannelId ? 'active' : ''
				const nested = channel.depth > 0 ? ' hub-channel-nested' : ''
				listHost.appendChild(await renderTemplate('hub/nav/channel_item', {
					activeClass: active ? 'active' : '',
					nestedClass: nested,
					channelId: channel.id,
					paddingLeft: String(12 + channel.depth * 14),
					iconHtml: await channelTypeIconHtml(channel.type || 'text'),
					channelName: escapeHtml(channel.name || channel.id),
				}))
			}
		}
	}
	container.querySelectorAll('.hub-category').forEach(el => {
		el.addEventListener('click', () => {
			const category = el.dataset.cat
			if (hubStore.collapsedCategories.has(category)) hubStore.collapsedCategories.delete(category)
			else hubStore.collapsedCategories.add(category)
			void renderHubChannelSidebar(hubStore.currentState)
		})
	})
	container.querySelectorAll('.hub-channel-item').forEach(el => {
		el.addEventListener('click', () => selectChannel(el.dataset.channelId))
		el.addEventListener('contextmenu', (event) => {
			const { channelId } = el.dataset
			if (channelId) void showChannelContextMenu(event, channelId)
		})
	})

	const canManageChannels = Object.values(hubStore.currentState?.channelCaps || {})
		.some(cap => cap?.canEditList)
	if (canManageChannels && hubStore.currentGroupId) {
		const addChannelButton = document.createElement('button')
		addChannelButton.type = 'button'
		addChannelButton.className = 'btn btn-ghost btn-sm w-[calc(100%-8px)] mx-1 mt-1 hub-channel-create-button'
		addChannelButton.dataset.i18n = 'chat.hub.newChannelBtn'
		addChannelButton.addEventListener('click', () => void showCreateChannelModal())
		container.appendChild(addChannelButton)
	}
}

/**
 * 弹出新建频道对话框。
 * @returns {Promise<void>}
 */
async function showCreateChannelModal() {
	const groupId = hubStore.currentGroupId
	if (!groupId) return
	usingTemplates('/parts/shells:chat/src/templates')
	await openDialogFromTemplate('channel_create_modal', {}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			/** @returns {void} */
			const close = () => dialog.close()
			dialog.querySelector('#new-channel-cancel')?.addEventListener('click', close)
			dialog.querySelector('#new-channel-create')?.addEventListener('click', async () => {
				const name = dialog.querySelector('#new-channel-name')?.value?.trim()
				const type = dialog.querySelector('#new-channel-type')?.value || 'text'
				if (!name) return
				try {
					const channelId = await createChannel(groupId, name, type)
					close()
					setHubState('currentState', await getGroupState(groupId))
					await renderHubChannelSidebar(hubStore.currentState)
					await selectChannel(channelId)
					showToastI18n('success', 'chat.hub.newChannelSuccess')
				}
				catch (error) {
					showToastI18n('error', 'chat.hub.newChannelFailed', { error: error.message })
				}
			})
		},
	})
}

/**
 * 从联邦网络拉取群组事件并刷新当前频道消息。
 * @param {string} groupId 群组 ID
 * @param {string} [channelId] 限定同步的频道
 * @returns {Promise<void>}
 */
async function syncGroupFromNetwork(groupId) {
	setSyncBanner(true)
	let catchupOk = true
	let catchupError = ''
	/** @type {{ wantIds: number, eventsFilled: number, wantIdsStillMissing: number, wantIdsRateLimited: boolean }} */
	let catchup = {
		wantIds: 0,
		eventsFilled: 0,
		wantIdsStillMissing: 0,
		wantIdsRateLimited: false,
	}
	try {
		catchup = await federationCatchUp(groupId, { waitMs: 1400 })
	}
	catch (error) {
		catchupOk = false
		catchupError = handleUIError(error, 'chat.hub.syncFailed').message
		setSyncBanner(true, { i18nKey: 'chat.hub.syncFailed', params: { error: catchupError } })
	}

	if (catchupOk)
		if (catchup.wantIdsRateLimited)
			setSyncBanner(true, { i18nKey: 'chat.hub.syncRateLimited' })
		else if (catchup.wantIds > 0) {
			const stillMissing = Number(catchup.wantIdsStillMissing) || 0
			const filled = Math.max(0, catchup.wantIds - stillMissing)
			setSyncBanner(true, { i18nKey: 'chat.hub.syncProgress', params: { filled, total: catchup.wantIds } })
		}


	if (hubStore.currentGroupId === groupId && hubStore.currentChannelId) {
		setHubState('currentState', await getGroupState(groupId))
		const { loadMessages } = await import('./messages/messages.mjs')
		await loadMessages()
	}
	if (catchupOk) {
		const stillMissing = Number(catchup.wantIdsStillMissing) || 0
		if (stillMissing > 0)
			setSyncBanner(true, {
				i18nKey: 'chat.hub.syncIncomplete',
				params: { missing: stillMissing, total: catchup.wantIds },
			})
		else if (!catchup.wantIdsRateLimited && !(catchup.wantIds > 0))
			setSyncBanner(false)
	}
}

/**
 * 切换当前频道并加载消息、连接 WebSocket。
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function selectChannel(channelId) {
	const { disableComposer, enableComposer, loadMessages } = await import('./messages/messages.mjs')
	setHubState('currentChannelId', channelId)
	if (isPrivateChatActive())
		hubStore.privateGroup.channelId = channelId
	updateHash(hubStore.currentGroupId, channelId)
	void warmCharEntityHashCache()
	await renderHubChannelSidebar(hubStore.currentState)
	const channel = hubStore.currentState?.channels?.[channelId]
	if (hubStore.currentGroupId)
		rebindFederationRoomQuiet(hubStore.currentGroupId, { channelId })
	const channelType = channel?.type || 'text'
	document.getElementById('hub-channel-name-display').textContent = channel?.name || channelId
	const headerIcon = document.querySelector('.hub-main-header-icon')
	if (headerIcon)
		headerIcon.innerHTML = await channelTypeIconHtml(channelType)

	if (channelType === 'list' || channelType === 'streaming')
		disableComposer(channelType === 'list' ? 'chat.hub.channelReadonlyList' : 'chat.hub.channelReadonlyStream')
	else
		enableComposer()
	hubStore.fileHandlers = createFileHandlers({
		groupId: hubStore.currentGroupId,
		showToastI18n,
		/** @returns {Promise<void>} */
		loadMessages: () => loadMessages(),
		/** @returns {string | null} 当前频道 ID（文件上传权限） */
		getUploadChannelId: () => hubStore.currentChannelId,
		/** @returns {object | null} 当前群 state（读取文件加密模式） */
		getCurrentState: () => hubStore.currentState,
	})
	await loadMessages()
	if (hubStore.currentGroupId && hubStore.currentChannelId && channelType === 'text')
		connectGroupWebSocket(hubStore.currentGroupId, hubStore.currentChannelId)
	updateStatusBanners()
	void refreshPinsBookmarks()
}

/**
 * 渲染成员列表侧栏。
 * @param {object} state 群组状态
 * @returns {void}
 */
export async function renderMemberList(state) {
	const container = document.getElementById('hub-member-list')
	const members = state.members || []
	if (!members.length) {
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noMembers' })
		return
	}
	const roleDefs = state.roles || {}
	const admins = members.filter(member => memberDisplaysAsAdmin(member, roleDefs))
	const others = members.filter(member => !memberDisplaysAsAdmin(member, roleDefs))
	/**
	 * @param {string} titleKey i18n 分组标题键
	 * @param {object[]} list 成员列表
	 * @returns {Promise<void>}
	 */
	const appendMemberGroup = async (titleKey, list) => {
		if (!list.length) return
		container.appendChild(await renderTemplate('hub/nav/member_group', {
			titleKey,
			count: String(list.length),
		}))
		const listHost = container.querySelector('.hub-member-group-list:last-of-type')
		for (const member of list) {
			const memberKey = String(member.memberKey || member.agentEntityHash || member.pubKeyHash || '').trim()
			const isAgent = member.memberKind === 'agent'
			const displayName = String(member.displayName || '').trim()
				|| (isAgent ? member.charname : '')
				|| authorDisplayLabel(member.entityHash || memberKey)
			const viewerHash = String(hubStore.currentState?.viewerMemberPubKeyHash || '').toLowerCase()
			const avatarFor = member.entityHash
				|| (viewerHash && member.pubKeyHash?.toLowerCase() === viewerHash ? hubStore.viewerEntityHash : '')
				|| ''
			const entityHash = member.entityHash
				|| (viewerHash && member.pubKeyHash?.toLowerCase() === viewerHash ? hubStore.viewerEntityHash : '')
				|| ''
			const isAdmin = memberDisplaysAsAdmin(member, roleDefs)
			const ownerAttr = isAgent && member.ownerPubKeyHash
				? ` data-owner-pub-key-hash="${escapeHtml(member.ownerPubKeyHash)}"`
				: ''
			listHost.appendChild(await renderTemplate('hub/nav/member_item', {
				adminClass: isAdmin ? ' is-admin' : '',
				charClass: isAgent ? ' hub-member-item-char' : '',
				charIdAttr: '',
				memberKindAttr: ` data-member-kind="${isAgent ? 'agent' : 'user'}"${ownerAttr}`,
				username: escapeHtml(displayName),
				avatarFor: escapeHtml(avatarFor),
				memberKey: escapeHtml(memberKey),
				entityHash: escapeHtml(entityHash),
				avatarColor: avatarColor(displayName),
				avatarInitial: escapeHtml(avatarInitial(displayName)),
			}))
		}
	}
	container.replaceChildren()
	await appendMemberGroup('chat.hub.adminSection', admins)
	await appendMemberGroup('chat.hub.memberSection', others)
	container.querySelectorAll('.hub-member-item').forEach(el => {
		el.addEventListener('contextmenu', (event) => {
			void showMemberContextMenu(event, el)
		})
	})
	applyAvatarsTo(container)
	void refreshMemberDigestBar(state)
}

/**
 * 更新成员 Merkle 摘要校验条。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
async function refreshMemberDigestBar(state) {
	const el = document.getElementById('hub-member-digest')
	if (!el || !hubStore.currentGroupId) return
	const expected = state?.membersRoot ?? null
	if (!expected) {
		el.innerHTML = ''
		el.setAttribute('hidden', '')
		return
	}
	el.removeAttribute('hidden')
	el.className = 'hub-member-digest'
	el.replaceChildren()
	const pending = document.createElement('span')
	pending.dataset.i18n = 'chat.hub.membersDigestPending'
	el.appendChild(pending)
	i18nElement(el)
	const keys = collectActiveMemberHashes(state)
	const local = keys.length ? await computeMembersMerkleRoot(keys) : null
	const ok = local === expected
	const short = `${expected.slice(0, 8)}…${expected.slice(-8)}`
	const pages = Math.max(1, Number(state.membersPagesCount) || 1)
	el.className = ok ? 'hub-member-digest is-ok' : 'hub-member-digest is-warn'
	if (pages > 1) {
		const { geti18n } = await import('../../../../scripts/i18n.mjs')
		el.title = await geti18n('chat.hub.membersDigestPagesTitle', { expected, pages: String(pages) })
	}
	else el.title = expected
	el.replaceChildren()
	const row = document.createElement('div')
	row.className = 'hub-member-digest-row'
	const viewerEh = hubStore.viewerEntityHash
	if (viewerEh) {
		const copyBtn = document.createElement('button')
		copyBtn.type = 'button'
		copyBtn.className = 'hub-member-digest-copy'
		copyBtn.dataset.i18n = 'chat.hub.copyEntityId'
		copyBtn.title = viewerEh
		copyBtn.addEventListener('click', async (clickEvent) => {
			clickEvent.stopPropagation()
			await navigator.clipboard.writeText(viewerEh)
			showToastI18n('success', 'chat.hub.copyEntityIdOk')
		})
		row.appendChild(copyBtn)
	}
	const label = document.createElement('span')
	label.className = 'hub-member-digest-label'
	label.dataset.root = short
	label.dataset.pages = String(pages)
	label.dataset.i18n = ok
		? pages > 1 ? 'chat.hub.membersDigestOkPaged' : 'chat.hub.membersDigestOk'
		: 'chat.hub.membersDigestMismatch'
	row.appendChild(label)
	el.appendChild(row)
	i18nElement(el)
}

/**
 * 选中群组：入群、同步、渲染频道/成员并进入默认频道。
 * @param {string} groupId 群组 ID
 * @param {string | null} [presetChannelId] URL 或深链指定的频道
 * @returns {Promise<void>}
 */
export async function selectGroup(groupId, presetChannelId = null) {
	if (!groupId) return
	await loadGroups()
	clearPinPreviewCache()
	clearPrivateGroupState()
	resetFilesDrawerWire()
	closeGroupWebSocket()
	const { cancelScheduledChannelRefresh } = await import('./messages/messages.mjs')
	cancelScheduledChannelRefresh()
	setHubState('currentGroupId', groupId)
	updateHash(groupId, presetChannelId)
	void renderServerBar()
	try {
		let state = await getGroupState(groupId)
		if (!state.isMember) {
			const pendingJoin = consumePendingJoin(groupId)
			const inviteCode = pendingJoin.inviteCode || inviteCodeFromUrl()
			const pow = await resolvePowForJoin(groupId, state)
			await joinGroup(groupId, inviteCode, null, pow, pendingJoin.fedBootstrap)
			state = await getGroupState(groupId)
			await loadGroups()
		}
		setHubState('currentState', state)
		rebindFederationRoomQuiet(groupId, {
			channelId: presetChannelId || state.groupSettings?.defaultChannelId || null,
		})
		void warmCharEntityHashCache()
		if (state.viewerEntityHash)
			hubStore.viewerEntityHash = state.viewerEntityHash
		const { refreshViewerHubPresentation } = await import('./init.mjs')
		await refreshViewerHubPresentation()
		if (state.viewerEntityHash) {
			const { syncViewerPresence } = await import('./hubStatus.mjs')
			await syncViewerPresence(state.viewerEntityHash)
		}
		void syncGroupFromNetwork(groupId)
		const groupNameEl = document.getElementById('hub-group-name-display')
		if (groupNameEl)
			if (state.groupMeta.name) {
				delete groupNameEl.dataset.i18n
				groupNameEl.textContent = state.groupMeta.name
			}
			else {
				groupNameEl.textContent = ''
				groupNameEl.dataset.i18n = 'chat.hub.groupTag'
			}

		await renderChannelList(state)
		await renderMemberList(state)
		hubStore.currentMode = 'groups'
		document.querySelectorAll('.hub-server-item[data-mode]').forEach(el => {
			el.classList.toggle('mode-active', el.dataset.mode === 'groups')
		})
		await renderGroupInfoCard(state)
		void import('./messages/messages.mjs').then(({ refreshHubHeaderButtons }) => refreshHubHeaderButtons())
		updateStatusBanners()
		const channelIds = Object.keys(state.channels || {})
		const targetChannelId = presetChannelId && state.channels?.[presetChannelId]
			? presetChannelId
			: state.groupSettings?.defaultChannelId || channelIds[0] || null
		if (targetChannelId) await selectChannel(targetChannelId)
		else {
			setHubState('currentChannelId', null)
			updateHash(hubStore.currentGroupId, null)
			const { disableComposer } = await import('./messages/messages.mjs')
			disableComposer('chat.hub.noChannel')
			updateStatusBanners()
			void refreshPinsBookmarks()
		}
	}
	catch (error) {
		setPinsBookmarksWrapVisible(false)
		updateStatusBanners()
		const err = handleUIError(error, 'chat.hub.loadGroupFailed')
		const host = document.getElementById('hub-messages')
		if (host) {
			const { mountTemplate } = await import('../../../../scripts/template.mjs')
			const { escapeHtml } = await import('./core/domUtils.mjs')
			await mountTemplate(host, 'hub/empty/error', {
				i18nKey: 'chat.hub.loadGroupFailed',
				errorMessage: err.message,
				escapeHtml,
			})
		}
	}
}

/**
 * 保存 list 类型频道条目。
 * @param {object[]} items 列表频道条目
 * @returns {Promise<void>}
 */
export async function saveListChannelItems(items) {
	await updateChannelListItems(hubStore.currentGroupId, hubStore.currentChannelId, items)
	setHubState('currentState', await getGroupState(hubStore.currentGroupId))
}

/**
 * 导航至群组设置页（整页，非 Hub 内 modal）。
 * @param {string} groupId 群组 ID
 * @returns {void}
 */
export function navigateToGroupSettings(groupId) {
	window.location.href = `/parts/shells:chat/settings/#settings:${encodeURIComponent(groupId)}`
}
