/**
 * 群组 UI 模块
 * 提供群组列表、创建、加入等界面功能
 */

/**
 * 创建新群组
 * @param {string} name - 群组名称
 * @param {string} description - 群组描述
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>} 新群 ID 与默认频道 ID
 */
export async function createGroup(name, description) {
	const response = await fetch('/api/parts/shells:chat/groups/new', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ name, description })
	})

	const data = await response.json()
	if (!response.ok)
		throw new Error(data.error || 'Failed to create group')

	return { groupId: data.groupId, defaultChannelId: data.defaultChannelId || 'default' }
}

/**
 * 获取群组列表
 * @returns {Promise<Array>} 群组列表
 */
export async function getGroupList() {
	const response = await fetch('/api/parts/shells:chat/groups/list', {
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
	})

	const data = await response.json()
	if (!response.ok || !Array.isArray(data))
		throw new Error('Failed to fetch groups')

	return data
		.filter(r => r && r.listKind === 'p2p')
		.map(r => ({
			groupId: r.groupId,
			name: r.name,
			desc: r.desc,
			avatar: r.avatar,
			defaultChannelId: r.defaultChannelId,
			memberCount: r.memberCount,
			channelCount: r.channelCount,
		}))
}

/**
 * 加入群组
 * @param {string} groupId - 群组ID
 * @param {string} inviteCode - 邀请码（可选）
 * @returns {Promise<void>}
 */
export async function joinGroup(groupId, inviteCode = null) {
	const response = await fetch(`/api/parts/shells:chat/groups/${groupId}/join`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ inviteCode })
	})

	const data = await response.json()
	if (!response.ok) 
		throw new Error(data.error || 'Failed to join group')
	
}

/**
 * 使用双方 Ed25519 公钥（各 64 位十六进制）创建密钥 DM；`myPubKeyHex` 须由客户端从本地密钥材料导出。
 * @param {string} myPubKeyHex 本端公钥 hex
 * @param {string} peerPubKeyHex 对端公钥 hex
 * @param {{ dmIntroNonce?: string, dmIntroSig?: string }} [dmLinkProof] 可选 First Contact 签名（§16）
 * @returns {Promise<object>} 服务端 JSON（含 `groupId`、`dmSessionTag` 等）
 */
export async function createDirectMessageByPubKeys(myPubKeyHex, peerPubKeyHex, dmLinkProof = undefined) {
	const body = { template: 'dm', myPubKeyHex, peerPubKeyHex }
	if (dmLinkProof && typeof dmLinkProof === 'object') {
		const n = typeof dmLinkProof.dmIntroNonce === 'string' ? dmLinkProof.dmIntroNonce.trim() : ''
		const s = typeof dmLinkProof.dmIntroSig === 'string' ? dmLinkProof.dmIntroSig.trim() : ''
		if ((n.length > 0) !== (s.length > 0))
			throw new Error('dmIntroNonce and dmIntroSig must be provided together')
		if (n.length > 0) {
			body.dmIntroNonce = n
			body.dmIntroSig = s.replace(/^0x/iu, '')
		}
	}
	const response = await fetch('/api/parts/shells:chat/groups/new', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(body),
	})
	const data = await response.json()
	if (!response.ok)
		throw new Error(data.error || 'Failed to create keyed DM')
	return data
}

/**
 * 用户名 DM：`POST …/groups/new` + `template: dm`（§14，无独立 `/dm`）。
 * @param {string} targetUsername 对端登录名
 * @returns {Promise<object>} 服务端 JSON（含 `groupId` 等）
 */
export async function createDirectMessageByUsername(targetUsername) {
	const response = await fetch('/api/parts/shells:chat/groups/new', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ template: 'dm', targetUsername: String(targetUsername || '').trim() }),
	})
	const data = await response.json()
	if (!response.ok)
		throw new Error(data.error || 'Failed to create username DM')
	return data
}

/**
 * 拉取当前用户聊天书签条目（`GET …/bookmarks`）。
 * @returns {Promise<object[]>} `entries` 数组
 */
export async function getChatBookmarks() {
	const response = await fetch('/api/parts/shells:chat/bookmarks', { credentials: 'include' })
	const data = await response.json()
	if (!response.ok)
		throw new Error('Failed to fetch bookmarks')
	return Array.isArray(data) ? data : []
}

/**
 * 获取群组详情
 * @param {string} groupId - 群组ID
 * @returns {Promise<object>} 群组状态
 */
export async function getGroupState(groupId) {
	const response = await fetch(`/api/parts/shells:chat/groups/${groupId}/state`, {
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include'
	})

	const data = await response.json()
	if (!response.ok) 
		throw new Error(data.error || 'Failed to fetch group state')
	

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
	const response = await fetch(`/api/parts/shells:chat/groups/${groupId}/channels/${channelId}/messages`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ content: typeof content === 'string' ? { text: content } : content })
	})

	const data = await response.json()
	if (!response.ok) 
		throw new Error(data.error || 'Failed to send message')
	
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

	const response = await fetch(`/api/parts/shells:chat/groups/${groupId}/channels/${channelId}/messages?${params}`, {
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include'
	})

	const data = await response.json()
	if (!response.ok) 
		throw new Error(data.error || 'Failed to fetch messages')
	

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
 * 注入群组弹窗样式（自 group-ui.css），避免在模板字符串中内嵌 `<style>`。
 */
function ensureGroupUiCssLink() {
	if (typeof document === 'undefined') return
	if (document.getElementById('fount-group-ui-css')) return
	const l = document.createElement('link')
	l.id = 'fount-group-ui-css'
	l.rel = 'stylesheet'
	l.href = '/parts/shells:chat/group-ui.css'
	document.head.appendChild(l)
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

	ensureGroupUiCssLink()
	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `
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
							<label class="cg-radio-card active" data-policy="invite-only">
								<input type="radio" name="joinPolicy" value="invite-only" checked style="display:none" />
								<div class="name">🔒 仅邀请</div>
								<div class="desc">需要邀请码才能加入</div>
							</label>
							<label class="cg-radio-card" data-policy="pow">
								<input type="radio" name="joinPolicy" value="pow" style="display:none" />
								<div class="name">⛏️ 工作量证明</div>
								<div class="desc">加入前需完成 PoW 挑战</div>
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
			const { groupId, defaultChannelId } = await createGroup(name, description)

			try {
				await fetch(`/api/parts/shells:chat/groups/${groupId}/settings`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ joinPolicy })
				})
			}
			catch (e) {
				console.error('update joinPolicy failed', e)
			}

			// 更新 @everyone 角色权限
			const permissions = {}
			for (const perm of ALL_PERMISSIONS) {
				const cb = modal.querySelector(`input[name="grp-perm-${perm}"]`)
				if (cb && cb.checked) permissions[perm] = true
			}
			await fetch(`/api/parts/shells:chat/groups/${groupId}/roles/${encodeURIComponent('@everyone')}/permissions`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ permission: '__bulk__', permissions })
			})

			modal.close()
			modal.remove()
			window.location.href = `/parts/shells:chat/hub/#group:${groupId}:${defaultChannelId}`
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
	window.location.href = `/parts/shells:chat/hub/#group:${groupId}:default`
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
 * 通过群组 ID 加入群组
 */
export function joinGroupById() {
	ensureGroupUiCssLink()
	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `
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
		const hash = id.startsWith('group:') ? id : `group:${id}:default`
		window.location.href = `/parts/shells:chat/hub/#${hash}`
	})
	modal.addEventListener('close', () => modal.remove())
}

/**
 *
 */
export { buildDmLinkSignableBytes, createDmLink, formatDmLinkUrl, getDmLinkNonce, rotateDmLink } from './dmLink.mjs'

// 全局函数暴露
window.showCreateGroupModal = showCreateGroupModal
window.openGroup = openGroup
window.joinGroupById = joinGroupById
