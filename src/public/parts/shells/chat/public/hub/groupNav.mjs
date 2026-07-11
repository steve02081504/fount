/**
 * 【文件】public/hub/groupNav.mjs
 * 【职责】群组内导航：选群/选频道、渲染群信息卡、频道树、成员列表，并持久化列表频道项排序。
 * 【原理】selectGroup 拉取 state、connectGroupWebSocket、syncGroupFromNetwork；selectChannel 更新 hubStore 并 loadMessages；
 *   模板挂载 #hub-group-info、#hub-channel-list、#hub-member-list；导航时 updateHash 同步 URL。
 * 【数据结构】依赖 hubStore.context.currentGroupId/channelId/currentState；频道树来自 buildChannelTree。
 * 【关联】hashNav、messages、groupStream、serverBar、banners、channels、chat。
 */
import { openDialogFromTemplate } from '../../../../scripts/features/dialog.mjs'
import {
	mountTemplate,
	renderTemplate,
	usingTemplates,
} from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import {
	federationCatchUp,
	rebindFederationRoom,
	getGroupState,
	joinGroup,
	updateChannelListItems,
	createChannel,
} from '../src/api/groupApi.mjs'
import { notifyHubGroupJoined } from '../src/hubBroadcast.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
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
import { authorDisplayLabel, avatarColor, avatarInitial, avatarTextColor, warmCharEntityHashCache } from './core/domUtils.mjs'
import { hubStore, setHubState } from './core/state.mjs'
import { consumePendingJoin, inviteCodeFromUrl, parseHash, updateFriendsHash, updateHash } from './core/urlHash.mjs'
import { resetFilesDrawerWire } from './files.mjs'
import {
	closeGroupWebSocket,
	connectGroupWebSocket,
} from './groupStream.mjs'
import { showMemberContextMenu } from './memberContextMenu.mjs'
import { collectActiveMemberHashes, computeMembersMerkleRoot } from './membersDigest.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import { clearPinPreviewCache } from './messages/pinPreview.mjs'
import { isHubMemberPersonallyFiltered, loadHubPersonalFilter } from './personalFilter.mjs'
import { refreshPinsBookmarks } from './pinsBookmarks.mjs'
import { applyAvatarsTo } from './presence.mjs'
import { clearPrivateGroupState } from './privateGroup.mjs'
import { loadGroups } from './serverBar.mjs'
import { isThreadChannel } from './threadDrawer.mjs'
import { formatUnreadBadgeHtml, getChannelUnreadCount } from './unread.mjs'

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
		import('https://esm.sh/@sentry/browser')
			.then(Sentry => Sentry.captureException(err))
			.catch(() => { })
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
	return hubStore.context.currentMode === 'friends' && !!hubStore.privateGroup.groupId
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
	}
	await renderChannelList(state)
}

/**
 * 从私聊返回好友列表 idle 视图。
 * @returns {Promise<void>}
 */
export async function backToFriendsList() {
	cancelScheduledChannelRefresh()
	const { disableComposer, refreshHubHeaderButtons } = await import('./messages/composerController.mjs')
	const { loadFriendsList, renderFriendsColumn } = await import('./friendsList.mjs')
	closeGroupWebSocket()
	clearPrivateGroupState()
	setHubState('context.currentGroupId', null)
	setHubState('context.currentChannelId', null)
	setHubState('context.currentState', null)
	updateFriendsHash()
	disableComposer('chat.hub.composerDisabled')
	await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/idle', {
		iconHtml: '<img src="https://api.iconify.design/mdi/account-group-outline.svg" class="hub-empty-icon-img" width="48" height="48" alt="" aria-hidden="true" />',
	})
	document.getElementById('hub-channel-name-display').dataset.i18n = 'chat.hub.friendsHeader'
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
		avatarColor: avatarColor(hubStore.context.currentGroupId || displayName || '?'),
		avatarTextColor: avatarTextColor(hubStore.context.currentGroupId || displayName || '?'),
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
		const isCollapsed = hubStore.sidebar.collapsedCategories.has(catKey)
		container.appendChild(await renderTemplate('hub/nav/channel_category', {
			collapsedClass: isCollapsed ? 'collapsed' : '',
			category: escapeHtml(catKey),
			categoryName: escapeHtml(category),
			categoryI18nAttr: categoryI18n ? ` data-i18n="${categoryI18n}"` : '',
		}))
		if (!isCollapsed) {
			const listHost = container.querySelector(`.hub-category[data-cat="${CSS.escape(catKey)}"] + .hub-category-channels`)
			const sortedChannels = [...channels].sort((left, right) => {
				const leftSeq = Number(state.channels?.[left.id]?.messageSeq) || 0
				const rightSeq = Number(state.channels?.[right.id]?.messageSeq) || 0
				return rightSeq - leftSeq
			})
			for (const channel of sortedChannels) {
				const active = channel.id === hubStore.context.currentChannelId ? 'active' : ''
				const nested = channel.depth > 0 ? ' hub-channel-nested' : ''
				const groupId = hubStore.context.currentGroupId
				listHost.appendChild(await renderTemplate('hub/nav/channel_item', {
					activeClass: active ? 'active' : '',
					nestedClass: nested,
					channelId: channel.id,
					paddingLeft: String(12 + channel.depth * 14),
					iconHtml: await channelTypeIconHtml(channel.type || 'text'),
					channelName: escapeHtml(channel.name || channel.id),
					unreadBadgeHtml: groupId
						? formatUnreadBadgeHtml(getChannelUnreadCount(groupId, channel.id))
						: '',
				}))
			}
		}
	}
	container.querySelectorAll('.hub-category').forEach(el => {
		el.addEventListener('click', () => {
			const category = el.dataset.cat
			if (hubStore.sidebar.collapsedCategories.has(category)) hubStore.sidebar.collapsedCategories.delete(category)
			else hubStore.sidebar.collapsedCategories.add(category)
			void renderHubChannelSidebar(hubStore.context.currentState)
		})
	})
	container.querySelectorAll('.hub-channel-item').forEach(el => {
		el.addEventListener('click', () => selectChannel(el.dataset.channelId))
		el.addEventListener('contextmenu', (event) => {
			const { channelId } = el.dataset
			if (channelId) void showChannelContextMenu(event, channelId)
		})
	})

	const canManageChannels = Object.values(hubStore.context.currentState?.channelCaps || {})
		.some(cap => cap?.canEditList)
	if (canManageChannels && hubStore.context.currentGroupId) {
		const addChannelButton = document.createElement('button')
		addChannelButton.type = 'button'
		addChannelButton.className = 'btn btn-ghost btn-sm w-[calc(100%-8px)] mx-1 mt-1 hub-channel-create-button'
		addChannelButton.dataset.i18n = 'chat.hub.newChannelButton'
		addChannelButton.addEventListener('click', () => void showCreateChannelModal())
		container.appendChild(addChannelButton)
	}
}

/**
 * 弹出新建频道对话框。
 * @returns {Promise<void>}
 */
async function showCreateChannelModal() {
	const groupId = hubStore.context.currentGroupId
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
					setHubState('context.currentState', await getGroupState(groupId))
					await renderHubChannelSidebar(hubStore.context.currentState)
					await selectChannel(channelId)
					showToastI18n('success', 'chat.hub.newChannelSuccess')
				}
				catch (error) {
					handleUIError(error, 'chat.hub.newChannelFailed')
				}
			})
		},
	})
}

/**
 * 从联邦网络拉取群组事件并刷新当前频道消息。
 * @param {string} groupId 群组 ID
 * @param {{ waitMs?: number }} [opts] catch-up 等待毫秒数
 * @returns {Promise<void>}
 */
async function syncGroupFromNetwork(groupId, opts = {}) {
	setSyncBanner(true)
	/** @type {{ federationActive?: boolean, wantIds: number, eventsFilled: number, wantIdsStillMissing: number, wantIdsRateLimited: boolean, tipsCollected?: number }} */
	let catchup
	try {
		catchup = await federationCatchUp(groupId, { waitMs: opts.waitMs ?? 1400 })
	}
	catch (error) {
		const catchupError = handleUIError(error, 'chat.hub.syncFailed').message
		setSyncBanner(true, { i18nKey: 'chat.hub.syncFailed', params: { error: catchupError } })
		return
	}

	if (hubStore.context.currentGroupId === groupId && hubStore.context.currentChannelId) {
		setHubState('context.currentState', await getGroupState(groupId))
		const { loadMessages } = await import('./messages/messages.mjs')
		await loadMessages()
	}

	if (!catchup.federationActive) {
		setSyncBanner(false)
		return
	}
	const stillMissing = Number(catchup.wantIdsStillMissing) || 0
	const tipsCollected = Number(catchup.tipsCollected) || 0
	if (catchup.wantIdsRateLimited)
		setSyncBanner(true, { i18nKey: 'chat.hub.syncRateLimited' })
	else if (stillMissing > 0)
		setSyncBanner(true, {
			i18nKey: 'chat.hub.syncIncomplete',
			params: { missing: stillMissing, total: catchup.wantIds },
		})
	else if (tipsCollected === 0 && !catchup.wantIds && !catchup.eventsFilled)
		setSyncBanner(true, { i18nKey: 'chat.hub.syncNoPeers' })
	else
		setSyncBanner(false)
}

/**
 * 切换当前频道并加载消息、连接 WebSocket。
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function selectChannel(channelId) {
	const { disableComposer, enableComposer } = await import('./messages/composerController.mjs')
	const channel = hubStore.context.currentState?.channels?.[channelId]
	if (!channel) {
		setHubState('context.currentChannelId', null)
		updateHash(hubStore.context.currentGroupId, null)
		disableComposer('chat.hub.noChannel')
		await renderHubChannelSidebar(hubStore.context.currentState)
		const { mountTemplate } = await import('../../../../scripts/features/template.mjs')
		await mountTemplate(document.getElementById('hub-messages'), 'hub/nav/side_muted', {
			i18nKey: 'chat.hub.noChannels',
		})
		updateStatusBanners()
		return
	}
	setHubState('context.currentChannelId', channelId)
	if (isPrivateChatActive())
		hubStore.privateGroup.channelId = channelId
	updateHash(hubStore.context.currentGroupId, channelId)
	void warmCharEntityHashCache()
	await renderHubChannelSidebar(hubStore.context.currentState)
	if (hubStore.context.currentGroupId)
		rebindFederationRoomQuiet(hubStore.context.currentGroupId, { channelId })
	const channelType = channel.type || 'text'
	document.getElementById('hub-channel-name-display').textContent = channel.name || channelId
	const headerIcon = document.querySelector('.hub-main-header-icon')
	headerIcon.innerHTML = await channelTypeIconHtml(channelType)

	if (channelType === 'list' || channelType === 'streaming')
		disableComposer(channelType === 'list' ? 'chat.hub.channelReadonlyList' : 'chat.hub.channelReadonlyStream')
	else if (hubStore.context.currentState?.suspectedRemoved)
		disableComposer('chat.hub.banners.suspectedRemovedComposer')
	else
		enableComposer()
	const { loadMessages } = await import('./messages/messages.mjs')
	hubStore.context.fileHandlers = createFileHandlers({
		groupId: hubStore.context.currentGroupId,
		showToastI18n,
		/** @returns {Promise<void>} */
		loadMessages: () => loadMessages(),
		/** @returns {string | null} 当前频道 ID（文件上传权限） */
		getUploadChannelId: () => hubStore.context.currentChannelId,
		/** @returns {object | null} 当前群 state（读取文件加密模式） */
		getCurrentState: () => hubStore.context.currentState,
	})
	await loadMessages()
	if (hubStore.context.currentGroupId && hubStore.context.currentChannelId && channelType === 'text')
		connectGroupWebSocket(hubStore.context.currentGroupId, hubStore.context.currentChannelId)
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
	await loadHubPersonalFilter()
	const members = (state.members || []).filter(member => {
		const memberKey = String(member.memberKey || member.agentEntityHash || member.pubKeyHash || '').trim()
		const entityHash = member.entityHash
			|| (String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').toLowerCase() === memberKey.toLowerCase()
				? hubStore.viewer.viewerEntityHash
				: '')
		return !isHubMemberPersonallyFiltered(entityHash, memberKey)
	})
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
			const viewerHash = String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').toLowerCase()
			const avatarFor = member.entityHash
				|| (viewerHash && member.pubKeyHash?.toLowerCase() === viewerHash ? hubStore.viewer.viewerEntityHash : '')
				|| ''
			const entityHash = member.entityHash
				|| (viewerHash && member.pubKeyHash?.toLowerCase() === viewerHash ? hubStore.viewer.viewerEntityHash : '')
				|| ''
			const isAdmin = memberDisplaysAsAdmin(member, roleDefs)
			const ownerAttr = isAgent && member.ownerPubKeyHash
				? ` data-owner-pub-key-hash="${escapeHtml(member.ownerPubKeyHash)}"`
				: ''
			const avatarSeed = entityHash || memberKey || (isAgent ? member.charname : '') || displayName
			listHost.appendChild(await renderTemplate('hub/nav/member_item', {
				adminClass: isAdmin ? ' is-admin' : '',
				charClass: isAgent ? ' hub-member-item-char' : '',
				charIdAttr: '',
				memberKindAttr: ` data-member-kind="${isAgent ? 'agent' : 'user'}"${ownerAttr}`,
				username: escapeHtml(displayName),
				avatarFor: escapeHtml(avatarFor),
				memberKey: escapeHtml(memberKey),
				entityHash: escapeHtml(entityHash),
				avatarColor: avatarColor(avatarSeed),
				avatarTextColor: avatarTextColor(avatarSeed),
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
	if (!hubStore.context.currentGroupId) return
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
	const keys = collectActiveMemberHashes(state)
	const local = keys.length ? await computeMembersMerkleRoot(keys) : null
	const ok = local === expected
	const short = `${expected.slice(0, 8)}…${expected.slice(-8)}`
	const pages = Math.max(1, Number(state.membersPagesCount) || 1)
	el.className = ok ? 'hub-member-digest is-ok' : 'hub-member-digest is-warn'
	if (pages > 1) {
		const { geti18n } = await import('../../../../scripts/i18n/index.mjs')
		el.title = await geti18n('chat.hub.membersDigestPagesTitle', { expected, pages: String(pages) })
	}
	else el.title = expected
	el.replaceChildren()
	const row = document.createElement('div')
	row.className = 'hub-member-digest-row'
	const viewerEh = hubStore.viewer.viewerEntityHash
	if (viewerEh) {
		const copyButton = document.createElement('button')
		copyButton.type = 'button'
		copyButton.className = 'hub-member-digest-copy'
		copyButton.dataset.i18n = 'chat.hub.copyEntityId'
		copyButton.title = viewerEh
		copyButton.addEventListener('click', async (clickEvent) => {
			clickEvent.stopPropagation()
			await navigator.clipboard.writeText(viewerEh)
			showToastI18n('success', 'chat.hub.copyEntityIdOk')
		})
		row.appendChild(copyButton)
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
}

/**
 * 是否允许在导航时自动入群（需有本地 replica、邀请码或联邦 bootstrap）。
 * @param {object} state 群状态
 * @param {{ inviteCode?: string | null, fedBootstrap?: object | null }} pendingJoin session 待消费邀请
 * @param {string | null} inviteCode URL 或 pending 邀请码
 * @returns {boolean} 是否应自动尝试入群
 */
function canAutoJoinGroup(state, pendingJoin, inviteCode) {
	if (state.isMember) return false
	if (state.hasLocalReplica) return true
	if (inviteCode) return true
	if (pendingJoin.fedBootstrap) return true
	return false
}

/**
 * 渲染无法入群时的 Hub 主区空态。
 * @returns {Promise<void>}
 */
async function showGroupJoinRequiredState() {
	const { disableComposer } = await import('./messages/composerController.mjs')
	const { mountTemplate } = await import('../../../../scripts/features/template.mjs')
	setHubState('context.currentChannelId', null)
	updateHash(hubStore.context.currentGroupId, null)
	disableComposer('chat.hub.noChannel')
	await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/error', {
		i18nKey: 'chat.hub.groupJoinRequired',
		errorMessage: '',
	})
	setPinsBookmarksWrapVisible(false)
	updateStatusBanners()
}

/**
 * 入群或返回需手动入群的空态。
 * @param {string} groupId 群 ID
 * @param {object} state 群状态
 * @returns {Promise<object | null>} 入群后的 state；需手动入群时 null
 */
async function ensureGroupMembership(groupId, state) {
	if (state.isMember) return state
	const pendingJoin = consumePendingJoin(groupId)
	const inviteCode = pendingJoin.inviteCode || inviteCodeFromUrl()
	if (!canAutoJoinGroup(state, pendingJoin, inviteCode)) {
		setHubState('context.currentState', state)
		hubStore.context.currentMode = 'groups'
		document.querySelectorAll('.hub-server-item[data-mode]').forEach(el => {
			el.classList.toggle('mode-active', el.dataset.mode === 'groups')
		})
		const groupNameElement = document.getElementById('hub-group-name-display')
		groupNameElement.textContent = ''
		groupNameElement.dataset.i18n = 'chat.hub.groupTag'
		await renderChannelList(state)
		await renderMemberList(state)
		await renderGroupInfoCard(state)
		await showGroupJoinRequiredState()
		return null
	}
	const pow = await resolvePowForJoin(groupId, state, hubStore.viewer.nodeHash || '')
	await joinGroup(groupId, inviteCode, null, pow, pendingJoin.fedBootstrap)
	const joined = await getGroupState(groupId)
	notifyHubGroupJoined(groupId)
	await loadGroups()
	return joined
}

/**
 * 同步群状态并刷新 viewer 展示。
 * @param {string} groupId 群 ID
 * @param {object} state 当前 state
 * @param {string | null} presetChannelId 预设频道
 * @returns {Promise<object>} 同步后的 state
 */
async function syncGroupStateForHub(groupId, state, presetChannelId) {
	setHubState('context.currentState', state)
	rebindFederationRoomQuiet(groupId, {
		channelId: presetChannelId || state.groupSettings?.defaultChannelId || null,
	})
	void warmCharEntityHashCache()
	if (state.viewerEntityHash)
		hubStore.viewer.viewerEntityHash = state.viewerEntityHash
	const { refreshViewerHubPresentation } = await import('./init.mjs')
	await refreshViewerHubPresentation()
	if (state.viewerEntityHash) {
		const { syncViewerPresence } = await import('./hubStatus.mjs')
		await syncViewerPresence(state.viewerEntityHash)
	}
	const needsHeavySync = !Object.keys(state.channels || {}).length
	if (needsHeavySync)
		await syncGroupFromNetwork(groupId, { waitMs: 8000 })
	else if (state.federationActive)
		void syncGroupFromNetwork(groupId)
	else
		setSyncBanner(false)
	if (needsHeavySync) {
		state = await getGroupState(groupId)
		setHubState('context.currentState', state)
	}
	return state
}

/**
 * 渲染群侧栏与标题。
 * @param {object} state 群 state
 * @returns {Promise<void>}
 */
async function paintGroupHubChrome(state) {
	const groupNameElement = document.getElementById('hub-group-name-display')
	if (state.groupMeta.name) {
		delete groupNameElement.dataset.i18n
		groupNameElement.textContent = state.groupMeta.name
	}
	else {
		groupNameElement.textContent = ''
		groupNameElement.dataset.i18n = 'chat.hub.groupTag'
	}
	await renderChannelList(state)
	await renderMemberList(state)
	hubStore.context.currentMode = 'groups'
	document.querySelectorAll('.hub-server-item[data-mode]').forEach(el => {
		el.classList.toggle('mode-active', el.dataset.mode === 'groups')
	})
	await renderGroupInfoCard(state)
	void import('./messages/composerController.mjs').then(({ refreshHubHeaderButtons }) => refreshHubHeaderButtons())
	updateStatusBanners()
}

/**
 * 进入默认或预设频道。
 * @param {object} state 群 state
 * @param {string | null} presetChannelId 预设频道
 * @returns {Promise<void>}
 */
async function activateGroupChannel(state, presetChannelId) {
	const channelIds = Object.keys(state.channels || {})
	const targetChannelId = presetChannelId && state.channels?.[presetChannelId]
		? presetChannelId
		: state.groupSettings?.defaultChannelId || channelIds[0] || null
	if (targetChannelId) await selectChannel(targetChannelId)
	else {
		setHubState('context.currentChannelId', null)
		updateHash(hubStore.context.currentGroupId, null)
		const { disableComposer } = await import('./messages/composerController.mjs')
		disableComposer('chat.hub.noChannel')
		updateStatusBanners()
		void refreshPinsBookmarks()
	}
}

/**
 * 同群 hash 已指向另一频道时采纳 hash（selectGroup 长 await 期间用户/深链可能已改地址栏）。
 * @param {string} groupId 当前群
 * @param {string | null} fallback 预设频道
 * @returns {string | null} 应激活的频道
 */
function channelIdFromHashOr(groupId, fallback) {
	const { groupId: hashGroupId, channelId } = parseHash()
	return hashGroupId === groupId && channelId ? channelId : fallback
}

/**
 * 选中群组：入群、同步、渲染频道/成员并进入默认频道。
 * @param {string} groupId 群组 ID
 * @param {string | null} [presetChannelId] URL 或深链指定的频道
 * @returns {Promise<void>}
 */
export async function selectGroup(groupId, presetChannelId = null) {
	if (!groupId) return
	const channelId = channelIdFromHashOr(groupId, presetChannelId)
	clearPinPreviewCache()
	clearPrivateGroupState()
	resetFilesDrawerWire()
	closeGroupWebSocket()
	cancelScheduledChannelRefresh()
	setHubState('context.currentGroupId', groupId)
	setHubState('context.currentState', null)
	updateHash(groupId, channelId)
	const { setMode } = await import('./mode.mjs')
	await setMode('groups')
	await loadGroups()
	try {
		let state = await getGroupState(groupId)
		const memberState = await ensureGroupMembership(groupId, state)
		if (!memberState) return
		state = memberState
		state = await syncGroupStateForHub(groupId, state, channelId)
		await paintGroupHubChrome(state)
		await activateGroupChannel(state, channelIdFromHashOr(groupId, channelId))
	}
	catch (error) {
		setPinsBookmarksWrapVisible(false)
		updateStatusBanners()
		const err = handleUIError(error, 'chat.hub.loadGroupFailed')
		const { mountTemplate } = await import('../../../../scripts/features/template.mjs')
		await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/error', {
			i18nKey: 'chat.hub.loadGroupFailed',
			errorMessage: err.message,
		})
	}
}

/**
 * 保存 list 类型频道条目。
 * @param {object[]} items 列表频道条目
 * @returns {Promise<void>}
 */
export async function saveListChannelItems(items) {
	await updateChannelListItems(hubStore.context.currentGroupId, hubStore.context.currentChannelId, items)
	setHubState('context.currentState', await getGroupState(hubStore.context.currentGroupId))
}

/**
 * 导航至群组设置页（整页，非 Hub 内 modal）。
 * @param {string} groupId 群组 ID
 * @returns {void}
 */
export function navigateToGroupSettings(groupId) {
	window.location.href = `/parts/shells:chat/settings/#settings:${encodeURIComponent(groupId)}`
}
