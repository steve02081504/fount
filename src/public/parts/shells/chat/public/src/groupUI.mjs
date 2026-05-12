/**
 * 群组 UI 模块
 * 提供群组列表、创建、加入等界面功能
 */

/**
 * 创建新群组
 * @returns {Promise<string>} 群组ID
 */
export async function createGroup(name, description) {
	const response = await fetch('/api/parts/shells:chat/group/new', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ name, description })
	})

	const data = await response.json()
	if (!response.ok) {
		throw new Error(data.error || 'Failed to create group')
	}

	return data.groupId
}

/**
 * 获取群组列表
 * @returns {Promise<Array>} 群组列表
 */
export async function getGroupList() {
	const response = await fetch('/api/parts/shells:chat/group/list', {
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include'
	})

	const data = await response.json()
	if (!response.ok) {
		throw new Error(data.error || 'Failed to fetch groups')
	}

	return data.groups || []
}

/**
 * 加入群组
 * @param {string} groupId - 群组ID
 * @param {string} inviteCode - 邀请码（可选）
 * @returns {Promise<void>}
 */
export async function joinGroup(groupId, inviteCode = null) {
	const response = await fetch(`/api/parts/shells:chat/${groupId}/join`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ inviteCode })
	})

	const data = await response.json()
	if (!response.ok) {
		throw new Error(data.error || 'Failed to join group')
	}
}

/**
 * 获取群组详情
 * @param {string} groupId - 群组ID
 * @returns {Promise<object>} 群组状态
 */
export async function getGroupState(groupId) {
	const response = await fetch(`/api/parts/shells:chat/${groupId}/state`, {
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include'
	})

	const data = await response.json()
	if (!response.ok) {
		throw new Error(data.error || 'Failed to fetch group state')
	}

	return data.state
}

/**
 * 发送群组消息
 * @param {string} groupId - 群组ID
 * @param {string} channelId - 频道ID
 * @param {string} content - 消息内容
 * @returns {Promise<void>}
 */
export async function sendGroupMessage(groupId, channelId, content) {
	const response = await fetch(`/api/parts/shells:chat/${groupId}/channels/${channelId}/messages`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ content: typeof content === 'string' ? { text: content } : content })
	})

	const data = await response.json()
	if (!response.ok) {
		throw new Error(data.error || 'Failed to send message')
	}
}

/**
 * 获取频道消息
 * @param {string} groupId - 群组ID
 * @param {string} channelId - 频道ID
 * @param {object} options - 查询选项
 * @returns {Promise<Array>} 消息列表
 */
export async function getChannelMessages(groupId, channelId, options = {}) {
	const params = new URLSearchParams()
	if (options.since) params.append('since', options.since)
	if (options.before) params.append('before', options.before)
	if (options.limit) params.append('limit', options.limit)

	const response = await fetch(`/api/parts/shells:chat/${groupId}/channels/${channelId}/messages?${params}`, {
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include'
	})

	const data = await response.json()
	if (!response.ok) {
		throw new Error(data.error || 'Failed to fetch messages')
	}

	return data.messages || []
}

/**
 * 渲染群组列表界面
 * @param {HTMLElement} container - 容器元素
 */
export async function renderGroupList(container) {
	container.innerHTML = '<div class="loading loading-spinner loading-lg"></div>'

	try {
		const groups = await getGroupList()

		if (groups.length === 0) {
			container.innerHTML = `
				<div class="text-center py-8">
					<p class="text-lg mb-4">暂无群组</p>
					<div class="flex gap-2 justify-center">
						<button class="btn btn-outline" onclick="window.joinGroupById()">加入群组</button>
						<button class="btn btn-primary" onclick="window.showCreateGroupModal()">创建群组</button>
					</div>
				</div>
			`
			return
		}

		container.innerHTML = `
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-2xl font-bold">我的群组</h2>
				<div class="flex gap-2">
					<button class="btn btn-outline" onclick="window.joinGroupById()">加入群组</button>
					<button class="btn btn-primary" onclick="window.showCreateGroupModal()">创建群组</button>
				</div>
			</div>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				${groups.map(group => `
					<div class="card bg-base-200 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer"
						 onclick="window.openGroup('${group.groupId}')">
						<div class="card-body">
							<h3 class="card-title">${escapeHtml(group.name)}</h3>
							<p class="text-sm opacity-70">${escapeHtml(group.desc || '暂无描述')}</p>
							<div class="flex items-center gap-2 mt-2">
								<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
								</svg>
								<span class="text-sm">${group.memberCount || 0} 成员</span>
							</div>
						</div>
					</div>
				`).join('')}
			</div>
		`
	} catch (error) {
		container.innerHTML = `
			<div class="alert alert-error">
				<span>加载群组列表失败: ${escapeHtml(error.message)}</span>
			</div>
		`
	}
}

/**
 * 显示创建群组对话框
 */
export function showCreateGroupModal() {
	const ALL_PERMISSIONS = [
		'VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_STICKERS', 'ADD_REACTIONS',
		'MANAGE_MESSAGES', 'UPLOAD_FILES', 'PIN_MESSAGES', 'CREATE_THREADS',
		'MANAGE_CHANNELS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_ROLES',
		'INVITE_MEMBERS', 'STREAM'
	]
	const DEFAULT_ON = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_STICKERS', 'ADD_REACTIONS', 'INVITE_MEMBERS']
	const PERM_NAMES = {
		VIEW_CHANNEL: '查看频道', SEND_MESSAGES: '发送消息', SEND_STICKERS: '发送贴纸',
		ADD_REACTIONS: '添加反应', MANAGE_MESSAGES: '管理消息', MANAGE_CHANNELS: '管理频道',
		KICK_MEMBERS: '踢出成员', BAN_MEMBERS: '封禁成员', MANAGE_ROLES: '管理角色',
		INVITE_MEMBERS: '邀请成员', STREAM: '语音', CREATE_THREADS: '创建子频道',
		UPLOAD_FILES: '上传文件', PIN_MESSAGES: '置顶消息'
	}

	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `
		<style>
			.cg-modal-box {
				background: #2b2d31;
				color: #dbdee1;
				border-radius: 12px;
				max-width: 540px;
				width: 100%;
				max-height: 90vh;
				padding: 0;
				overflow: hidden;
				box-shadow: 0 8px 32px rgba(0,0,0,0.5);
				display: flex;
				flex-direction: column;
			}
			#create-group-form {
				display: flex;
				flex-direction: column;
				flex: 1;
				min-height: 0;
				overflow: hidden;
			}
			.cg-header {
				background: linear-gradient(135deg, #5865f2 0%, #4752c4 100%);
				padding: 28px 24px 24px;
				color: white;
				position: relative;
			}
			.cg-header h3 {
				font-size: 20px;
				font-weight: 700;
				margin: 0 0 4px;
			}
			.cg-header p {
				font-size: 13px;
				opacity: 0.85;
				margin: 0;
			}
			.cg-icon-bubble {
				width: 56px; height: 56px;
				background: rgba(255,255,255,0.18);
				border-radius: 16px;
				display: flex; align-items: center; justify-content: center;
				margin-bottom: 12px;
			}
			.cg-body {
				padding: 20px 24px;
				overflow-y: auto;
				flex: 1;
				min-height: 0;
			}
			.cg-section {
				background: #1e1f22;
				border-radius: 8px;
				padding: 16px;
				margin-bottom: 14px;
			}
			.cg-section-title {
				font-size: 12px; font-weight: 700;
				text-transform: uppercase;
				color: #949ba4;
				letter-spacing: 0.5px;
				margin-bottom: 10px;
			}
			.cg-field { margin-bottom: 12px; }
			.cg-field:last-child { margin-bottom: 0; }
			.cg-label {
				display: block;
				font-size: 12px;
				font-weight: 700;
				color: #b5bac1;
				margin-bottom: 6px;
				text-transform: uppercase;
				letter-spacing: 0.3px;
			}
			.cg-input, .cg-textarea, .cg-select {
				width: 100%;
				background: #1e1f22;
				border: 1px solid #1f2023;
				color: #dbdee1;
				padding: 10px 12px;
				border-radius: 6px;
				font-size: 14px;
				outline: none;
				box-sizing: border-box;
				font-family: inherit;
			}
			.cg-section .cg-input, .cg-section .cg-textarea, .cg-section .cg-select {
				background: #2b2d31;
			}
			.cg-input:focus, .cg-textarea:focus, .cg-select:focus { border-color: #5865f2; }
			.cg-textarea { resize: vertical; min-height: 64px; }

			.cg-perm-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 6px;
			}
			.cg-perm-item {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 6px 8px;
				border-radius: 4px;
				cursor: pointer;
				transition: background 0.1s;
				font-size: 13px;
				color: #dbdee1;
			}
			.cg-perm-item:hover { background: rgba(255,255,255,0.04); }
			.cg-perm-item input[type="checkbox"] {
				accent-color: #5865f2;
				width: 16px; height: 16px;
				cursor: pointer;
			}

			.cg-footer {
				background: #2b2d31;
				padding: 16px 24px;
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				border-top: 1px solid #1f2023;
				flex-shrink: 0;
			}
			.cg-btn {
				padding: 10px 20px;
				border-radius: 6px;
				border: none;
				cursor: pointer;
				font-size: 14px;
				font-weight: 600;
				transition: background 0.15s;
				font-family: inherit;
			}
			.cg-btn-cancel { background: transparent; color: #b5bac1; }
			.cg-btn-cancel:hover { background: rgba(255,255,255,0.06); color: #fff; }
			.cg-btn-primary { background: #5865f2; color: white; }
			.cg-btn-primary:hover { background: #4752c4; }

			.cg-radio-group { display: flex; gap: 8px; }
			.cg-radio-card {
				flex: 1;
				background: #2b2d31;
				border: 1.5px solid transparent;
				padding: 12px;
				border-radius: 8px;
				cursor: pointer;
				transition: all 0.15s;
			}
			.cg-radio-card:hover { background: #313338; }
			.cg-radio-card.active {
				border-color: #5865f2;
				background: rgba(88,101,242,0.1);
			}
			.cg-radio-card .name { font-weight: 600; font-size: 14px; color: #fff; margin-bottom: 4px; }
			.cg-radio-card .desc { font-size: 12px; color: #949ba4; }
		</style>
		<div class="modal-box cg-modal-box">
			<div class="cg-header">
				<div class="cg-icon-bubble">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M17 20h5v-2a3 3 0 00-5.356-1.857"/>
						<path d="M9 20H4v-2a3 3 0 015.356-1.857"/>
						<circle cx="12" cy="7" r="4"/>
						<path d="M9 20h6v-2a3 3 0 00-3-3 3 3 0 00-3 3v2z"/>
					</svg>
				</div>
				<h3>创建你的群组</h3>
				<p>群组是你和朋友一起聊天的私密空间</p>
			</div>
			<form id="create-group-form">
				<div class="cg-body">
					<!-- 基本信息 -->
					<div class="cg-section">
						<div class="cg-section-title">基本信息</div>
						<div class="cg-field">
							<label class="cg-label">群组名称 <span style="color:#f23f43">*</span></label>
							<input type="text" name="name" class="cg-input" required maxlength="50" placeholder="为你的群组起个名字" />
						</div>
						<div class="cg-field">
							<label class="cg-label">群组描述</label>
							<textarea name="description" class="cg-textarea" maxlength="200" placeholder="（选填）介绍一下这个群组"></textarea>
						</div>
					</div>

					<!-- 入群策略 -->
					<div class="cg-section">
						<div class="cg-section-title">谁可以加入</div>
						<div class="cg-radio-group">
							<label class="cg-radio-card active" data-policy="open">
								<input type="radio" name="joinPolicy" value="open" checked style="display:none" />
								<div class="name">🌐 公开</div>
								<div class="desc">任何人通过 ID 即可加入</div>
							</label>
							<label class="cg-radio-card" data-policy="invite-only">
								<input type="radio" name="joinPolicy" value="invite-only" style="display:none" />
								<div class="name">🔒 仅邀请</div>
								<div class="desc">需要邀请码才能加入</div>
							</label>
						</div>
					</div>

					<!-- 默认权限 -->
					<div class="cg-section">
						<div class="cg-section-title">默认成员权限 (@everyone)</div>
						<div class="cg-perm-grid">
							${ALL_PERMISSIONS.map(perm => `
								<label class="cg-perm-item">
									<input type="checkbox" name="grp-perm-${perm}" ${DEFAULT_ON.includes(perm) ? 'checked' : ''}>
									<span>${PERM_NAMES[perm] || perm}</span>
								</label>
							`).join('')}
						</div>
					</div>
				</div>
				<div class="cg-footer">
					<button type="button" class="cg-btn cg-btn-cancel" onclick="this.closest('dialog').close()">取消</button>
					<button type="submit" class="cg-btn cg-btn-primary">创建群组</button>
				</div>
			</form>
		</div>
		<form method="dialog" class="modal-backdrop"><button>关闭</button></form>
	`

	// 入群策略卡片切换
	setTimeout(() => {
		modal.querySelectorAll('.cg-radio-card').forEach(card => {
			card.addEventListener('click', () => {
				modal.querySelectorAll('.cg-radio-card').forEach(c => c.classList.remove('active'))
				card.classList.add('active')
				const radio = card.querySelector('input[type="radio"]')
				if (radio) radio.checked = true
			})
		})
	}, 0)

	document.body.appendChild(modal)
	modal.showModal()

	const form = modal.querySelector('#create-group-form')
	form.addEventListener('submit', async (e) => {
		e.preventDefault()
		const formData = new FormData(form)
		const name = formData.get('name')
		const description = formData.get('description')
		const joinPolicy = formData.get('joinPolicy')

		try {
			const groupId = await createGroup(name, description)

			// 更新群组设置
			if (joinPolicy !== 'open') {
				await fetch(`/api/parts/shells:chat/${groupId}/settings`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ joinPolicy })
				})
			}

			// 更新 @everyone 角色权限
			const permissions = {}
			for (const perm of ALL_PERMISSIONS) {
				const cb = modal.querySelector(`input[name="grp-perm-${perm}"]`)
				if (cb && cb.checked) permissions[perm] = true
			}
			await fetch(`/api/parts/shells:chat/${groupId}/roles/${encodeURIComponent('@everyone')}/permissions`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ permission: '__bulk__', permissions })
			})

			modal.close()
			modal.remove()
			window.location.href = `/parts/shells:chat/discord.html#${groupId}`
		} catch (error) {
			alert('创建群组失败: ' + error.message)
		}
	})
}

/**
 * 打开群组聊天界面
 * @param {string} groupId - 群组ID
 */
export async function openGroup(groupId) {
	window.location.href = `/parts/shells:chat/discord.html#${groupId}`
}

/**
 * HTML 转义
 * @param {string} text - 文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
	const div = document.createElement('div')
	div.textContent = text
	return div.innerHTML
}

/**
 * 通过群组ID加入群组（Discord 风格弹窗）
 */
export function joinGroupById() {
	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `
		<style>
			.jg-modal-box {
				background: #2b2d31;
				color: #dbdee1;
				border-radius: 12px;
				max-width: 460px;
				width: 100%;
				padding: 0;
				overflow: hidden;
				box-shadow: 0 8px 32px rgba(0,0,0,0.5);
			}
			.jg-header {
				background: linear-gradient(135deg, #5865f2 0%, #4752c4 100%);
				padding: 24px;
				color: white;
			}
			.jg-header h3 { margin: 0 0 4px; font-size: 20px; font-weight: 700; }
			.jg-header p { margin: 0; font-size: 13px; opacity: 0.85; }
			.jg-body { padding: 20px 24px; }
			.jg-label {
				display: block;
				font-size: 12px;
				font-weight: 700;
				color: #b5bac1;
				margin-bottom: 8px;
				text-transform: uppercase;
				letter-spacing: 0.3px;
			}
			.jg-input {
				width: 100%;
				background: #1e1f22;
				border: 1.5px solid #1f2023;
				color: #dbdee1;
				padding: 12px;
				border-radius: 6px;
				font-size: 15px;
				outline: none;
				box-sizing: border-box;
				font-family: inherit;
				transition: border-color 0.15s;
			}
			.jg-input:focus { border-color: #5865f2; }
			.jg-hint {
				font-size: 12px;
				color: #949ba4;
				margin-top: 8px;
				line-height: 1.5;
			}
			.jg-hint code {
				background: #1e1f22;
				padding: 2px 6px;
				border-radius: 4px;
				color: #dbdee1;
				font-family: 'Consolas', monospace;
				font-size: 11px;
			}
			.jg-footer {
				background: #2b2d31;
				padding: 16px 24px;
				display: flex;
				justify-content: flex-end;
				gap: 8px;
				border-top: 1px solid #1f2023;
			}
			.jg-btn {
				padding: 10px 20px;
				border-radius: 6px;
				border: none;
				cursor: pointer;
				font-size: 14px;
				font-weight: 600;
				transition: background 0.15s;
				font-family: inherit;
			}
			.jg-btn-cancel { background: transparent; color: #b5bac1; }
			.jg-btn-cancel:hover { background: rgba(255,255,255,0.06); color: #fff; }
			.jg-btn-primary { background: #5865f2; color: white; }
			.jg-btn-primary:hover { background: #4752c4; }
			.jg-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
		</style>
		<div class="modal-box jg-modal-box">
			<div class="jg-header">
				<h3>加入一个群组</h3>
				<p>输入群组 ID 即可加入对应的聊天</p>
			</div>
			<form id="join-group-form">
				<div class="jg-body">
					<label class="jg-label" for="jg-id-input">群组 ID</label>
					<input id="jg-id-input" name="groupId" class="jg-input" required autofocus
						placeholder="group_1776941580949_xxxx" autocomplete="off" />
					<div class="jg-hint">
						群组 ID 由群主分享给你。格式形如 <code>group_xxx</code>。
					</div>
				</div>
				<div class="jg-footer">
					<button type="button" class="jg-btn jg-btn-cancel" data-action="cancel">取消</button>
					<button type="submit" class="jg-btn jg-btn-primary">加入群组</button>
				</div>
			</form>
		</div>
		<form method="dialog" class="modal-backdrop"><button>关闭</button></form>
	`
	document.body.appendChild(modal)
	modal.showModal()

	modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
		modal.close(); modal.remove()
	})
	modal.querySelector('#join-group-form').addEventListener('submit', (e) => {
		e.preventDefault()
		const id = modal.querySelector('#jg-id-input').value.trim()
		if (!id) return
		modal.close(); modal.remove()
		window.location.href = `/parts/shells:chat/discord.html#${id}`
	})
	modal.addEventListener('close', () => modal.remove())
}

// 全局函数暴露
window.showCreateGroupModal = showCreateGroupModal
window.openGroup = openGroup
window.joinGroupById = joinGroupById
