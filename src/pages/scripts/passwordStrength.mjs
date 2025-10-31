import { zxcvbn, zxcvbnOptions } from 'https://esm.sh/@zxcvbn-ts/core'
import * as zxcvbnCommonPackage from 'https://esm.sh/@zxcvbn-ts/language-common'

import { geti18n, i18nElement, setLocalizeLogic } from './i18n.mjs'

zxcvbnOptions.setOptions({
	graphs: zxcvbnCommonPackage.adjacencyGraphs,
	dictionary: {
		...zxcvbnCommonPackage.dictionary,
	}
})

/**
 * @description 更新 zxcvbn 的翻译。
 * @returns {void}
 */
function updateZxcvbnTranslations() {
	zxcvbnOptions.setOptions({ translations: geti18n('zxcvbn') })
}

/**
 * @description 评估密码强度。
 * @param {string} password - 要评估的密码。
 * @returns {{score: number, borderColorClass: string, fullFeedback: string}} - 密码强度评估结果。
 */
function evaluatePasswordStrength(password) {
	const result = zxcvbn(password)
	let feedbackText = ''
	let borderColorClass = ''

	switch (result.score) {
		case 0:
			borderColorClass = 'border-red-500'
			feedbackText = 'auth.passwordStrength.veryWeak'
			break
		case 1:
			borderColorClass = 'border-orange-500'
			feedbackText = 'auth.passwordStrength.weak'
			break
		case 2:
			borderColorClass = 'border-yellow-500'
			feedbackText = 'auth.passwordStrength.normal'
			break
		case 3:
			borderColorClass = 'border-lime-500'
			feedbackText = 'auth.passwordStrength.strong'
			break
		case 4:
			borderColorClass = 'border-green-500'
			feedbackText = 'auth.passwordStrength.veryStrong'
			break
	}
	let fullFeedback = `<strong data-i18n="${feedbackText}"></strong><br/>`
	if (result.feedback.warning) fullFeedback += result.feedback.warning + '<br/>'
	if (result.feedback.suggestions) fullFeedback += result.feedback.suggestions.join('<br/>')

	return { score: result.score, borderColorClass, fullFeedback }
}

/**
 * @description 更新密码强度 UI。
 * @param {string} password - 密码。
 * @param {HTMLInputElement} passwordInput - 密码输入框。
 * @param {HTMLElement} passwordStrengthFeedback - 密码强度反馈元素。
 * @returns {void}
 */
function updatePasswordStrengthUI(password, passwordInput, passwordStrengthFeedback) {
	if (!password) {
		passwordStrengthFeedback.innerHTML = ''
		passwordInput.classList.remove('border-red-500', 'border-orange-500', 'border-yellow-500', 'border-lime-500', 'border-green-500')
		return
	}

	const { borderColorClass, fullFeedback } = evaluatePasswordStrength(password)

	// Update border color
	passwordInput.classList.remove('border-red-500', 'border-orange-500', 'border-yellow-500', 'border-lime-500', 'border-green-500')
	passwordInput.classList.add(borderColorClass)

	// Update password strength feedback text
	passwordStrengthFeedback.innerHTML = fullFeedback
	i18nElement(passwordStrengthFeedback)
	passwordStrengthFeedback.classList.remove('text-red-500', 'text-orange-500', 'text-yellow-500', 'text-lime-500', 'text-green-500')
	passwordStrengthFeedback.classList.add(borderColorClass.replace('border-', 'text-'))
}

/**
 * @description 在密码输入字段上初始化密码强度计。
 * @param {HTMLInputElement} passwordInput - 密码输入元素。
 * @param {HTMLElement} passwordStrengthFeedback - 用于显示反馈的元素。
 * @returns {{ evaluate: () => { score: number, borderColorClass: string, fullFeedback: string } }} - 用于与强度计交互的对象。
 */
export function initPasswordStrengthMeter(passwordInput, passwordStrengthFeedback) {
	/**
	 * @description 刷新 UI。
	 * @returns {void}
	 */
	const refreshUI = () => updatePasswordStrengthUI(passwordInput.value, passwordInput, passwordStrengthFeedback)
	passwordInput.addEventListener('input', refreshUI)

	setLocalizeLogic(passwordInput, () => {
		updateZxcvbnTranslations()
		refreshUI()
	})

	return {
		/**
		 * @description 评估密码强度。
		 * @returns {{score: number, borderColorClass: string, fullFeedback: string}} - 密码强度评估结果。
		 */
		evaluate: () => evaluatePasswordStrength(passwordInput.value)
	}
}
