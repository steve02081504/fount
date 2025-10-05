import { initTranslations, geti18n, promptI18n, confirmI18n, console } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

import * as api from './src/endpoints.mjs'

const REFRESH_TOKEN_EXPIRY_DURATION_STRING = 30 * 24 * 60 * 60 * 1000 // '30d'

const el = { // DOM 元素引用
	userInfoUsername: document.getElementById('userInfoUsername'),
	userInfoCreationDate: document.getElementById('userInfoCreationDate'),
	userInfoFolderSize: document.getElementById('userInfoFolderSize'),
	userInfoFolderPath: document.getElementById('userInfoFolderPath'),
	copyFolderPathBtn: document.getElementById('copyFolderPathBtn'),
	changePasswordForm: document.getElementById('changePasswordForm'),
	renameUserForm: document.getElementById('renameUserForm'),
	deviceListContainer: document.getElementById('deviceListContainer'),
	deviceList: document.getElementById('deviceList'),
	noDevicesText: document.getElementById('noDevicesText'),
	refreshDevicesBtn: document.getElementById('refreshDevicesBtn'),
	logoutBtn: document.getElementById('logoutBtn'),
	deleteAccountBtn: document.getElementById('deleteAccountBtn'),
	passwordConfirmationModal: document.getElementById('passwordConfirmationModal'),
	confirmationPasswordInput: document.getElementById('confirmationPassword'),
	confirmPasswordBtn: document.getElementById('confirmPasswordBtn'),
	cancelPasswordBtn: document.getElementById('cancelPasswordBtn'),
	alertContainer: document.getElementById('alertContainer'),
	// API Key elements
	createApiKeyForm: document.getElementById('createApiKeyForm'),
	apiKeyListContainer: document.getElementById('apiKeyListContainer'),
	apiKeyList: document.getElementById('apiKeyList'),
	noApiKeysText: document.getElementById('noApiKeysText'),
	refreshApiKeysBtn: document.getElementById('refreshApiKeysBtn'),
	newApiKeyModal: document.getElementById('newApiKeyModal'),
	newApiKeyInput: document.getElementById('newApiKeyInput'),
	copyNewApiKeyBtn: document.getElementById('copyNewApiKeyBtn'),
}

let passwordConfirmationContext = { resolve: null, reject: null }
let cachedPassword = null // 用于短期缓存密码
let passwordCacheTimeoutId = null // 用于存储 setTimeout 的 ID

const PASSWORD_CACHE_DURATION = 3 * 60 * 1000 // 3分钟

// 辅助函数：显示提示消息
function showAlert(messageKey, type = 'info', duration = 4000, interpolateParams = {}) {
	const message = geti18n(messageKey, interpolateParams)
	const alertId = `alert-${Date.now()}`
	const alertDiv = document.createElement('div')
	alertDiv.id = alertId
	alertDiv.className = `alert alert-${type} shadow-lg`
	alertDiv.innerHTML = `<div><span>${message}</span></div>`
	el.alertContainer.appendChild(alertDiv)
	setTimeout(() => document.getElementById(alertId)?.remove(), duration)
}

// 辅助函数：请求密码确认
function requestPasswordConfirmation() {
	return new Promise((resolve, reject) => {
		// 检查是否有缓存的密码
		if (cachedPassword) {
			console.log('Using cached password.')
			resolve(cachedPassword)
			return
		}

		passwordConfirmationContext = { resolve, reject }
		el.confirmationPasswordInput.value = ''
		el.passwordConfirmationModal.showModal()
		el.confirmationPasswordInput.focus()
	})
}

el.confirmPasswordBtn.addEventListener('click', () => {
	const password = el.confirmationPasswordInput.value
	passwordConfirmationContext.resolve?.(password)
	// 缓存密码
	cachedPassword = password

	// 清除之前的定时器（如果存在）
	if (passwordCacheTimeoutId)
		clearTimeout(passwordCacheTimeoutId)

	// 设置新的定时器，在3分钟后清除缓存密码
	passwordCacheTimeoutId = setTimeout(() => {
		cachedPassword = null
		passwordCacheTimeoutId = null
	}, PASSWORD_CACHE_DURATION)

	el.passwordConfirmationModal.close()
})

el.cancelPasswordBtn.addEventListener('click', () => {
	passwordConfirmationContext.reject?.(new Error('Password confirmation cancelled by user.'))
	el.passwordConfirmationModal.close()
})

el.passwordConfirmationModal.addEventListener('close', () => {
	if (el.passwordConfirmationModal.returnValue !== 'confirmed_via_button_logic_which_is_not_set')
		passwordConfirmationContext.reject?.(new Error('Password confirmation dialog closed.'))

	passwordConfirmationContext = { resolve: null, reject: null }
})

async function loadUserInfo() {
	try {
		const stats = await api.getUserStats()
		if (!stats.success) throw new Error(stats.message || geti18n('userSettings.apiError', { message: 'Failed to load user info' }))

		el.userInfoUsername.textContent = stats.username
		el.userInfoCreationDate.textContent = new Date(stats.creationDate).toLocaleDateString()
		el.userInfoFolderSize.textContent = stats.folderSize
		el.userInfoFolderPath.textContent = stats.folderPath
	}
	catch (error) {
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
}

el.copyFolderPathBtn.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(el.userInfoFolderPath.textContent)
		showAlert('userSettings.userInfo.copiedAlert', 'success')
	}
	catch (err) {
		console.error('Failed to copy path: ', err)
		showAlert('userSettings.generalError', 'error', 5000, { message: 'Failed to copy path.' })
	}
})

el.changePasswordForm.addEventListener('submit', async event => {
	event.preventDefault()
	const form = event.target
	const currentPassword = form.currentPassword.value
	const newPassword = form.newPassword.value
	const confirmNewPassword = form.confirmNewPassword.value

	if (newPassword !== confirmNewPassword)
		return showAlert('userSettings.changePassword.errorMismatch', 'error')

	try {
		const result = await api.changePassword(currentPassword, newPassword)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Password change failed' }))

		showAlert('userSettings.changePassword.success', 'success')
		form.reset()
	}
	catch (error) {
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})

el.renameUserForm.addEventListener('submit', async event => {
	event.preventDefault()
	const form = event.target
	const newUsername = form.newUsernameRename.value.trim()
	if (!newUsername) return

	if (!confirmI18n('userSettings.renameUser.confirmMessage')) return

	try {
		const password = await requestPasswordConfirmation()
		const result = await api.renameUser(newUsername, password)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Rename user failed' }))

		showAlert('userSettings.renameUser.success', 'success', 5000, { newUsername })
		form.reset()
		setTimeout(() => window.location.href = '/login', 2000)
	}
	catch (error) {
		if (error.message.includes('cancelled') || error.message.includes('closed')) return
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})

async function loadAndDisplayDevices() {
	el.deviceList.innerHTML = '<div class="text-center py-4"><span class="loading loading-dots loading-md"></span></div>'
	el.noDevicesText.classList.add('hidden')

	try {
		const result = await api.getDevices()
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Failed to load devices' }))

		el.deviceList.innerHTML = ''
		if (!result.devices.length) {
			el.noDevicesText.classList.remove('hidden')
			return
		}

		let currentRefreshTokenJtiClient = null
		try {
			const refreshTokenCookie = document.cookie.split('; ').find(row => row.startsWith('refreshToken='))
			if (refreshTokenCookie) {
				const tokenValue = refreshTokenCookie.split('=')[1]
				const payload = JSON.parse(atob(tokenValue.split('.')[1]))
				currentRefreshTokenJtiClient = payload.jti
			}
		} catch (e) { /* Quietly ignore */ }

		result.devices.forEach(device => {
			const li = document.createElement('li')
			li.className = 'p-3 bg-base-100 rounded-lg shadow flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2'

			const deviceInfoDiv = document.createElement('div')
			const deviceIdText = geti18n('userSettings.userDevices.deviceInfo', { deviceId: device.deviceId })

			let mainText = `${deviceIdText}`
			if (device.jti === currentRefreshTokenJtiClient)
				mainText += ` <span class="badge badge-xs badge-success badge-outline">${geti18n('userSettings.userDevices.thisDevice')}</span>`

			deviceInfoDiv.innerHTML = `<strong class="block text-sm">${mainText}</strong>`

			const lastSeenDate = new Date(device.lastSeen || (device.expiry - REFRESH_TOKEN_EXPIRY_DURATION_STRING))
			const detailsText = geti18n('userSettings.userDevices.deviceDetails', {
				lastSeen: lastSeenDate.toLocaleString(),
				ipAddress: device.ipAddress || 'N/A',
				userAgent: device.userAgent ? device.userAgent.length > 50 ? device.userAgent.substring(0, 47) + '...' : device.userAgent : 'N/A'
			})
			deviceInfoDiv.innerHTML += `<small class="block text-xs opacity-70">${detailsText}</small>`
			li.appendChild(deviceInfoDiv)

			if (device.jti !== currentRefreshTokenJtiClient) {
				const revokeButton = document.createElement('button')
				revokeButton.className = 'btn btn-xs btn-error btn-outline self-start sm:self-center'
				revokeButton.dataset.i18n = 'userSettings.userDevices.revokeButton'
				revokeButton.textContent = geti18n('userSettings.userDevices.revokeButton')
				revokeButton.onclick = async () => {
					if (confirmI18n('userSettings.userDevices.revokeConfirm')) try {
						const password = await requestPasswordConfirmation()
						const revokeResult = await api.revokeDevice(device.jti, password)
						if (!revokeResult.success) throw new Error(revokeResult.message || geti18n('userSettings.apiError', { message: 'Revoke failed' }))
						showAlert('userSettings.userDevices.revokeSuccess', 'success')
						loadAndDisplayDevices()
					} catch (error) {
						if (error.message.includes('cancelled') || error.message.includes('closed')) return
						showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
					}
				}
				li.appendChild(revokeButton)
			}
			el.deviceList.appendChild(li)
		})
	}
	catch (error) {
		el.deviceList.innerHTML = ''
		el.noDevicesText.classList.remove('hidden')
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
}

el.refreshDevicesBtn.addEventListener('click', loadAndDisplayDevices)

// 登出处理函数
el.logoutBtn.addEventListener('click', async () => {
	if (!confirmI18n('userSettings.logout.confirmMessage')) return
	try {
		const result = await api.logoutUser() // 调用新的API端点
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Logout failed' }))

		// 登出成功，显示短暂消息并重定向
		showAlert('userSettings.logout.successMessage', 'success', 2000)
		setTimeout(() => {
			window.location.href = '/login' // 重定向到登录页面
		}, 1500) // 延迟一点以便用户看到消息
	}
	catch (error) {
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})


el.deleteAccountBtn.addEventListener('click', async () => {
	if (!confirmI18n('userSettings.deleteAccount.confirmMessage1')) return

	const usernameToConfirm = el.userInfoUsername.textContent
	const enteredUsername = promptI18n('userSettings.deleteAccount.confirmMessage2', { username: usernameToConfirm })

	if (enteredUsername === null) return
	if (enteredUsername !== usernameToConfirm)
		return showAlert('userSettings.deleteAccount.usernameMismatch', 'error')

	try {
		const password = await requestPasswordConfirmation()
		const result = await api.deleteAccount(password)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Delete account failed' }))

		showAlert('userSettings.deleteAccount.success', 'success', 5000)
		setTimeout(() => window.location.href = '/login', 3000)
	}
	catch (error) {
		if (error.message.includes('cancelled') || error.message.includes('closed')) return
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})

// --- API Key Management ---

async function loadAndDisplayApiKeys() {
	el.apiKeyList.innerHTML = '<div class="text-center py-4"><span class="loading loading-dots loading-md"></span></div>'
	el.noApiKeysText.classList.add('hidden')

	try {
		const result = await api.getApiKeys()
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Get API keys failed' }))

		el.apiKeyList.innerHTML = ''
		if (!result.apiKeys.length) {
			el.noApiKeysText.classList.remove('hidden')
			return
		}

		result.apiKeys.sort((a, b) => b.createdAt - a.createdAt).forEach(key => {
			const li = document.createElement('li')
			li.className = 'p-3 bg-base-100 rounded-lg shadow flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2'

			const keyInfoDiv = document.createElement('div')
			keyInfoDiv.innerHTML = `<strong class="block text-sm font-mono">${key.prefix}...</strong>`

			const detailsText = geti18n('userSettings.apiKeys.keyDetails', {
				description: key.description || 'N/A',
				createdAt: new Date(key.createdAt).toLocaleString(),
				lastUsed: key.lastUsed ? new Date(key.lastUsed).toLocaleString() : geti18n('userSettings.apiKeys.neverUsed'),
			})
			keyInfoDiv.innerHTML += `<small class="block text-xs opacity-70">${detailsText.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</small>`
			li.appendChild(keyInfoDiv)

			const revokeButton = document.createElement('button')
			revokeButton.className = 'btn btn-xs btn-error btn-outline self-start sm:self-center'
			revokeButton.dataset.i18n = 'userSettings.apiKeys.revokeButton'
			revokeButton.textContent = geti18n('userSettings.apiKeys.revokeButton')
			revokeButton.onclick = async () => {
				if (confirmI18n('userSettings.apiKeys.revokeConfirm')) try {
					const revokeResult = await api.revokeApiKey(key.jti)
					if (!revokeResult.success)
						throw new Error(revokeResult.message || geti18n('userSettings.apiError', { message: 'revoke failed' }))

					showAlert('userSettings.apiKeys.revokeSuccess', 'success')
					loadAndDisplayApiKeys()
				} catch (error) {
					showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
				}
			}
			li.appendChild(revokeButton)
			el.apiKeyList.appendChild(li)
		})
	}
	catch (error) {
		el.apiKeyList.innerHTML = ''
		el.noApiKeysText.classList.remove('hidden')
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
}

el.refreshApiKeysBtn.addEventListener('click', loadAndDisplayApiKeys)

el.createApiKeyForm.addEventListener('submit', async (event) => {
	event.preventDefault()
	const form = event.target
	const description = form.newApiKeyDescription.value.trim()
	if (!description) return showAlert('userSettings.apiKeys.errorDescriptionRequired', 'error')

	try {
		const result = await api.createApiKey(description)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Create API key failed' }))

		el.newApiKeyInput.value = result.apiKey
		el.newApiKeyModal.showModal()
		showAlert('userSettings.apiKeys.createSuccess', 'success')
		form.reset()
		loadAndDisplayApiKeys()
	}
	catch (error) {
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})

el.copyNewApiKeyBtn.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(el.newApiKeyInput.value)
		showAlert('userSettings.newApiKey.copiedAlert', 'success')
	}
	catch (err) {
		console.error('Failed to copy API key: ', err)
		showAlert('userSettings.generalError', 'error', 5000, { message: 'Failed to copy API key.' })
	}
})


async function initializeApp() {
	await initTranslations('userSettings')
	applyTheme()

	await loadUserInfo()
	await loadAndDisplayDevices()
	await loadAndDisplayApiKeys()
}

initializeApp().catch(error => {
	console.error('Error initializing User Settings shell:', error)
	showAlert('userSettings.generalError', 'error', 0, { message: 'Initialization failed: ' + error.message })
})
