/**
 * 用户设置 shell 的客户端逻辑。
 */
import { getApiKeys, createApiKey, revokeApiKey, logout } from '../../scripts/endpoints.mjs'
import { initTranslations, geti18n, promptI18n, confirmI18n, console } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToastI18n } from '../../scripts/toast.mjs'

import { getUserStats, changePassword, renameUser, deleteAccount, getDevices, revokeDevice } from './src/endpoints.mjs'

const REFRESH_TOKEN_EXPIRY_DURATION_STRING = 30 * 24 * 60 * 60 * 1000 // '30d'

// DOM 元素引用
const userInfoUsername = document.getElementById('userInfoUsername')
const userInfoCreationDate = document.getElementById('userInfoCreationDate')
const userInfoFolderSize = document.getElementById('userInfoFolderSize')
const userInfoFolderPath = document.getElementById('userInfoFolderPath')
const copyFolderPathBtn = document.getElementById('copyFolderPathBtn')
const changePasswordForm = document.getElementById('changePasswordForm')
const renameUserForm = document.getElementById('renameUserForm')
const deviceList = document.getElementById('deviceList')
const noDevicesText = document.getElementById('noDevicesText')
const refreshDevicesBtn = document.getElementById('refreshDevicesBtn')
const logoutBtn = document.getElementById('logoutBtn')
const deleteAccountBtn = document.getElementById('deleteAccountBtn')
const passwordConfirmationModal = document.getElementById('passwordConfirmationModal')
const confirmationPasswordInput = document.getElementById('confirmationPassword')
const confirmPasswordBtn = document.getElementById('confirmPasswordBtn')
const cancelPasswordBtn = document.getElementById('cancelPasswordBtn')
// API Key elements
const createApiKeyForm = document.getElementById('createApiKeyForm')
const apiKeyList = document.getElementById('apiKeyList')
const noApiKeysText = document.getElementById('noApiKeysText')
const refreshApiKeysBtn = document.getElementById('refreshApiKeysBtn')
const newApiKeyModal = document.getElementById('newApiKeyModal')
const newApiKeyInput = document.getElementById('newApiKeyInput')
const copyNewApiKeyBtn = document.getElementById('copyNewApiKeyBtn')

let passwordConfirmationContext = { resolve: null, reject: null }
let cachedPassword = null // 用于短期缓存密码
let passwordCacheTimeoutId = null // 用于存储 setTimeout 的 ID

const PASSWORD_CACHE_DURATION = 3 * 60 * 1000 // 3分钟

/**
 * 请求密码确认。
 * @returns {Promise<string>} - 确认的密码。
 */
function requestPasswordConfirmation() {
	return new Promise((resolve, reject) => {
		// 检查是否有缓存的密码
		if (cachedPassword) {
			console.log('Using cached password.')
			resolve(cachedPassword)
			return
		}

		passwordConfirmationContext = { resolve, reject }
		confirmationPasswordInput.value = ''
		passwordConfirmationModal.showModal()
		confirmationPasswordInput.focus()
	})
}

confirmPasswordBtn.addEventListener('click', () => {
	const password = confirmationPasswordInput.value
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

	passwordConfirmationModal.close()
})

cancelPasswordBtn.addEventListener('click', () => {
	passwordConfirmationContext.reject?.(new Error('Password confirmation cancelled by user.'))
	passwordConfirmationModal.close()
})

passwordConfirmationModal.addEventListener('close', () => {
	if (passwordConfirmationModal.returnValue !== 'confirmed_via_button_logic_which_is_not_set')
		passwordConfirmationContext.reject?.(new Error('Password confirmation dialog closed.'))

	passwordConfirmationContext = { resolve: null, reject: null }
})

/**
 * 加载用户信息。
 * @returns {Promise<void>}
 */
async function loadUserInfo() {
	try {
		const stats = await getUserStats()
		if (!stats.success) throw new Error(stats.message || geti18n('userSettings.apiError', { message: 'Failed to load user info' }))

		userInfoUsername.textContent = stats.username
		userInfoCreationDate.textContent = new Date(stats.creationDate).toLocaleDateString()
		userInfoFolderSize.textContent = stats.folderSize
		userInfoFolderPath.textContent = stats.folderPath
	}
	catch (error) {
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
}

copyFolderPathBtn.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(userInfoFolderPath.textContent)
		showToastI18n('success', 'userSettings.userInfo.copiedAlert')
	}
	catch (err) {
		console.error('Failed to copy path: ', err)
		showToastI18n('error', 'userSettings.generalError', { message: 'Failed to copy path.' })
	}
})

changePasswordForm.addEventListener('submit', async event => {
	event.preventDefault()
	const form = event.target
	const currentPassword = form.currentPassword.value
	const newPassword = form.newPassword.value
	const confirmNewPassword = form.confirmNewPassword.value

	if (newPassword !== confirmNewPassword)
		return showToastI18n('error', 'userSettings.changePassword.errorMismatch')

	try {
		const result = await changePassword(currentPassword, newPassword)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Password change failed' }))

		showToastI18n('success', 'userSettings.changePassword.success')
		form.reset()
	}
	catch (error) {
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
})

renameUserForm.addEventListener('submit', async event => {
	event.preventDefault()
	const form = event.target
	const newUsername = form.newUsernameRename.value.trim()
	if (!newUsername) return

	if (!confirmI18n('userSettings.renameUser.confirmMessage')) return

	try {
		const password = await requestPasswordConfirmation()
		const result = await renameUser(newUsername, password)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Rename user failed' }))

		showToastI18n('success', 'userSettings.renameUser.success', { newUsername })
		form.reset()
		setTimeout(() => window.location.href = '/login', 2000)
	}
	catch (error) {
		if (error.message.includes('cancelled') || error.message.includes('closed')) return
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
})

/**
 * 加载并显示设备。
 * @returns {Promise<void>}
 */
async function loadAndDisplayDevices() {
	deviceList.innerHTML = /* html */ '<div class="text-center py-4"><span class="loading loading-dots loading-md"></span></div>'
	noDevicesText.classList.add('hidden')

	try {
		const result = await getDevices()
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Failed to load devices' }))

		deviceList.innerHTML = ''
		if (!result.devices.length) {
			noDevicesText.classList.remove('hidden')
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
				mainText += /* html */ ` <span class="badge badge-xs badge-success badge-outline">${geti18n('userSettings.userDevices.thisDevice')}</span>`

			deviceInfoDiv.innerHTML = /* html */ `<strong class="block text-sm">${mainText}</strong>`

			const lastSeenDate = new Date(device.lastSeen || (device.expiry - REFRESH_TOKEN_EXPIRY_DURATION_STRING))
			const detailsText = geti18n('userSettings.userDevices.deviceDetails', {
				lastSeen: lastSeenDate.toLocaleString(),
				ipAddress: device.ipAddress || 'N/A',
				userAgent: device.userAgent ? device.userAgent.length > 50 ? device.userAgent.substring(0, 47) + '...' : device.userAgent : 'N/A'
			})
			deviceInfoDiv.innerHTML += /* html */ `<small class="block text-xs opacity-70">${detailsText}</small>`
			li.appendChild(deviceInfoDiv)

			if (device.jti !== currentRefreshTokenJtiClient) {
				const revokeButton = document.createElement('button')
				revokeButton.className = 'btn btn-xs btn-error btn-outline self-start sm:self-center'
				revokeButton.dataset.i18n = 'userSettings.userDevices.revokeButton'
				/**
				 * 撤销按钮点击事件处理程序。
				 */
				revokeButton.onclick = async () => {
					if (confirmI18n('userSettings.userDevices.revokeConfirm')) try {
						const password = await requestPasswordConfirmation()
						const revokeResult = await revokeDevice(device.jti, password)
						if (!revokeResult.success) throw new Error(revokeResult.message || geti18n('userSettings.apiError', { message: 'Revoke failed' }))
						showToastI18n('success', 'userSettings.userDevices.revokeSuccess')
						loadAndDisplayDevices()
					} catch (error) {
						if (error.message.includes('cancelled') || error.message.includes('closed')) return
						showToastI18n('error', 'userSettings.generalError', { message: error.message })
					}
				}
				li.appendChild(revokeButton)
			}
			deviceList.appendChild(li)
		})
	}
	catch (error) {
		deviceList.innerHTML = ''
		noDevicesText.classList.remove('hidden')
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
}

refreshDevicesBtn.addEventListener('click', loadAndDisplayDevices)

// 登出处理函数
logoutBtn.addEventListener('click', async () => {
	if (!confirmI18n('userSettings.logout.confirmMessage')) return
	try {
		const result = await logout() // 调用新的API端点
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Logout failed' }))

		// 登出成功，显示短暂消息并重定向
		showToastI18n('success', 'userSettings.logout.successMessage', {}, 2000)
		setTimeout(() => {
			window.location.href = '/login' // 重定向到登录页面
		}, 1500) // 延迟一点以便用户看到消息
	}
	catch (error) {
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
})


deleteAccountBtn.addEventListener('click', async () => {
	if (!confirmI18n('userSettings.deleteAccount.confirmMessage1')) return

	const usernameToConfirm = userInfoUsername.textContent
	const enteredUsername = promptI18n('userSettings.deleteAccount.confirmMessage2', { username: usernameToConfirm })

	if (enteredUsername === null) return
	if (enteredUsername !== usernameToConfirm)
		return showToastI18n('error', 'userSettings.deleteAccount.usernameMismatch')

	try {
		const password = await requestPasswordConfirmation()
		const result = await deleteAccount(password)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Delete account failed' }))

		showToastI18n('success', 'userSettings.deleteAccount.success')
		setTimeout(() => window.location.href = '/login', 3000)
	}
	catch (error) {
		if (error.message.includes('cancelled') || error.message.includes('closed')) return
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
})

/**
 * 加载并显示 API 密钥。
 * @returns {Promise<void>}
 */
async function loadAndDisplayApiKeys() {
	apiKeyList.innerHTML = /* html */ '<div class="text-center py-4"><span class="loading loading-dots loading-md"></span></div>'
	noApiKeysText.classList.add('hidden')

	try {
		const result = await getApiKeys()
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Get API keys failed' }))

		apiKeyList.innerHTML = ''
		if (!result.apiKeys.length) {
			noApiKeysText.classList.remove('hidden')
			return
		}

		result.apiKeys.sort((a, b) => b.createdAt - a.createdAt).forEach(key => {
			const li = document.createElement('li')
			li.className = 'p-3 bg-base-100 rounded-lg shadow flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2'

			const keyInfoDiv = document.createElement('div')
			keyInfoDiv.innerHTML = /* html */ `<strong class="block text-sm font-mono">${key.prefix}...</strong>`

			const detailsText = geti18n('userSettings.apiKeys.keyDetails', {
				description: key.description || 'N/A',
				createdAt: new Date(key.createdAt).toLocaleString(),
				lastUsed: key.lastUsed ? new Date(key.lastUsed).toLocaleString() : geti18n('userSettings.apiKeys.neverUsed'),
			})
			keyInfoDiv.innerHTML += /* html */ `<small class="block text-xs opacity-70">${detailsText.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</small>`
			li.appendChild(keyInfoDiv)

			const revokeButton = document.createElement('button')
			revokeButton.className = 'btn btn-xs btn-error btn-outline self-start sm:self-center'
			revokeButton.dataset.i18n = 'userSettings.apiKeys.revokeButton'
			/**
			 * 撤销按钮点击事件处理程序。
			 */
			revokeButton.onclick = async () => {
				if (confirmI18n('userSettings.apiKeys.revokeConfirm')) try {
					const password = await requestPasswordConfirmation()
					const revokeResult = await revokeApiKey(key.jti, password)
					if (!revokeResult.success)
						throw new Error(revokeResult.message || geti18n('userSettings.apiError', { message: 'revoke failed' }))

					showToastI18n('success', 'userSettings.apiKeys.revokeSuccess')
					loadAndDisplayApiKeys()
				} catch (error) {
					if (error.message.includes('cancelled') || error.message.includes('closed')) return
					showToastI18n('error', 'userSettings.generalError', { message: error.message })
				}
			}
			li.appendChild(revokeButton)
			apiKeyList.appendChild(li)
		})
	}
	catch (error) {
		apiKeyList.innerHTML = ''
		noApiKeysText.classList.remove('hidden')
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
}

refreshApiKeysBtn.addEventListener('click', loadAndDisplayApiKeys)

createApiKeyForm.addEventListener('submit', async (event) => {
	event.preventDefault()
	const form = event.target
	const description = form.newApiKeyDescription.value.trim()
	if (!description) return showToastI18n('error', 'userSettings.apiKeys.errorDescriptionRequired')

	try {
		const result = await createApiKey(description)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Create API key failed' }))

		newApiKeyInput.value = result.apiKey
		newApiKeyModal.showModal()
		showToastI18n('success', 'userSettings.apiKeys.createSuccess')
		form.reset()
		loadAndDisplayApiKeys()
	}
	catch (error) {
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
})

copyNewApiKeyBtn.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(newApiKeyInput.value)
		showToastI18n('success', 'userSettings.newApiKey.copiedAlert')
	}
	catch (err) {
		console.error('Failed to copy API key: ', err)
		showToastI18n('error', 'userSettings.generalError', { message: 'Failed to copy API key.' })
	}
})


/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function initializeApp() {
	await initTranslations('userSettings')
	applyTheme()

	await loadUserInfo()
	await loadAndDisplayDevices()
	await loadAndDisplayApiKeys()
}

initializeApp().catch(error => {
	console.error('Error initializing User Settings shell:', error)
	showToastI18n('error', 'userSettings.generalError', { message: 'Initialization failed: ' + error.message })
})
