/**
 * Hub 群文件面板：列出当前成员 role 可访问的共享柜；管理者可绑定新柜。
 */
import { getGroupState } from '../src/endpoints/groupCore.mjs'
import { bindGroupCabinet } from '../src/endpoints/groupFiles.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { store } from './core/state.mjs'

let filesDrawerWired = false

/** 换群或清理 Hub 状态时重置文件侧栏事件绑定。 */
export function resetFilesDrawerWire() {
	filesDrawerWired = false
	setFilesDrawerOpen(false)
}

/**
 * @returns {boolean} 侧栏是否打开
 */
export function isFilesDrawerOpen() {
	const toggle = document.getElementById('files-drawer-toggle')
	return toggle instanceof HTMLInputElement && toggle.checked
}

/**
 * @param {boolean} open 是否显示
 */
export function setFilesDrawerOpen(open) {
	const toggle = document.getElementById('files-drawer-toggle')
	if (toggle instanceof HTMLInputElement)
		toggle.checked = open
	document.getElementById('header-files-button')?.classList.toggle('is-active', open)
}

/** @returns {void} */
export function wireFilesDrawerToggle() {
	const toggle = document.getElementById('files-drawer-toggle')
	if (!toggle || toggle.dataset.wired) return
	toggle.dataset.wired = '1'
	toggle.addEventListener('change', () => {
		const open = toggle instanceof HTMLInputElement && toggle.checked
		setFilesDrawerOpen(open)
		if (open && store.context.currentGroupId)
			refreshFilesDrawer({
				groupId: store.context.currentGroupId,
				state: store.context.currentState,
				viewer: store.context.currentState?.viewer,
			}).catch(handleError('chat.hub.files.loadFailed'))
	})
}

/**
 * @param {object} state 群状态
 * @param {string} viewerKey 本机成员 key
 * @returns {Array<{ cabinet_id: string, name: string, access: string }>} 可访问柜
 */
function cabinetsForViewer(state, viewerKey) {
	const member = state.members?.[viewerKey]
	const roles = new Set(member?.roles || [])
	/** @type {Array<{ cabinet_id: string, name: string, access: string }>} */
	const out = []
	for (const bind of Object.values(state.cabinets || {})) {
		let access = null
		for (const roleId of roles) {
			const level = bind.role_access?.[roleId]
			if (level === 'rw') { access = 'rw'; break }
			if (level === 'ro') access = 'ro'
		}
		if (access)
			out.push({
				cabinet_id: bind.cabinet_id,
				name: bind.name || bind.cabinet_id.slice(0, 8),
				access,
			})
	}
	return out
}

/**
 * @param {object} drawer 上下文
 * @returns {Promise<void>}
 */
export async function refreshFilesDrawer(drawer) {
	const host = document.getElementById('files-list')
	if (!host || !drawer.groupId) return
	const state = drawer.state || await getGroupState(drawer.groupId)
	const viewerKey = drawer.viewer?.memberKey || state.viewer?.memberKey || state.viewer?.pubKeyHash
	const cabinets = cabinetsForViewer(state, viewerKey)
	const perms = state.viewer?.permissions || {}
	const canManage = Boolean(perms.ADMIN || perms.MANAGE_ADMINS)

	host.replaceChildren()
	const list = document.createElement('div')
	list.className = 'flex flex-col gap-2 p-2'
	for (const row of cabinets) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'btn btn-ghost justify-start'
		btn.textContent = `${row.name} (${row.access})`
		btn.addEventListener('click', () => {
			window.location.href = `/parts/shells:cabinet/#shared:${row.cabinet_id}`
		})
		list.appendChild(btn)
	}
	if (!cabinets.length) {
		const empty = document.createElement('p')
		empty.className = 'text-sm opacity-60 p-2'
		empty.setAttribute('data-i18n', 'chat.hub.files.no.cabinets')
		empty.textContent = '当前角色没有可访问的文件柜'
		list.appendChild(empty)
	}
	host.appendChild(list)

	const actions = document.getElementById('files-actions')
	if (actions) {
		actions.replaceChildren()
		if (canManage) {
			const addBtn = document.createElement('button')
			addBtn.type = 'button'
			addBtn.className = 'btn btn-primary btn-sm'
			addBtn.setAttribute('data-i18n', 'chat.hub.files.bindCabinet')
			addBtn.textContent = '添加文件柜'
			addBtn.addEventListener('click', () => {
				bindCabinetFlow(drawer.groupId, state).then(() => refreshFilesDrawer(drawer)).catch(handleError('chat.hub.files.loadFailed'))
			})
			actions.appendChild(addBtn)
		}
	}
}

/**
 * @param {string} groupId 群
 * @param {object} state 状态
 * @returns {Promise<void>}
 */
async function bindCabinetFlow(groupId, state) {
	const cabinetId = window.prompt('共享柜 cabinet_id（hex64）')
	if (!cabinetId) return
	const roleIds = Object.keys(state.roles || {})
	const roleId = window.prompt(`绑定角色 id（可选：${roleIds.join(', ')}）`, roleIds[0] || '@everyone')
	if (!roleId) return
	const access = window.prompt('访问级别 rw / ro', 'rw')
	if (!access) return
	await bindGroupCabinet(groupId, {
		cabinet_id: cabinetId.trim(),
		role_access: { [roleId.trim()]: access.trim() === 'ro' ? 'ro' : 'rw' },
	})
}

/**
 * @param {object} drawer 上下文
 * @returns {void}
 */
export function wireFilesDrawer(drawer) {
	if (filesDrawerWired) return
	filesDrawerWired = true
	const toggle = document.getElementById('files-drawer-toggle')
	toggle?.addEventListener('change', () => {
		if (isFilesDrawerOpen())
			refreshFilesDrawer(drawer).catch(handleError('chat.hub.files.loadFailed'))
	})
}

/**
 * @param {object} drawer 上下文
 * @returns {Promise<void>}
 */
export async function openFilesDrawer(drawer) {
	setFilesDrawerOpen(true)
	await refreshFilesDrawer(drawer)
}
