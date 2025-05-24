import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import * as api from './src/public/endpoints.mjs'

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
	logoutBtn: document.getElementById('logoutBtn'), // 新增：登出按钮
	deleteAccountBtn: document.getElementById('deleteAccountBtn'),
	passwordConfirmationModal: document.getElementById('passwordConfirmationModal'),
	confirmationPasswordInput: document.getElementById('confirmationPassword'),
	confirmPasswordBtn: document.getElementById('confirmPasswordBtn'),
	cancelPasswordBtn: document.getElementById('cancelPasswordBtn'),
	alertContainer: document.getElementById('alertContainer'),
}

let passwordConfirmationContext = { resolve: null, reject: null }

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
		passwordConfirmationContext = { resolve, reject }
		el.confirmationPasswordInput.value = ''
		el.passwordConfirmationModal.showModal()
		el.confirmationPasswordInput.focus()
	})
}

el.confirmPasswordBtn.addEventListener('click', () => {
	passwordConfirmationContext.resolve?.(el.confirmationPasswordInput.value)
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
		if (!stats.success) throw new Error(stats.message || geti18n('userSettings.apiError', {message: 'Failed to load user info'}))

		el.userInfoUsername.textContent = stats.username
		el.userInfoCreationDate.textContent = new Date(stats.creationDate).toLocaleDateString()
		el.userInfoFolderSize.textContent = stats.folderSize
		el.userInfoFolderPath.textContent = stats.folderPath
	} catch (error) {
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
}

el.copyFolderPathBtn.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(el.userInfoFolderPath.textContent)
		showAlert('userSettings.userInfo.copiedAlert', 'success')
	} catch(err) {
		console.error('Failed to copy path: ', err)
		showAlert('userSettings.generalError', 'error', 5000, { message: 'Failed to copy path.'})
	}
})

el.changePasswordForm.addEventListener('submit', async (event) => {
	event.preventDefault()
	const form = event.target
	const currentPassword = form.currentPassword.value
	const newPassword = form.newPassword.value
	const confirmNewPassword = form.confirmNewPassword.value

	if (newPassword !== confirmNewPassword)
		return showAlert('userSettings.changePassword.errorMismatch', 'error')

	try {
		const result = await api.changePassword(currentPassword, newPassword)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', {message: 'Password change failed'}))

		showAlert('userSettings.changePassword.success', 'success')
		form.reset()
	} catch (error) {
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})

el.renameUserForm.addEventListener('submit', async (event) => {
	event.preventDefault()
	const form = event.target
	const newUsername = form.newUsernameRename.value.trim()
	if (!newUsername) return

	if (!confirm(geti18n('userSettings.renameUser.confirmMessage'))) return

	try {
		const password = await requestPasswordConfirmation()
		const result = await api.renameUser(newUsername, password)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', {message: 'Rename user failed'}))

		showAlert('userSettings.renameUser.success', 'success', 5000, { newUsername })
		form.reset()
		setTimeout(() => window.location.href = '/login', 2000)
	} catch (error) {
		if (error.message.includes('cancelled') || error.message.includes('closed')) return
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})

async function loadAndDisplayDevices() {
	el.deviceList.innerHTML = '<div class="text-center py-4"><span class="loading loading-dots loading-md"></span></div>'
	el.noDevicesText.classList.add('hidden')

	try {
		const result = await api.getDevices()
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', {message: 'Failed to load devices'}))

		el.deviceList.innerHTML = ''
		if (result.devices.length === 0) {
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
					if (!confirm(geti18n('userSettings.userDevices.revokeConfirm'))) return
					try {
						const password = await requestPasswordConfirmation()
						const revokeResult = await api.revokeDevice(device.jti, password)
						if (!revokeResult.success) throw new Error(revokeResult.message || geti18n('userSettings.apiError', {message: 'Revoke failed'}))
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
	} catch (error) {
		el.deviceList.innerHTML = ''
		el.noDevicesText.classList.remove('hidden')
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
}

el.refreshDevicesBtn.addEventListener('click', loadAndDisplayDevices)

// 新增：登出处理函数
el.logoutBtn.addEventListener('click', async () => {
	// 通常登出不需要二次确认，但如果需要可以取消下面的注释
	// if (!confirm(geti18n('userSettings.logout.confirmMessage'))) return;

	try {
		const result = await api.logoutUser() // 调用新的API端点
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', {message: 'Logout failed'}))

		// 登出成功，显示短暂消息并重定向
		showAlert('userSettings.logout.successMessage', 'success', 2000)
		setTimeout(() => {
			window.location.href = '/login' // 重定向到登录页面
		}, 1500) // 延迟一点以便用户看到消息

	} catch (error) {
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})


el.deleteAccountBtn.addEventListener('click', async () => {
	if (!confirm(geti18n('userSettings.deleteAccount.confirmMessage1'))) return

	const usernameToConfirm = el.userInfoUsername.textContent
	const enteredUsername = prompt(geti18n('userSettings.deleteAccount.confirmMessage2', { username: usernameToConfirm }))

	if (enteredUsername === null) return
	if (enteredUsername !== usernameToConfirm)
		return showAlert('userSettings.deleteAccount.usernameMismatch', 'error')

	try {
		const password = await requestPasswordConfirmation()
		const result = await api.deleteAccount(password)
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', {message: 'Delete account failed'}))

		showAlert('userSettings.deleteAccount.success', 'success', 5000)
		setTimeout(() => window.location.href = '/login', 3000)
	} catch (error) {
		if (error.message.includes('cancelled') || error.message.includes('closed')) return
		showAlert('userSettings.generalError', 'error', 5000, { message: error.message })
	}
})

async function initializeApp() {
	await initTranslations('userSettings')
	applyTheme()

	await loadUserInfo()
	await loadAndDisplayDevices()
}

initializeApp().catch(error => {
	console.error('Error initializing User Settings shell:', error)
	showAlert('userSettings.generalError', 'error', 0, { message: 'Initialization failed: ' + error.message })
})
