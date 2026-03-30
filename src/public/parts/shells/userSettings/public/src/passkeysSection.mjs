import * as Sentry from 'https://esm.sh/@sentry/browser'

import { renderTemplate } from '/scripts/template.mjs'

import { getWebAuthnCredentials, webauthnRegisterBegin, webauthnRegisterComplete, webauthnRemove } from './endpoints.mjs'
import { escapeAttr, escapeHtmlText } from './uiEscape.mjs'

/** @type {((opts: object) => Promise<object>) | null} */
let startRegistrationFn = null

/**
 * @typedef {object} PasskeysSectionDeps
 * @property {HTMLUListElement} passkeyList
 * @property {HTMLElement} noPasskeysText
 * @property {HTMLButtonElement} refreshPasskeysBtn
 * @property {HTMLFormElement} addPasskeyForm
 * @property {HTMLInputElement} newPasskeyNameInput
 * @property {() => Promise<string>} requestPasswordConfirmation
 * @property {(key: string) => boolean} confirmI18n
 * @property {(key: string, params?: object) => string} geti18n
 * @property {(type: string, key: string, params?: object, duration?: number) => void} showToastI18n
 */

/**
 * 判断 requestPasswordConfirmation() 的 reject 是否来自“密码弹窗取消/关闭”这类期望场景。
 * @param {any} error - 捕获到的错误对象。
 * @returns {boolean} - 是否为期望的取消/关闭错误。
 */
function isPasswordDialogCancellationError(error) {
	return ['PasswordConfirmationCancelledError', 'PasswordConfirmationClosedError'].includes(error?.name)
}

/**
 * 加载 @simplewebauthn/browser 的注册方法。
 * @returns {Promise<boolean>} 成功加载则为 true。
 */
async function loadWebAuthnBrowserRegistration() {
	if (startRegistrationFn) return true
	try {
		const mod = await import('https://esm.sh/@simplewebauthn/browser')
		startRegistrationFn = mod.startRegistration
		return true
	} catch (err) {
		console.error('Failed to load WebAuthn library:', err)
		return false
	}
}

/**
 * 加载并渲染安全密钥列表。
 * @param {PasskeysSectionDeps} deps - 依赖注入。
 * @returns {Promise<void>}
 */
export async function loadPasskeysList(deps) {
	const { passkeyList, noPasskeysText, geti18n, showToastI18n } = deps
	passkeyList.replaceChildren(await renderTemplate('listLoading'))
	noPasskeysText.classList.add('hidden')

	try {
		const result = await getWebAuthnCredentials()
		if (!result.success) throw new Error(result.message || geti18n('userSettings.apiError', { message: 'Failed to load passkeys' }))

		passkeyList.replaceChildren()
		if (!result.credentials?.length) {
			noPasskeysText.classList.remove('hidden')
			return
		}

		for (const cred of result.credentials) {
			const name = cred.name || cred.id?.slice(0, 12) || '—'
			const created = cred.createdAt ? new Date(cred.createdAt).toLocaleString() : '—'
			const typeLabel = cred.credentialDeviceType || ''
			const typeSuffixHtml = typeLabel ? escapeHtmlText(` · ${typeLabel}`) : ''

			const li = await renderTemplate('passkeyListItem', {
				escapeAttr,
				created,
				typeSuffixHtml,
			})
			li.querySelector('.passkey-display-name').textContent = name
			li.querySelector('.passkey-remove-btn').addEventListener('click', () => onRemovePasskeyClick(cred, deps))
			passkeyList.appendChild(li)
		}
	} catch (error) {
		console.error('Failed to load passkeys list:', error)
		Sentry.captureException(error)
		passkeyList.replaceChildren()
		noPasskeysText.classList.remove('hidden')
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
}

/**
 * @param {object} cred - 凭证。
 * @param {PasskeysSectionDeps} deps - 依赖。
 * @returns {Promise<void>}
 */
async function onRemovePasskeyClick(cred, deps) {
	const { requestPasswordConfirmation, confirmI18n, geti18n, showToastI18n } = deps
	if (!confirmI18n('userSettings.passkeys.removeConfirm')) return
	try {
		const password = await requestPasswordConfirmation()
		const rm = await webauthnRemove(cred.id, password)
		if (!rm.success) throw new Error(rm.message || geti18n('userSettings.apiError', { message: 'Remove failed' }))
		showToastI18n('success', 'userSettings.passkeys.removeSuccess')
		await loadPasskeysList(deps)
	} catch (error) {
		if (isPasswordDialogCancellationError(error)) return
		console.error('Failed to remove passkey:', error)
		Sentry.captureException(error)
		showToastI18n('error', 'userSettings.generalError', { message: error.message })
	}
}

/**
 * @param {SubmitEvent} event - 提交事件。
 * @param {PasskeysSectionDeps} deps - 依赖。
 * @returns {Promise<void>}
 */
async function onAddPasskeySubmit(event, deps) {
	event.preventDefault()
	const { newPasskeyNameInput, geti18n, showToastI18n, requestPasswordConfirmation } = deps
	if (!await loadWebAuthnBrowserRegistration()) {
		showToastI18n('error', 'userSettings.passkeys.errorLoadLibrary')
		return
	}
	const nickname = newPasskeyNameInput.value.trim()
	try {
		const password = await requestPasswordConfirmation()
		const begin = await webauthnRegisterBegin(password)
		if (!begin.success || !begin.options) throw new Error(begin.message || geti18n('userSettings.apiError', { message: 'Begin failed' }))
		const credential = await startRegistrationFn({ optionsJSON: begin.options })
		const complete = await webauthnRegisterComplete(credential, nickname, password)
		if (!complete.success) throw new Error(complete.message || geti18n('userSettings.apiError', { message: 'Complete failed' }))
		showToastI18n('success', 'userSettings.passkeys.addSuccess')
		newPasskeyNameInput.value = ''
		await loadPasskeysList(deps)
	} catch (error) {
		if (isPasswordDialogCancellationError(error)) return
		if (error?.name === 'NotAllowedError')
			showToastI18n('error', 'userSettings.passkeys.errorCancelled')
		else {
			console.error('Failed to add passkey:', error)
			Sentry.captureException(error)
			showToastI18n('error', 'userSettings.generalError', { message: error.message })
		}
	}
}

/**
 * 绑定 Passkey 区块事件。
 * @param {PasskeysSectionDeps} deps - 依赖。
 * @returns {void}
 */
export function installPasskeysSection(deps) {
	const { refreshPasskeysBtn, addPasskeyForm } = deps
	refreshPasskeysBtn.addEventListener('click', () => loadPasskeysList(deps))
	addPasskeyForm.addEventListener('submit', e => onAddPasskeySubmit(e, deps))
}
