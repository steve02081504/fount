import { renderTemplate } from '../../../../../pages/scripts/template.mjs'
import { geti18n, setLocalizeLogic } from '../../../../../scripts/i18n.mjs'
import { showToastI18n } from '../../../../../scripts/toast.mjs'

import { runApplyGroupHashDom } from './groupApplyHashDom.mjs'
import {
	createApplyGroupStateSlice,
	createChannelState,
	fetchDefaultChannelRedirectIfNeeded,
	fetchGroupStateData,
} from './groupApplyHashState.mjs'
import { setupGroupWebSocket } from './groupApplyHashWs.mjs'
import { viewerCanOwnerSuccession } from './groupViewerPermissions.mjs'
import { handleUIError, normalizeError } from './utils.mjs'
import { setActiveWebSocket, setInboundRpcExecutor, setLocalGroupRpcClientNodeId, setWsStatusIndicator } from './websocket.mjs'


/**
 * 解析地址栏 hash：`#group:{groupId}:{channelId}`。
 * @returns {{ groupId: string, channelId: string } | null} 解析结果；无效 hash 时为 null
 */
export function parseGroupHash() {
	const h = (location.hash || '').replace(/^#/, '')
	if (!h.startsWith('group:')) return null
	const rest = h.slice('group:'.length)
	const parts = rest.split(':')
	if (parts.length < 2 || !parts[0] || !parts[1]) return null
	return { groupId: parts[0], channelId: parts[1] }
}

let groupWs = null
/** @type {AbortController | null} */
let groupUiAbort = null
let listenersBound = false

/**
 * 渲染并返回群聊通用弹窗外壳节点。
 * @param {string} [dialogClass='modal'] dialog 的 className
 * @returns {Promise<HTMLDialogElement>} 渲染得到的 dialog 元素
 */
async function renderGroupDialogShell(dialogClass = 'modal') {
	const node = await renderTemplate('group_modal_dialog_shell', { dialogClass })
	if (node instanceof HTMLDialogElement) return node
	const dlg = node?.querySelector?.('dialog[data-group-dialog-shell]')
	if (dlg instanceof HTMLDialogElement) return dlg
	throw new Error('renderGroupDialogShell returned non-dialog node')
}

/**
 * @returns {Promise<void>}
 */
async function updateGroupGovernanceDrawer() {
	const sec = document.getElementById('group-governance-section')
	if (!sec) return
	const parsed = parseGroupHash()
	if (!parsed) {
		sec.classList.add('hidden')
		return
	}
	const st = await fetchGroupStateData(parsed.groupId)
	if (!st) {
		sec.classList.add('hidden')
		return
	}
	const ok = await viewerCanOwnerSuccession(st, parsed.groupId)
	sec.classList.toggle('hidden', !ok)
}

/**
 * 根据当前 URL hash 挂载或卸载群组 UI，并建立 WebSocket。
 * @returns {Promise<void>} hash 无效时清理 UI；重定向默认频道时提前结束
 */
async function applyGroupHash() {
	const panel = document.getElementById('group-mode-panel')
	const tree = document.getElementById('group-channel-tree')
	const members = document.getElementById('group-members-list')
	const msgBox = document.getElementById('group-messages')
	const input = document.getElementById('group-message-input')
	if (!panel || !tree || !msgBox) return

	groupUiAbort?.abort()
	groupUiAbort = new AbortController()
	const { signal } = groupUiAbort
	setInboundRpcExecutor(null)
	setLocalGroupRpcClientNodeId(null)

	const parsed = parseGroupHash()
	if (!parsed) {
		if (groupWs) {
			setActiveWebSocket(null)
			setWsStatusIndicator(null)
			groupWs.close()
			groupWs = null
		}
		if (msgBox) msgBox.innerHTML = ''
		if (tree) tree.innerHTML = ''
		void updateGroupGovernanceDrawer()
		return
	}
	const { groupId, channelId } = parsed

	if (await fetchDefaultChannelRedirectIfNeeded(groupId, channelId)) return

	const wsClientId = sessionStorage.getItem('group:wsClientId') || crypto.randomUUID()
	sessionStorage.setItem('group:wsClientId', wsClientId)
	setLocalGroupRpcClientNodeId(wsClientId)

	const channelState = createChannelState({ groupId, channelId, signal })
	const stateSlice = createApplyGroupStateSlice(groupId, channelId)

	const { wsPayload } = await runApplyGroupHashDom({
		panel,
		tree,
		members,
		msgBox,
		input,
		signal,
		groupId,
		channelId,
		wsClientId,
		channelState,
		stateSlice,
		/** @returns {unknown[]} 当前内存中的 DM 拉黑列表 */
		getDmBlocklist: () => dmBlocklist,
		/**
		 * 覆盖 DM 拉黑列表。
		 * @param {unknown[]} next 新的拉黑条目数组
		 * @returns {void}
		 */
		setDmBlocklist: next => { dmBlocklist = next },
	})

	void updateGroupGovernanceDrawer()

	setupGroupWebSocket(wsPayload, {
		/** @returns {WebSocket | null} 当前群组 WebSocket，未连接时为 null */
		get: () => groupWs,
		/**
		 * 保存或清空群组 WebSocket 引用。
		 * @param {WebSocket | null} ws 新连接或 null（关闭时）
		 * @returns {void}
		 */
		set: ws => { groupWs = ws },
	})
}

/** DM 拉黑列表（本地缓存，sessionStorage 为辅） */
let dmBlocklist = []
/**
 * 加载 DM 拉黑列表
 */
async function loadDmBlocklist() {
	try {
		const r = await fetch('/api/parts/shells:chat/dm-blocklist')
		if (r.ok) dmBlocklist = (await r.json()).blocked || []
	}
	catch (e) {
		console.error('loadDmBlocklist failed:', e)
	}
}
loadDmBlocklist()

/**
 * 从 URL 哈希初始化群组视图
 */
export async function initGroupViewFromHash() {
	if (!listenersBound) {
		listenersBound = true
		window.addEventListener('hashchange', () => {
			applyGroupHash()
		})
		document.getElementById('group-owner-succession-button')?.addEventListener('click', async () => {
			const parsed = parseGroupHash()
			if (!parsed) return
			const dlg = await renderGroupDialogShell('modal')
			dlg.replaceChildren(await renderTemplate('group_owner_succession_modal', {}))
			document.body.appendChild(dlg)
			setLocalizeLogic(dlg, () => {
				for (const el of dlg.querySelectorAll('[data-i18n]')) {
					const k = el.getAttribute('data-i18n')
					if (k) el.textContent = geti18n(k)
				}
			})
			dlg.showModal()
			/**
			 *
			 */
			const close = () => {
				dlg.remove()
			}
			dlg.querySelector('[data-owner-succ-cancel]')?.addEventListener('click', close)
			dlg.querySelector('[data-owner-succ-submit]')?.addEventListener('click', async () => {
				const inp = dlg.querySelector('[data-owner-pubkey-input]')
				const proposedOwnerPubKeyHash = inp instanceof HTMLInputElement ? inp.value.trim() : ''
				if (!proposedOwnerPubKeyHash) {
					showToastI18n('warning', 'chat.group.ownerSuccessionNeedHash')
					return
				}
				try {
					const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(parsed.groupId)}/owner-succession-ballot`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							proposedOwnerPubKeyHash,
							ballotId: crypto.randomUUID(),
							adminSignatures: [],
						}),
					})
					if (!r.ok) {
						handleUIError(new Error(`owner-succession HTTP ${r.status}`), 'chat.group.ownerSuccessionFailed', 'owner succession')
						return
					}
					showToastI18n('success', 'chat.group.ownerSuccessionSubmitted')
					close()
				}
				catch (e) {
					handleUIError(normalizeError(e), 'chat.group.ownerSuccessionFailed', 'owner succession')
				}
			})
		})
		document.getElementById('group-create-button')?.addEventListener('click', async () => {
			const dialog = await renderGroupDialogShell('modal modal-open')
			dialog.replaceChildren(await renderTemplate('group_create_modal', {}))
			document.body.appendChild(dialog)
			setLocalizeLogic(dialog, () => {
				for (const el of dialog.querySelectorAll('[data-i18n]')) {
					const k = el.getAttribute('data-i18n')
					if (k) el.textContent = geti18n(k)
				}
				for (const el of dialog.querySelectorAll('[data-i18n-placeholder]')) {
					const k = el.getAttribute('data-i18n-placeholder')
					if (k) el.setAttribute('placeholder', geti18n(k))
				}
			})
			dialog.querySelector('#create-group-cancel')?.addEventListener('click', () => dialog.remove())
			dialog.querySelector('#create-group-confirm')?.addEventListener('click', async () => {
				const nameVal = dialog.querySelector('#new-group-name')?.value?.trim()
				const channelVal = dialog.querySelector('#new-group-channel')?.value?.trim() || 'general'
				dialog.remove()
				const r = await fetch('/api/parts/shells:chat/groups/new', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: nameVal || geti18n('chat.group.newGroupName'), defaultChannelName: channelVal }),
				})
				if (r.ok) {
					const { groupId: newId, channelId: newCh } = await r.json()
					location.hash = `group:${newId}:${newCh || 'default'}`
				}
				else handleUIError(new Error(`createGroup HTTP ${r.status}`), 'chat.group.createGroupFailed', 'createGroup')
			})
		})
	}
	await applyGroupHash()
}

