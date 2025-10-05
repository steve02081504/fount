import { initTranslations, geti18n, i18nElement, loadPreferredLangs, savePreferredLangs } from '/scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { createSearchableDropdown } from '/scripts/search.mjs'

// --- DOM Elements ---
const availableLanguagesDropdown = document.getElementById('availableLanguagesDropdown')
const preferredLanguagesList = document.getElementById('preferredLanguagesList')
const saveButton = document.getElementById('saveButton')
const resetButton = document.getElementById('resetButton')
const toastNotification = document.getElementById('toastNotification')
const toastMessage = document.getElementById('toastMessage')

// --- State ---
let availableLocales = [] // { id: 'en-UK', name: 'English (UK)' }
let userPreferredLocales = [] // ['en-UK', 'zh-CN']

// --- Helper Functions ---
function showToast(messageKey) {
	toastMessage.textContent = geti18n(messageKey)
	toastNotification.classList.remove('invisible')
	toastNotification.classList.add('visible')

	setTimeout(() => {
		toastNotification.classList.remove('visible')
		toastNotification.classList.add('invisible')
	}, 2000)
}

function getLocaleName(id) {
	const locale = availableLocales.find(l => l.id === id)
	return locale ? locale.name : id // Fallback to ID if name not found
}

function updateAvailableLanguagesDropdown() {
	i18nElement(availableLanguagesDropdown) // Translate placeholders first

	const currentPreferredSet = new Set(userPreferredLocales)
	const filteredAvailableLocales = availableLocales.filter(locale => !currentPreferredSet.has(locale.id))

	createSearchableDropdown({
		dropdownElement: availableLanguagesDropdown,
		dataList: filteredAvailableLocales,
		textKey: 'name',
		valueKey: 'id',
		onSelect: (selectedItem) => {
			if (selectedItem && !userPreferredLocales.includes(selectedItem.id)) {
				userPreferredLocales.push(selectedItem.id)
				renderPreferredLanguages()
			}
			// Return false to allow the dropdown to close automatically
			return false
		},
		dataAccessor: item => `${item.name} ${item.id}`,
	})
}

// --- Core UI Rendering ---
async function renderPreferredLanguages() {
	preferredLanguagesList.innerHTML = '' // Clear current list

	if (!userPreferredLocales.length) {
		preferredLanguagesList.innerHTML = '<p class="text-center text-base-content-secondary" data-i18n="languageSettings.noPreferredLanguages"></p>'
		i18nElement(preferredLanguagesList)
		if (availableLocales.length > 0)
			updateAvailableLanguagesDropdown()
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

	updateAvailableLanguagesDropdown()
}

// --- Event Handlers ---
async function fetchAvailableLocales() {
	try {
		const response = await fetch('/api/getavailablelocales')
		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
		const data = await response.json()
		availableLocales = data
	}
	catch (error) {
		console.error('Error fetching available locales:', error)
		showToast('languageSettings.fetchLocalesFailed')
	}
}

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

function deleteLocale(id) {
	userPreferredLocales = userPreferredLocales.filter(locale => locale !== id)
	renderPreferredLanguages()
}

function handleSave() {
	savePreferredLangs(userPreferredLocales)
	showToast('languageSettings.savedMessage')
}

function handleReset() {
	userPreferredLocales = []
	savePreferredLangs(userPreferredLocales)
	renderPreferredLanguages()
	showToast('languageSettings.resetMessage')
}

// --- Initialization ---
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
