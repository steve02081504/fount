import { ZxcvbnFactory } from 'https://esm.sh/@zxcvbn-ts/core'
import * as zxcvbnCommonPackage from 'https://esm.sh/@zxcvbn-ts/language-common'

import { geti18n, setLocalizeLogic } from '../i18n/index.mjs'

const zxcvbnInstance = new ZxcvbnFactory({
	graphs: zxcvbnCommonPackage.adjacencyGraphs,
	dictionary: {
		...zxcvbnCommonPackage.dictionary,
	}
})

const PASSWORD_STRENGTH_BY_SCORE = [
	{ borderClass: 'border-red-500', textClass: 'text-red-500', i18nKey: 'auth.passwordStrength.veryWeak' },
	{ borderClass: 'border-orange-500', textClass: 'text-orange-500', i18nKey: 'auth.passwordStrength.weak' },
	{ borderClass: 'border-yellow-500', textClass: 'text-yellow-500', i18nKey: 'auth.passwordStrength.normal' },
	{ borderClass: 'border-lime-500', textClass: 'text-lime-500', i18nKey: 'auth.passwordStrength.strong' },
	{ borderClass: 'border-green-500', textClass: 'text-green-500', i18nKey: 'auth.passwordStrength.veryStrong' },
]

const PASSWORD_BORDER_CLASSES = PASSWORD_STRENGTH_BY_SCORE.map(({ borderClass }) => borderClass)
const PASSWORD_TEXT_CLASSES = PASSWORD_STRENGTH_BY_SCORE.map(({ textClass }) => textClass)

/**
 * 更新 zxcvbn 的翻译。
 * @returns {void}
 */
function updateZxcvbnTranslations() {
	zxcvbnInstance.options.setOptions({ translations: geti18n('util.zxcvbn') })
}

/**
 * 评估密码强度。
 * @param {string} password - 要评估的密码。
 * @returns {{score: number, borderColorClass: string, textClass: string, fullFeedback: string}} - 密码强度评估结果。
 */
function evaluatePasswordStrength(password) {
	const result = zxcvbnInstance.check(password)
	const { borderClass, textClass, i18nKey } = PASSWORD_STRENGTH_BY_SCORE[result.score]
	let fullFeedback = /* html */ `<strong data-i18n="${i18nKey}"></strong><br/>`
	if (result.feedback.warning) fullFeedback += result.feedback.warning + '<br/>'
	if (result.feedback.suggestions) fullFeedback += result.feedback.suggestions.join('<br/>')

	return { score: result.score, borderColorClass: borderClass, textClass, fullFeedback }
}

/**
 * 更新密码强度 UI。
 * @param {string} password - 密码。
 * @param {HTMLInputElement} passwordInput - 密码输入框。
 * @param {HTMLElement} passwordStrengthFeedback - 密码强度反馈元素。
 * @returns {void}
 */
function updatePasswordStrengthUI(password, passwordInput, passwordStrengthFeedback) {
	if (!password) {
		passwordStrengthFeedback.innerHTML = ''
		passwordInput.classList.remove(...PASSWORD_BORDER_CLASSES)
		return
	}

	const { borderColorClass, textClass, fullFeedback } = evaluatePasswordStrength(password)

	passwordInput.classList.remove(...PASSWORD_BORDER_CLASSES)
	passwordInput.classList.add(borderColorClass)

	passwordStrengthFeedback.innerHTML = fullFeedback
	passwordStrengthFeedback.classList.remove(...PASSWORD_TEXT_CLASSES)
	passwordStrengthFeedback.classList.add(textClass)
}

/**
 * 在密码输入字段上初始化密码强度计。
 * @param {HTMLInputElement} passwordInput - 密码输入元素。
 * @param {HTMLElement} passwordStrengthFeedback - 用于显示反馈的元素。
 * @returns {{ evaluate: () => { score: number, borderColorClass: string, textClass: string, fullFeedback: string } }} - 用于与强度计交互的对象。
 */
export function initPasswordStrengthMeter(passwordInput, passwordStrengthFeedback) {
	/**
	 * 刷新 UI。
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
		 * 评估密码强度。
		 * @returns {{score: number, borderColorClass: string, textClass: string, fullFeedback: string}} - 密码强度评估结果。
		 */
		evaluate: () => evaluatePasswordStrength(passwordInput.value)
	}
}
