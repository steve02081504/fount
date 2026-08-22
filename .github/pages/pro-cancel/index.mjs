/**
 * fount pro 订阅取消页：填写退订原因并在提交后展示（仅前端演示）。
 */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { makeSearchable } from '../scripts/components/search.mjs'
import {
	initTranslations,
	getAvailableLocales,
	getLocaleNames,
	setLanguage,
} from '../scripts/i18n/index.mjs'

const languageSelector = document.getElementById('language-selector')
const languageSearch = document.getElementById('language-search')
const cancelForm = document.getElementById('cancel-form')
const reasonInput = document.getElementById('reason-input')
const resultSection = document.getElementById('result-section')
const resultText = document.getElementById('result-text')

/**
 * 填充语言选择器。
 * @returns {Promise<void>}
 */
async function populateLanguageSelector() {
	languageSelector.innerHTML = ''
	const locales = getAvailableLocales()
	const localeNames = getLocaleNames()
	const items = []

	for (const locale of locales) {
		const localeName = localeNames.get(locale) || locale
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'locale-item-button'
		button.textContent = localeName
		/**
		 *
		 */
		button.onclick = async () => {
			try {
				await setLanguage([locale])
				document.activeElement?.blur()
			}
			catch (error) {
				Sentry.captureException(error)
				console.error('Failed to switch language:', error)
			}
		}

		li.appendChild(button)
		languageSelector.appendChild(li)
		items.push({ element: li, locale, name: localeName })
	}

	makeSearchable({
		searchInput: languageSearch,
		data: items,
		/**
		 * 数据访问器。
		 * @param {object} item - 列表项。
		 * @returns {{ name: string, locale: string }} 名称与语言代码。
		 */
		dataAccessor: item => ({ name: item.name, locale: item.locale }),
		/**
		 * 更新可见项。
		 * @param {Array<object>} filteredItems - 过滤后的项。
		 * @returns {void}
		 */
		onUpdate: (filteredItems) => {
			const visible = new Set(filteredItems)
			items.forEach(item => {
				item.element.style.display = visible.has(item) ? '' : 'none'
			})
		}
	})
}

/**
 * 主函数，初始化翻译并绑定提交逻辑。
 * @returns {Promise<void>}
 */
async function main() {
	await initTranslations('pro_cancel_screen')
	await populateLanguageSelector()

	cancelForm.addEventListener('submit', (event) => {
		event.preventDefault()
		resultText.textContent = reasonInput.value.trim()
		resultSection.classList.remove('hidden')
		resultText.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
	})
}

main().catch(error => {
	Sentry.captureException(error)
	console.error('Failed to initialize pro-cancel page:', error)
})
