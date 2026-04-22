import * as Sentry from 'https://esm.sh/@sentry/browser'

import { confirmI18n } from '/scripts/i18n.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { renderTemplate } from '/scripts/template.mjs'

import {
	isPasswordConfirmationDialogDismissed,
	showToastForApiPayload,
	throwUnexpectedUserSettingsApiError,
} from './apiFeedback.mjs'
import {
	getWebAuthnCredentials,
	webauthnRegisterBegin,
	webauthnRegisterComplete,
	webauthnRemove,
} from './endpoints.mjs'
import { requestPasswordConfirmation } from './passwordConfirmationRequest.mjs'
import { escapeAttr, escapeHtmlText } from './uiEscape.mjs'

const passkeyList = document.getElementById('passkeyList')
const noPasskeysText = document.getElementById('noPasskeysText')
const refreshPasskeysBtn = document.getElementById('refreshPasskeysBtn')
const addPasskeyForm = document.getElementById('addPasskeyForm')
const newPasskeyNameInput = document.getElementById('newPasskeyName')

/** @type {((opts: object) => Promise<object>) | null} */
let startRegistrationFn = null

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
 * @returns {Promise<void>}
 */
export async function loadPasskeysList() {
	passkeyList.replaceChildren(await renderTemplate('listLoading'))
	noPasskeysText.classList.add('hidden')

	try {
		const result = await getWebAuthnCredentials()

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
			li.querySelector('.passkey-remove-btn').addEventListener('click', () => onRemovePasskeyClick(cred))
			passkeyList.appendChild(li)
		}
	} catch (error) {
		console.error('Failed to load passkeys list:', error)
		Sentry.captureException(error)
		passkeyList.replaceChildren()
		noPasskeysText.classList.remove('hidden')
		showToastForApiPayload('error', error)
	}
}

/**
 * @param {object} cred - 凭证。
 * @returns {Promise<void>}
 */
async function onRemovePasskeyClick(cred) {
	if (!confirmI18n('userSettings.passkeys.removeConfirm')) return
	try {
		const password = await requestPasswordConfirmation()
		await webauthnRemove(cred.id, password)
		showToastI18n('success', 'userSettings.passkeys.removeSuccess')
		await loadPasskeysList()
	} catch (error) {
		if (isPasswordConfirmationDialogDismissed(error)) return
		console.error('Failed to remove passkey:', error)
		Sentry.captureException(error)
		showToastForApiPayload('error', error)
	}
}

/**
 * @param {SubmitEvent} event - 提交事件。
 * @returns {Promise<void>}
 */
async function onAddPasskeySubmit(event) {
	event.preventDefault()
	if (!await loadWebAuthnBrowserRegistration()) {
		showToastI18n('error', 'userSettings.passkeys.errorLoadLibrary')
		return
	}
	const nickname = newPasskeyNameInput.value.trim()
	try {
		const password = await requestPasswordConfirmation()
		const begin = await webauthnRegisterBegin(password)
		if (!begin.options)
			throwUnexpectedUserSettingsApiError()
		const credential = await startRegistrationFn({ optionsJSON: begin.options })
		await webauthnRegisterComplete(credential, nickname, password)
		showToastI18n('success', 'userSettings.passkeys.addSuccess')
		newPasskeyNameInput.value = ''
		await loadPasskeysList()
	} catch (error) {
		if (isPasswordConfirmationDialogDismissed(error)) return
		if (error?.name === 'NotAllowedError')
			showToastI18n('error', 'userSettings.passkeys.errorCancelled')
		else {
			console.error('Failed to add passkey:', error)
			Sentry.captureException(error)
			showToastForApiPayload('error', error)
		}
	}
}

/**
 * 绑定 Passkey 区块事件。
 * @returns {void}
 */
export function installPasskeysSection() {
	refreshPasskeysBtn.addEventListener('click', () => loadPasskeysList())
	addPasskeyForm.addEventListener('submit', onAddPasskeySubmit)
}
