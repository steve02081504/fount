import { initTranslations } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import {
	getProfile,
	updateProfile,
	uploadAvatar
} from './src/endpoints.mjs'

let currentUsername = null
let currentProfile = null

/**
 * 初始化个人资料页面
 */
async function init() {
	applyTheme()
	await initTranslations('profile')

	// 获取当前用户
	try {
		const response = await fetch('/api/user/me', {
			credentials: 'include'
		})
		if (response.ok) {
			const data = await response.json()
			if (data.success && data.username) {
				currentUsername = data.username
				await loadProfile(currentUsername)
			} else {
				console.error('Invalid user data:', data)
				showToast('error', '用户数据格式错误')
			}
		} else {
			console.error('Failed to fetch user:', response.status, response.statusText)
			showToast('error', '获取用户信息失败')
		}
	} catch (error) {
		console.error('Failed to get current user:', error)
		showToast('error', '获取用户信息失败')
	}

	setupEventListeners()
	await loadUserGroups()
	await loadUserChannels()
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
	// 编辑按钮
	document.getElementById('edit-btn')?.addEventListener('click', openEditModal)

	// 保存按钮
	document.getElementById('save-profile-btn')?.addEventListener('click', handleSaveProfile)

	// 头像上传
	document.getElementById('avatar-upload')?.addEventListener('change', handleAvatarPreview)
}

/**
 * 加载用户资料
 * @param {string} username - 用户名
 */
async function loadProfile(username) {
	try {
		const response = await getProfile(username)
		if (response.success) {
			currentProfile = response.profile
			renderProfile(currentProfile)
		}
	} catch (error) {
		console.error('Failed to load profile:', error)
		showToast('error', '加载资料失败')
	}
}

/**
 * 渲染用户资料
 * @param {object} profile - 用户资料
 */
function renderProfile(profile) {
	// 头像
	const avatar = document.getElementById('profile-avatar')
	if (profile.avatar) 
		avatar.src = profile.avatar
	 else 
		avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.displayName)}&size=128`
	

	// 基本信息
	document.getElementById('profile-display-name').textContent = profile.displayName
	document.getElementById('profile-username').textContent = `@${profile.username}`
	document.getElementById('profile-bio').textContent = profile.bio || '这个人很懒，什么都没写...'

	// 状态
	const statusBadge = document.getElementById('profile-status-badge')
	const statusText = document.getElementById('profile-status')
	const customStatus = document.getElementById('profile-custom-status')

	statusBadge.className = 'badge gap-2'
	switch (profile.status) {
		case 'online':
			statusBadge.classList.add('badge-success')
			statusText.textContent = '在线'
			break
		case 'away':
			statusBadge.classList.add('badge-warning')
			statusText.textContent = '离开'
			break
		case 'busy':
			statusBadge.classList.add('badge-error')
			statusText.textContent = '忙碌'
			break
		case 'offline':
			statusBadge.classList.add('badge-neutral')
			statusText.textContent = '离线'
			break
	}

	customStatus.textContent = profile.customStatus || ''

	// 社交链接
	renderSocialLinks(profile.social)

	// 邮箱
	const emailRow = document.getElementById('profile-email-row')
	if (profile.email && profile.privacy?.showEmail) {
		document.getElementById('profile-email').textContent = profile.email
		emailRow.classList.remove('hidden')
	} else 
		emailRow.classList.add('hidden')
	

	// 偏好设置
	document.getElementById('profile-language').textContent = profile.preferences.language === 'zh-CN' ? '简体中文' : 'English'
	document.getElementById('profile-theme').textContent = profile.preferences.theme === 'auto' ? '自动' : profile.preferences.theme === 'light' ? '浅色' : '深色'

	// 通知摘要
	const notifs = profile.preferences.notifications || {}
	const notifParts = []
	if (notifs.email) notifParts.push('邮件')
	if (notifs.push) notifParts.push('推送')
	if (notifs.sound) notifParts.push('声音')
	document.getElementById('profile-notifications').textContent = notifParts.length ? notifParts.join(' / ') : '全部关闭'

	const socialCount = [profile.social?.website, profile.social?.github, profile.social?.twitter].filter(Boolean).length
	document.getElementById('summary-username').textContent = `@${profile.username}`
	document.getElementById('summary-status').textContent = profile.status || 'offline'
	document.getElementById('summary-email-visibility').textContent = profile.privacy?.showEmail ? '可见' : '隐藏'
	document.getElementById('summary-theme').textContent = profile.preferences.theme || 'auto'
	document.getElementById('summary-language').textContent = profile.preferences.language || 'zh-CN'
	document.getElementById('summary-social-count').textContent = String(socialCount)

}

/**
 * 渲染社交链接
 * @param {object} social - 社交链接
 */
function renderSocialLinks(social) {
	const container = document.getElementById('social-links')
	container.innerHTML = ''

	if (social.website) 
		container.innerHTML += `
			<a href="${escapeHtml(social.website)}" target="_blank" class="btn btn-circle btn-sm btn-ghost">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
				</svg>
			</a>
		`
	

	if (social.github) 
		container.innerHTML += `
			<a href="https://github.com/${escapeHtml(social.github)}" target="_blank" class="btn btn-circle btn-sm btn-ghost">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
					<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
				</svg>
			</a>
		`
	

	if (social.twitter) 
		container.innerHTML += `
			<a href="https://twitter.com/${escapeHtml(social.twitter)}" target="_blank" class="btn btn-circle btn-sm btn-ghost">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
					<path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
				</svg>
			</a>
		`
	

	if (container.innerHTML === '') 
		container.innerHTML = '<p class="text-sm opacity-50">暂无社交链接</p>'
	
}

/**
 * 打开编辑模态框
 */
function openEditModal() {
	if (!currentProfile) return

	// 填充表单
	const avatarPreview = document.getElementById('edit-avatar-preview')
	if (currentProfile.avatar) 
		avatarPreview.src = currentProfile.avatar
	 else 
		avatarPreview.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentProfile.displayName)}&size=80`
	

	document.getElementById('edit-display-name').value = currentProfile.displayName
	document.getElementById('edit-bio').value = currentProfile.bio || ''
	document.getElementById('edit-email').value = currentProfile.email || ''
	document.getElementById('edit-status').value = currentProfile.status
	document.getElementById('edit-custom-status').value = currentProfile.customStatus || ''

	// 社交链接
	document.getElementById('edit-website').value = currentProfile.social?.website || ''
	document.getElementById('edit-github').value = currentProfile.social?.github || ''
	document.getElementById('edit-twitter').value = currentProfile.social?.twitter || ''

	// 偏好设置
	document.getElementById('edit-language').value = currentProfile.preferences.language
	document.getElementById('edit-theme').value = currentProfile.preferences.theme
	document.getElementById('edit-email-notif').checked = currentProfile.preferences.notifications.email
	document.getElementById('edit-push-notif').checked = currentProfile.preferences.notifications.push
	document.getElementById('edit-sound-notif').checked = currentProfile.preferences.notifications.sound

	document.getElementById('edit-profile-modal').showModal()
}

/**
 * 处理头像预览
 * @param {Event} e - 文件选择事件
 */
function handleAvatarPreview(e) {
	const file = e.target.files[0]
	if (file) {
		const reader = new FileReader()
		/**
		 * 头像文件读取完成，写入预览图。
		 * @param {ProgressEvent<FileReader>} event - FileReader load 事件
		 * @returns {void}
		 */
		reader.onload = (event) => {
			document.getElementById('edit-avatar-preview').src = event.target.result
		}
		reader.readAsDataURL(file)
	}
}

/**
 * 处理保存资料
 */
async function handleSaveProfile() {
	if (!currentUsername) return

	try {
		// 收集表单数据
		const updates = {
			displayName: document.getElementById('edit-display-name').value.trim(),
			bio: document.getElementById('edit-bio').value.trim(),
			email: document.getElementById('edit-email').value.trim(),
			status: document.getElementById('edit-status').value,
			customStatus: document.getElementById('edit-custom-status').value.trim(),
			social: {
				website: document.getElementById('edit-website').value.trim(),
				github: document.getElementById('edit-github').value.trim(),
				twitter: document.getElementById('edit-twitter').value.trim()
			},
			preferences: {
				language: document.getElementById('edit-language').value,
				theme: document.getElementById('edit-theme').value,
				notifications: {
					email: document.getElementById('edit-email-notif').checked,
					push: document.getElementById('edit-push-notif').checked,
					sound: document.getElementById('edit-sound-notif').checked
				}
			},
			privacy: currentProfile?.privacy || {}
		}

		// 处理头像上传
		const avatarFile = document.getElementById('avatar-upload').files[0]
		if (avatarFile) {
			const avatarResponse = await uploadAvatar(currentUsername, avatarFile)
			if (avatarResponse.success) 
				updates.avatar = avatarResponse.avatarUrl
			
		}

		// 更新资料
		const response = await updateProfile(currentUsername, updates)
		if (response.success) {
			showToast('success', '资料保存成功')
			document.getElementById('edit-profile-modal').close()
			currentProfile = response.profile
			renderProfile(currentProfile)

			// 清空文件选择
			document.getElementById('avatar-upload').value = ''
		}
	} catch (error) {
		console.error('Failed to save profile:', error)
		showToast('error', '保存资料失败')
	}
}

/**
 * 转义HTML
 * @param {string} text - 文本
 * @returns {string} 可安全插入 HTML 的转义字符串
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

/**
 * 加载用户的群组列表
 */
async function loadUserGroups() {
	try {
		const response = await fetch('/api/parts/shells:chat/groups/list', {
			credentials: 'include',
		})
		if (!response.ok) return
		const data = await response.json()
		if (!Array.isArray(data)) return

		const groups = data.filter(x => x?.listKind === 'p2p')
		const container = document.getElementById('profile-groups')
		const noGroups = document.getElementById('no-groups')

		if (groups.length === 0) {
			if (noGroups) noGroups.style.display = 'block'
			return
		}

		if (noGroups) noGroups.style.display = 'none'
		container.innerHTML = groups.map(group => `
			<a href="/parts/shells:chat/hub/#group:${group.groupId}:${group.defaultChannelId || 'default'}" class="flex items-center gap-3 bg-base-300/50 rounded-xl px-4 py-3 hover:bg-base-300 transition-colors cursor-pointer">
				<div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
					${escapeHtml((group.name || 'G')[0].toUpperCase())}
				</div>
				<div class="flex-1 min-w-0">
					<div class="font-medium text-sm truncate">${escapeHtml(group.name || group.groupId)}</div>
					<div class="text-xs opacity-50">${escapeHtml(group.desc || '暂无描述')}</div>
					<div class="text-xs opacity-40 mt-0.5">${group.memberCount || 0} 位成员 · ${group.channelCount || 0} 个频道</div>
				</div>
			</a>
		`).join('')
	} catch (error) {
		console.error('Failed to load groups:', error)
	}
}

/**
 * 加载用户的频道列表（从已加入的群组中提取）
 */
async function loadUserChannels() {
	try {
		const response = await fetch('/api/parts/shells:chat/groups/list', {
			credentials: 'include',
		})
		if (!response.ok) return
		const data = await response.json()
		if (!Array.isArray(data)) return

		const groups = data.filter(x => x?.listKind === 'p2p')
		const allChannels = []

		for (const group of groups) 
			try {
				const stateRes = await fetch(`/api/parts/shells:chat/groups/${group.groupId}/state`, {
					credentials: 'include'
				})
				if (!stateRes.ok) continue
				const stateData = await stateRes.json()
				if (!stateData.success || !stateData.state?.channels) continue

				for (const [channelId, channel] of Object.entries(stateData.state.channels)) 
					allChannels.push({
						channelId,
						name: channel.name || channelId,
						type: channel.type || 'text',
						isPrivate: channel.isPrivate || false,
						groupName: group.name || group.groupId,
						groupId: group.groupId
					})
				
			} catch { }
		

		const container = document.getElementById('profile-channels')
		const noChannels = document.getElementById('no-channels')

		if (allChannels.length === 0) {
			if (noChannels) noChannels.style.display = 'block'
			return
		}

		if (noChannels) noChannels.style.display = 'none'
		container.innerHTML = allChannels.map(ch => {
			const icon = ch.type === 'text' ? '#' : ch.type === 'list' ? '📋' : '🔊'
			const typeName = ch.type === 'text' ? '文字频道' : ch.type === 'list' ? '列表频道' : '语音频道'
			return `
			<a href="/parts/shells:chat/hub/#group:${ch.groupId}:${ch.defaultChannelId || 'default'}" class="flex items-center gap-3 bg-base-300/50 rounded-xl px-4 py-3 hover:bg-base-300 transition-colors cursor-pointer">
				<div class="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center text-secondary font-bold text-lg shrink-0">${icon}</div>
				<div class="flex-1 min-w-0">
					<div class="font-medium text-sm truncate">${escapeHtml(ch.name)}</div>
					<div class="text-xs opacity-50">群组: ${escapeHtml(ch.groupName)} · ${typeName}${ch.isPrivate ? ' · 私密' : ''}</div>
				</div>
			</a>`
		}).join('')
	} catch (error) {
		console.error('Failed to load channels:', error)
	}
}

init()
