/**
 * 用户设置 shell 的客户端逻辑。
 */
import { getApiKeys, createApiKey, revokeApiKey, logout } from '../../scripts/endpoints.mjs'
import { initTranslations, geti18n, promptI18n, confirmI18n, console } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { showToastI18n } from '../../scripts/toast.mjs'

import {
	isPasswordConfirmationDialogDismissed,
	showToastForApiPayload,
} from './src/apiFeedback.mjs'
import {
	getUserStats,
	changePassword,
	renameUser,
	deleteAccount,
	getDevices,
	revokeDevice,
	getEditorOpenConfig,
	saveEditorOpenConfig,
} from './src/endpoints.mjs'
import { installPasskeysSection, loadPasskeysList } from './src/passkeysSection.mjs'
import {
	cacheVerifiedPassword,
	invalidateCachedPassword,
	requestPasswordConfirmation,
} from './src/passwordConfirmationRequest.mjs'
import { escapeAttr } from './src/uiEscape.mjs'

usingTemplates('/parts/shells:userSettings/templates')

const REFRESH_TOKEN_EXPIRY_DURATION_STRING = 30 * 24 * 60 * 60 * 1000 // '30d'

// DOM 元素引用
const userInfoUsername = document.getElementById('userInfoUsername')
const userInfoCreationDate = document.getElementById('userInfoCreationDate')
const userInfoFolderSize = document.getElementById('userInfoFolderSize')
const userInfoFolderPath = document.getElementById('userInfoFolderPath')
const copyFolderPathBtn = document.getElementById('copyFolderPathBtn')
const editorOpenForm = document.getElementById('editorOpenForm')
const editorOpenLabel = document.getElementById('editorOpenLabel')
const editorOpenTemplate = document.getElementById('editorOpenTemplate')
const changePasswordForm = document.getElementById('changePasswordForm')
const renameUserForm = document.getElementById('renameUserForm')
const deviceList = document.getElementById('deviceList')
const noDevicesText = document.getElementById('noDevicesText')
const refreshDevicesBtn = document.getElementById('refreshDevicesBtn')
const logoutBtn = document.getElementById('logoutBtn')
const deleteAccountBtn = document.getElementById('deleteAccountBtn')
// API Key elements
const createApiKeyForm = document.getElementById('createApiKeyForm')
const apiKeyList = document.getElementById('apiKeyList')
const noApiKeysText = document.getElementById('noApiKeysText')
const refreshApiKeysBtn = document.getElementById('refreshApiKeysBtn')
const newApiKeyModal = document.getElementById('newApiKeyModal')
const newApiKeyInput = document.getElementById('newApiKeyInput')
const copyNewApiKeyBtn = document.getElementById('copyNewApiKeyBtn')

/**
 * 加载用户信息。
 * @returns {Promise<void>}
 */
async function loadUserInfo() {
	try {
		const stats = await getUserStats()

		userInfoUsername.textContent = stats.username
		userInfoCreationDate.textContent = new Date(stats.creationDate).toLocaleDateString()
		userInfoFolderSize.textContent = stats.folderSize
		userInfoFolderPath.textContent = stats.folderPath
	}
	catch (error) {
		showToastForApiPayload('error', error)
	}
}

copyFolderPathBtn.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(userInfoFolderPath.textContent)
		showToastI18n('success', 'userSettings.userInfo.copiedAlert')
	}
	catch (err) {
		showToastI18n('error', 'userSettings.userInfo.copyPathFailed')
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
		await changePassword(currentPassword, newPassword)

		showToastI18n('success', 'userSettings.changePassword.success')
		form.reset()
	}
	catch (error) {
		showToastForApiPayload('error', error)
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
		await renameUser(newUsername, password)
		cacheVerifiedPassword(password)

		showToastI18n('success', 'userSettings.renameUser.success', { newUsername })
		form.reset()
		setTimeout(() => window.location.href = '/login', 2000)
	}
	catch (error) {
		invalidateCachedPassword()
		if (isPasswordConfirmationDialogDismissed(error)) return
		showToastForApiPayload('error', error)
	}
})

/**
 * 加载并显示设备。
 * @returns {Promise<void>}
 */
async function loadAndDisplayDevices() {
	noDevicesText.classList.add('hidden')

	try {
		deviceList.replaceChildren(await renderTemplate('listLoading', { escapeAttr }))
		const result = await getDevices()

		deviceList.replaceChildren()
		if (!result.devices.length) {
			noDevicesText.classList.remove('hidden')
			return
		}

		for (const device of result.devices) {
			const lastSeenDate = new Date(device.lastSeen || (device.expiry - REFRESH_TOKEN_EXPIRY_DURATION_STRING))
			const userAgent = device.userAgent
				? device.userAgent.length > 50 ? device.userAgent.substring(0, 47) + '...' : device.userAgent
				: 'N/A'
			const isThisDevice = Boolean(device.isCurrentSession)
			const li = await renderTemplate('deviceListItem', {
				escapeAttr,
				deviceId: device.deviceId,
				isThisDevice,
				lastSeen: lastSeenDate.toLocaleString(),
				ipAddress: device.ipAddress || 'N/A',
				userAgent,
				showRevoke: !isThisDevice,
			})

			const revokeButton = li.querySelector('.device-revoke-btn')
			if (revokeButton)
				revokeButton.addEventListener('click', async () => {
					if (confirmI18n('userSettings.userDevices.revokeConfirm')) try {
						const password = await requestPasswordConfirmation()
						await revokeDevice(device.jti, password)
						cacheVerifiedPassword(password)
						showToastI18n('success', 'userSettings.userDevices.revokeSuccess')
						loadAndDisplayDevices()
					} catch (error) {
						invalidateCachedPassword()
						if (isPasswordConfirmationDialogDismissed(error)) return
						showToastForApiPayload('error', error)
					}
				})

			deviceList.appendChild(li)
		}
	}
	catch (error) {
		deviceList.replaceChildren()
		noDevicesText.classList.remove('hidden')
		showToastForApiPayload('error', error)
	}
}

refreshDevicesBtn.addEventListener('click', loadAndDisplayDevices)

// 登出处理函数
logoutBtn.addEventListener('click', async () => {
	if (!confirmI18n('userSettings.logout.confirmMessage')) return
	try {
		await logout()

		// 登出成功，显示短暂消息并重定向
		showToastI18n('success', 'userSettings.logout.successMessage', {}, 2000)
		setTimeout(() => {
			window.location.href = '/login' // 重定向到登录页面
		}, 1500) // 延迟一点以便用户看到消息
	}
	catch (error) {
		showToastForApiPayload('error', error)
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
		await deleteAccount(password)
		cacheVerifiedPassword(password)

		showToastI18n('success', 'userSettings.deleteAccount.success')
		setTimeout(() => window.location.href = '/login', 3000)
	}
	catch (error) {
		invalidateCachedPassword()
		if (isPasswordConfirmationDialogDismissed(error)) return
		showToastForApiPayload('error', error)
	}
})

/**
 * 加载并显示 API 密钥。
 * @returns {Promise<void>}
 */
async function loadAndDisplayApiKeys() {
	noApiKeysText.classList.add('hidden')

	try {
		apiKeyList.replaceChildren(await renderTemplate('listLoading', { escapeAttr }))
		const result = await getApiKeys()

		apiKeyList.replaceChildren()
		if (!result.apiKeys.length) {
			noApiKeysText.classList.remove('hidden')
			return
		}

		const sorted = [...result.apiKeys].sort((a, b) => b.createdAt - a.createdAt)
		for (const key of sorted) {
			const li = await renderTemplate('apiKeyListItem', {
				escapeAttr,
				prefix: key.prefix,
				description: key.description || 'N/A',
				createdAt: new Date(key.createdAt).toLocaleString(),
				lastUsed: key.lastUsed ? new Date(key.lastUsed).toLocaleString() : geti18n('userSettings.apiKeys.neverUsed'),
			})

			const revokeButton = li.querySelector('.apikey-revoke-btn')
			if (revokeButton)
				revokeButton.addEventListener('click', async () => {
					if (confirmI18n('userSettings.apiKeys.revokeConfirm')) try {
						const password = await requestPasswordConfirmation()
						await revokeApiKey(key.jti, password)
						cacheVerifiedPassword(password)

						showToastI18n('success', 'userSettings.apiKeys.revokeSuccess')
						loadAndDisplayApiKeys()
					} catch (error) {
						invalidateCachedPassword()
						if (isPasswordConfirmationDialogDismissed(error)) return
						showToastForApiPayload('error', error)
					}
				})

			apiKeyList.appendChild(li)
		}
	}
	catch (error) {
		apiKeyList.replaceChildren()
		noApiKeysText.classList.remove('hidden')
		showToastForApiPayload('error', error)
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

		newApiKeyInput.value = result.apiKey
		newApiKeyModal.showModal()
		showToastI18n('success', 'userSettings.apiKeys.createSuccess')
		form.reset()
		loadAndDisplayApiKeys()
	}
	catch (error) {
		showToastForApiPayload('error', error)
	}
})

copyNewApiKeyBtn.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(newApiKeyInput.value)
		showToastI18n('success', 'userSettings.newApiKey.copiedAlert')
	}
	catch (err) {
		console.error('Failed to copy API key: ', err)
		showToastI18n('error', 'userSettings.newApiKey.copyKeyFailed')
	}
})


/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function initializeApp() {
	await initTranslations('userSettings')
	applyTheme()

	installPasskeysSection()

	await loadUserInfo()
	await loadEditorOpen()
	await loadAndDisplayDevices()
	await loadPasskeysList()
	await loadAndDisplayApiKeys()
}

async function loadEditorOpen() {
	try {
		const r = await getEditorOpenConfig()
		if (r.success && r.config) {
			editorOpenLabel.value = r.config.editorLabel ?? ''
			editorOpenTemplate.value = r.config.editorCommandTemplate ?? ''
		}
	}
	catch { /* ignore */ }
}

editorOpenForm?.addEventListener('submit', async event => {
	event.preventDefault()
	const r = await saveEditorOpenConfig(editorOpenLabel.value.trim(), editorOpenTemplate.value.trim())
	if (r.success) showToastI18n('success', 'userSettings.editorOpen.savedToast')
})

initializeApp().catch(error => {
	console.error('Error initializing User Settings shell:', error)
	showToastForApiPayload('error', error)
})
