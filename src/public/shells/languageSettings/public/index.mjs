/**
 * @file languageSettings/public/index.mjs
 * @description 语言设置 shell 的客户端逻辑。
 * @namespace languageSettings.public
 */
import { initTranslations, i18nElement, loadPreferredLangs, savePreferredLangs, getAvailableLocales } from '/scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { createSearchableDropdown } from '/scripts/search.mjs'
import { showToastI18n } from '/scripts/toast.mjs'

// --- DOM Elements ---
const availableLanguagesDropdown = document.getElementById('availableLanguagesDropdown')
const preferredLanguagesList = document.getElementById('preferredLanguagesList')
const saveButton = document.getElementById('saveButton')
const resetButton = document.getElementById('resetButton')

// --- State ---
let availableLocales = [] // { id: 'en-UK', name: 'English (UK)' }
let userPreferredLocales = [] // ['en-UK', 'zh-CN']

/**
 * @function getLocaleName
 * @memberof languageSettings.public
 * @description 获取区域设置名称。
 * @param {string} id - 区域设置 ID。
 * @returns {string} - 区域设置名称。
 */
function getLocaleName(id) {
	const locale = availableLocales.find(l => l.id === id)
	return locale ? locale.name : id // Fallback to ID if name not found
}

/**
 * @function updateAvailableLanguagesDropdown
 * @memberof languageSettings.public
 * @description 更新可用语言下拉列表。
 * @returns {Promise<void>}
 */
async function updateAvailableLanguagesDropdown() {
	const currentPreferredSet = new Set(userPreferredLocales)
	const filteredAvailableLocales = availableLocales.filter(locale => !currentPreferredSet.has(locale.id))

	await createSearchableDropdown({
		dropdownElement: availableLanguagesDropdown,
		dataList: filteredAvailableLocales,
		textKey: 'name',
		valueKey: 'id',
		/**
		 * @param {object} selectedItem - 选定的项目。
		 */
		onSelect: (selectedItem) => {
			if (selectedItem && !userPreferredLocales.includes(selectedItem.id)) {
				userPreferredLocales.push(selectedItem.id)
				renderPreferredLanguages()
			}
			// Return false to allow the dropdown to close automatically
			return false
		},
		/**
		 * @param {object} item - 项目。
		 * @returns {string} - 数据访问器。
		 */
		dataAccessor: item => `${item.name} ${item.id}`,
	})
}

/**
 * @function renderPreferredLanguages
 * @memberof languageSettings.public
 * @description 渲染首选语言。
 * @returns {Promise<void>}
 */
async function renderPreferredLanguages() {
	preferredLanguagesList.innerHTML = '' // Clear current list

	if (!userPreferredLocales.length) {
		preferredLanguagesList.innerHTML = '<p class="text-center text-base-content-secondary" data-i18n="languageSettings.noPreferredLanguages"></p>'
		i18nElement(preferredLanguagesList)
		if (availableLocales.length)
			await updateAvailableLanguagesDropdown()
		return
	}

	for (let i = 0; i < userPreferredLocales.length; i++) {
		const localeId = userPreferredLocales[i]
		const listItem = await renderTemplate('preferred_locale_item', {
			localeId,
			localeName: getLocaleName(localeId),
			isFirst: !i,
			isLast: i === userPreferredLocales.length - 1,
		})

		// Attach event listeners for buttons within the list item
		listItem.querySelector('.move-up').addEventListener('click', () => moveLocale(localeId, -1))
		listItem.querySelector('.move-down').addEventListener('click', () => moveLocale(localeId, 1))
		listItem.querySelector('.delete-locale').addEventListener('click', () => deleteLocale(localeId))

		preferredLanguagesList.appendChild(listItem)
	}

	await updateAvailableLanguagesDropdown()
}

/**
 * @function fetchAvailableLocales
 * @memberof languageSettings.public
 * @description 获取可用区域设置。
 * @returns {Promise<void>}
 */
async function fetchAvailableLocales() {
	try {
		const data = await getAvailableLocales()
		availableLocales = data
	}
	catch (error) {
		console.error('Error fetching available locales:', error)
		showToastI18n('info', 'languageSettings.fetchLocalesFailed')
	}
}

/**
 * @function moveLocale
 * @memberof languageSettings.public
 * @description 移动区域设置。
 * @param {string} id - 区域设置 ID。
 * @param {number} direction - 方向。
 */
function moveLocale(id, direction) {
	const index = userPreferredLocales.indexOf(id)
	if (index === -1) return

	const newIndex = index + direction
	if (newIndex >= 0 && newIndex < userPreferredLocales.length) {
		const [movedLocale] = userPreferredLocales.splice(index, 1)
		userPreferredLocales.splice(newIndex, 0, movedLocale)
		renderPreferredLanguages()
	}
}

/**
 * @function deleteLocale
 * @memberof languageSettings.public
 * @description 删除区域设置。
 * @param {string} id - 区域设置 ID。
 */
function deleteLocale(id) {
	userPreferredLocales = userPreferredLocales.filter(locale => locale !== id)
	renderPreferredLanguages()
}

/**
 * @function handleSave
 * @memberof languageSettings.public
 * @description 处理保存。
 */
function handleSave() {
	savePreferredLangs(userPreferredLocales)
	showToastI18n('info', 'languageSettings.savedMessage')
}

/**
 * @function handleReset
 * @memberof languageSettings.public
 * @description 处理重置。
 */
function handleReset() {
	userPreferredLocales = []
	savePreferredLangs(userPreferredLocales)
	renderPreferredLanguages()
	showToastI18n('info', 'languageSettings.resetMessage')
}

/**
 * @function init
 * @memberof languageSettings.public
 * @description 初始化。
 * @returns {Promise<void>}
 */
async function init() {
	applyTheme()
	usingTemplates('/shells/languageSettings/templates')
	await initTranslations('languageSettings') // Initialize page-specific translations

	userPreferredLocales = loadPreferredLangs()

	await fetchAvailableLocales()

	// Attach event listeners
	saveButton.addEventListener('click', handleSave)
	resetButton.addEventListener('click', handleReset)

	renderPreferredLanguages()
}

init()
