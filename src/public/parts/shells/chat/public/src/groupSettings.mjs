/**
 * 群组设置模块
 * 处理群组基本设置、角色权限、成员管理
 */

import { geti18n, initTranslations } from '../../../scripts/i18n.mjs'

let currentGroupId = null
let currentState = null

/**
 * 初始化群组设置
 */
export async function initGroupSettings() {
	await initTranslations('chat')
	const hash = window.location.hash.slice(1)
	if (hash.startsWith('settings:')) {
		const groupId = hash.split(':')[1]
		await loadGroupSettings(groupId)
	}

	setupEventListeners()
}

/**
 * 加载群组设置
 * @param {string} groupId - 群组ID
 */
async function loadGroupSettings(groupId) {
	try {
		currentGroupId = groupId

		const response = await fetch(`/api/parts/shells:chat/groups/${groupId}/state`, {
			credentials: 'include'
		})

		if (!response.ok) throw new Error('Failed to load group settings')

		const data = await response.json()
		if (!data.success) throw new Error(data.error)

		currentState = data.state

		renderGroupSettings()
		renderPermissionSettings()
		renderMembers()
	} catch (error) {
		console.error('Load group settings error:', error)
		showError('加载群组设置失败: ' + error.message)
	}
}

/**
 * 渲染群组设置
 */
function renderGroupSettings() {
	const container = document.getElementById('group-settings-container')
	if (!container) return

	container.innerHTML = `
		<div class="card bg-base-200 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">群组基本设置</h2>

				<div class="form-control">
					<label class="label">
						<span class="label-text">群组名称</span>
					</label>
					<input type="text" id="group-name" class="input input-bordered"
						value="${escapeHtml(currentState.groupMeta.name)}">
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">群组描述</span>
					</label>
					<textarea id="group-desc" class="textarea textarea-bordered" rows="3">${escapeHtml(currentState.groupMeta.desc)}</textarea>
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">入群策略</span>
					</label>
					<select id="join-policy" class="select select-bordered">
						<option value="invite-only" ${currentState.groupSettings.joinPolicy === 'invite-only' ? 'selected' : ''}>仅邀请</option>
						<option value="pow" ${currentState.groupSettings.joinPolicy === 'pow' ? 'selected' : ''}>需要 PoW</option>
					</select>
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">PoW 难度</span>
					</label>
					<input type="number" id="pow-difficulty" class="input input-bordered"
						value="${currentState.groupSettings.powDifficulty}" min="1" max="10">
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">${escapeHtml(geti18n('chat.group.settingsLogicalStreamIdle'))}</span>
					</label>
					<input type="number" id="logical-stream-idle-ms" class="input input-bordered"
						min="5000" max="600000" step="1000"
						value="${Number(currentState.groupSettings.logicalStreamIdleMs) || 150000}">
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">${escapeHtml(geti18n('chat.group.settingsMaxDagPayload'))}</span>
					</label>
					<input type="number" id="max-dag-payload-bytes" class="input input-bordered"
						min="4096" max="8388608" step="1024"
						value="${Number(currentState.groupSettings.maxDagPayloadBytes) || 262144}">
				</div>

			<div class="form-control">
				<label class="label">
					<span class="label-text">${escapeHtml(geti18n('chat.group.settingsStreamingSfu'))}</span>
				</label>
				<input type="text" id="streaming-sfu-wss" class="input input-bordered" placeholder="wss://..."
					value="${escapeHtml(currentState.groupSettings.streamingSfuWss || '')}">
			</div>

				<div class="card-actions justify-between mt-4">
					<button id="delete-group-btn" class="btn btn-error">删除群组</button>
					<button id="save-group-settings" class="btn btn-primary">保存设置</button>
				</div>
			</div>
		</div>
	`

	document.getElementById('save-group-settings')?.addEventListener('click', saveGroupSettings)
	document.getElementById('delete-group-btn')?.addEventListener('click', deleteGroup)
}


/**
 * 渲染权限设置
 */
function renderPermissionSettings() {
	const container = document.getElementById('permission-settings-container')
	if (!container) return

	const roles = Object.entries(currentState.roles)

	container.innerHTML = `
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body">
				<div class="flex justify-between items-center mb-4">
					<h2 class="card-title">角色与权限</h2>
					<button id="create-role-btn" class="btn btn-primary btn-sm">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
						创建角色
					</button>
				</div>

				<div class="space-y-3">
					${roles.map(([roleId, role]) => `
						<div class="collapse collapse-arrow bg-base-300">
							<input type="checkbox" />
							<div class="collapse-title font-medium flex items-center gap-2">
								<div class="w-4 h-4 rounded-full" style="background-color: ${role.color}"></div>
								${escapeHtml(role.name)}
								${role.isDefault ? '<span class="badge badge-sm">默认</span>' : ''}
							</div>
							<div class="collapse-content">
								<div class="grid grid-cols-2 gap-2 mt-2">
									${[...CHANNEL_PERMISSIONS, 'MANAGE_CHANNELS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_ROLES', 'INVITE_MEMBERS', 'STREAM', 'MANAGE_FILES', 'ADMIN'].map(perm => `
										<label class="label cursor-pointer justify-start gap-2">
											<input type="checkbox" class="checkbox checkbox-sm"
												${role.permissions[perm] ? 'checked' : ''}
												onchange="updateRolePermission('${roleId}', '${perm}', this.checked)">
											<span class="label-text text-sm">${getPermissionName(perm)}</span>
										</label>
									`).join('')}
								</div>
								${!role.isDefault ? `
									<div class="flex gap-2 mt-4">
										<button class="btn btn-sm btn-error" onclick="deleteRole('${roleId}')">删除角色</button>
									</div>
								` : ''}
							</div>
						</div>
					`).join('')}
				</div>
			</div>
		</div>
	`

	document.getElementById('create-role-btn')?.addEventListener('click', showCreateRoleModal)
}

/**
 *
 */
function renderMembers() {
	const container = document.getElementById('members-list')
	if (!container) return

	const members = Array.isArray(currentState.members)
		? currentState.members
		: Object.entries(currentState.members || {})
			.filter(([, m]) => m?.status === 'active')
			.map(([key, m]) => ({ username: m.pubKeyHash || key, roles: m.roles || ['@everyone'] }))

	if (!members.length) {
		container.innerHTML = '<p class="text-sm opacity-60">暂无成员</p>'
		return
	}

	container.innerHTML = members.map(member => {
		const username = member.username || member.pubKeyHash || '?'
		const roleNames = (member.roles || []).map(roleId => currentState.roles[roleId]?.name || roleId)
		return `
			<div class="flex items-center justify-between p-3 bg-base-300 rounded-lg">
				<div class="flex items-center gap-3 min-w-0">
					<div class="avatar placeholder">
						<div class="bg-neutral text-neutral-content rounded-full w-10 h-10">
							<span class="text-sm">${escapeHtml(username.charAt(0).toUpperCase())}</span>
						</div>
					</div>
					<div class="min-w-0">
						<div class="font-medium truncate">${escapeHtml(username)}</div>
						<div class="text-xs opacity-60 truncate">角色: ${escapeHtml(roleNames.join(' / ') || '@everyone')}</div>
					</div>
				</div>
				<div class="flex gap-2">
					<button class="btn btn-xs btn-warning" onclick="kickMember('${encodeURIComponent(username)}')" ${(member.roles || []).includes('admin') ? 'disabled' : ''}>踢出</button>
					<button class="btn btn-xs btn-error" onclick="banMember('${encodeURIComponent(username)}')" ${(member.roles || []).includes('admin') ? 'disabled' : ''}>封禁</button>
				</div>
			</div>
		`
	}).join('')
}

/**
 * 保存群组设置
 */
async function saveGroupSettings() {
	try {
		const name = document.getElementById('group-name').value.trim()
		const desc = document.getElementById('group-desc').value.trim()
		const joinPolicy = document.getElementById('join-policy').value
		const powDifficulty = Number.parseInt(document.getElementById('pow-difficulty').value, 10) || 4
		const logicalStreamIdleMs = Number.parseInt(document.getElementById('logical-stream-idle-ms').value, 10) || 150000
		const maxDagPayloadBytes = Number.parseInt(document.getElementById('max-dag-payload-bytes').value, 10) || 262144
		const streamingSfuWssRaw = document.getElementById('streaming-sfu-wss')?.value?.trim() || ''

		// 更新群组元数据
		const metaResponse = await fetch(`/api/parts/shells:chat/groups/${currentGroupId}/meta`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ name, desc })
		})

		if (!metaResponse.ok) throw new Error('Failed to update group meta')

		// 更新群组设置
		const settingsResponse = await fetch(`/api/parts/shells:chat/groups/${currentGroupId}/settings`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				joinPolicy,
				powDifficulty,
				logicalStreamIdleMs,
				maxDagPayloadBytes,
				streamingSfuWss: streamingSfuWssRaw || null,
			})
		})

		if (!settingsResponse.ok) throw new Error('Failed to update group settings')

		showSuccess('群组设置已保存')
		await loadGroupSettings(currentGroupId)
	} catch (error) {
		console.error('Save group settings error:', error)
		showError('保存设置失败: ' + error.message)
	}
}

/**
 * 删除群组
 */
async function deleteGroup() {
	if (!confirm('确定要删除此群组吗？此操作不可撤销，所有消息和成员数据将被永久删除。')) return
	try {
		const resp = await fetch(`/api/parts/shells:chat/groups/${currentGroupId}`, {
			method: 'DELETE',
			credentials: 'include'
		})
		const data = await resp.json()
		if (!resp.ok || !data.success) throw new Error(data.error || '删除群组失败')
		showSuccess('群组已删除')
		window.location.href = '/parts/shells:home'
	} catch (error) {
		console.error('Delete group error:', error)
		showError('删除群组失败: ' + error.message)
	}
}

/**
 * 频道权限常量列表
 */
const CHANNEL_PERMISSIONS = [
	'VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_STICKERS', 'ADD_REACTIONS',
	'MANAGE_MESSAGES', 'UPLOAD_FILES', 'PIN_MESSAGES', 'CREATE_THREADS'
]


/**
 * 更新角色权限
 * @param {string} roleId - 角色 id
 * @param {string} permission - 权限常量名
 * @param {boolean} enabled - 是否授予该权限
 * @returns {Promise<void>}
 */
window.updateRolePermission = async function(roleId, permission, enabled) {
	try {
		const resp = await fetch(`/api/parts/shells:chat/groups/${currentGroupId}/roles/${encodeURIComponent(roleId)}/permissions`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ permission, enabled })
		})
		if (!resp.ok) throw new Error('Failed to update permission')
		showSuccess('权限已更新')
	} catch (error) {
		console.error('Update role permission error:', error)
		showError('更新权限失败: ' + error.message)
		await loadGroupSettings(currentGroupId)
	}
}


/**
 * 删除角色
 * @param {string} roleId - 角色 id
 * @returns {Promise<void>}
 */
window.deleteRole = async function(roleId) {
	if (!confirm('确定要删除此角色吗？')) return
	try {
		const resp = await fetch(`/api/parts/shells:chat/groups/${currentGroupId}/roles/${encodeURIComponent(roleId)}`, {
			method: 'DELETE',
			credentials: 'include'
		})
		if (!resp.ok) throw new Error('Failed to delete role')
		showSuccess('角色已删除')
		await loadGroupSettings(currentGroupId)
	} catch (error) {
		console.error('Delete role error:', error)
		showError('删除角色失败: ' + error.message)
	}
}

/**
 * 显示创建角色对话框
 */
function showCreateRoleModal() {
	const name = prompt('输入角色名称:')
	if (!name || !name.trim()) return

	fetch(`/api/parts/shells:chat/groups/${currentGroupId}/roles`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ name: name.trim() })
	}).then(r => r.json()).then(async data => {
		if (data.success) {
			showSuccess('角色已创建')
			await loadGroupSettings(currentGroupId)
		} else 
			showError('创建角色失败: ' + (data.error || '未知错误'))
		
	}).catch(err => showError('创建角色失败: ' + err.message))
}

/**
 * 踢出成员（由设置页内联按钮调用）。
 * @param {string} encodedUsername - URL 编码后的用户名
 * @returns {Promise<void>}
 */
window.kickMember = async function(encodedUsername) {
	const username = decodeURIComponent(encodedUsername)
	if (!confirm(`确定踢出成员 ${username} 吗？`)) return
	try {
		const resp = await fetch(`/api/parts/shells:chat/groups/${currentGroupId}/members/${encodeURIComponent(username)}/kick`, {
			method: 'POST',
			credentials: 'include'
		})
		if (!resp.ok) throw new Error('Failed to kick member')
		showSuccess('成员已踢出')
		await loadGroupSettings(currentGroupId)
	} catch (error) {
		console.error('Kick member error:', error)
		showError('踢出成员失败: ' + error.message)
	}
}

/**
 * 封禁成员（由设置页内联按钮调用）。
 * @param {string} encodedUsername - URL 编码后的用户名
 * @returns {Promise<void>}
 */
window.banMember = async function(encodedUsername) {
	const username = decodeURIComponent(encodedUsername)
	if (!confirm(`确定封禁成员 ${username} 吗？`)) return
	try {
		const resp = await fetch(`/api/parts/shells:chat/groups/${currentGroupId}/members/${encodeURIComponent(username)}/ban`, {
			method: 'POST',
			credentials: 'include'
		})
		if (!resp.ok) throw new Error('Failed to ban member')
		showSuccess('成员已封禁')
		await loadGroupSettings(currentGroupId)
	} catch (error) {
		console.error('Ban member error:', error)
		showError('封禁成员失败: ' + error.message)
	}
}

/**
 * 将权限常量映射为中文展示名。
 * @param {string} perm - 权限常量
 * @returns {string} 中文名；未知时返回原常量
 */
function getPermissionName(perm) {
	const names = {
		VIEW_CHANNEL: '查看频道',
		SEND_MESSAGES: '发送消息',
		SEND_STICKERS: '发送贴纸',
		ADD_REACTIONS: '添加反应',
		MANAGE_MESSAGES: '管理消息',
		MANAGE_CHANNELS: '管理频道',
		KICK_MEMBERS: '踢出成员',
		BAN_MEMBERS: '封禁成员',
		MANAGE_ROLES: '管理角色',
		INVITE_MEMBERS: '邀请成员',
		STREAM: '语音',
		CREATE_THREADS: '创建子频道',
		UPLOAD_FILES: '上传文件',
		MANAGE_FILES: '管理文件',
		PIN_MESSAGES: '置顶消息',
		ADMIN: '管理员'
	}
	return names[perm] || perm
}

/**
 * HTML 转义。
 * @param {unknown} text - 待转义内容
 * @returns {string} 转义后的字符串
 */
function escapeHtml(text) {
	return String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * 成功提示（alert）。
 * @param {string} message - 提示文案
 * @returns {void}
 */
function showSuccess(message) {
	alert(message)
}

/**
 * 错误提示（alert）。
 * @param {string} message - 错误文案
 * @returns {void}
 */
function showError(message) {
	alert(message)
}

/**
 * 预留：集中注册设置页事件（当前由各渲染函数自行绑定）。
 * @returns {void}
 */
function setupEventListeners() {
	// 事件监听器已在各渲染函数中设置
}
