import { initTranslations, geti18n } from '/scripts/i18n.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { showToast, showToastI18n } from '/scripts/toast.mjs'
import { createSearchableDropdown } from '/scripts/search.mjs'
import { getPartTypes, getPartList } from '/scripts/parts.mjs'
import { getFountJson, exportPart, createShareLink } from './src/endpoints.mjs'

// --- DOM Elements ---
const partTypeSelect = document.getElementById('partTypeSelect')
const partNameDropdown = document.getElementById('partNameDropdown')
const exportButton = document.getElementById('exportButton')
const shareButton = document.getElementById('shareButton')
const exportStatusIcon = document.getElementById('exportStatusIcon')
const shareStatusIcon = document.getElementById('shareStatusIcon')
const disabledIndicator = document.getElementById('disabledIndicator')
const includeDataCheckbox = document.getElementById('includeDataCheckbox')
const dataToggleContainer = document.getElementById('dataToggleContainer')
const shareButtonText = shareButton.querySelector('.text-lg')
const stepPartType = document.getElementById('stepPartType')
const stepPart = document.getElementById('stepPart')
const stepAction = document.getElementById('stepAction')

// --- State ---
let partTypes = []
let parts = []
let activePartType = null
let activePart = null
let fountJson = null

// --- UI State Management ---

/**
 * Updates the entire UI based on the current application state.
 * This function centralizes all UI logic.
 */
function updateUIState() {
	// Step 1: Update the progress steps
	const currentStep = activePartType ? activePart ? 3 : 2 : 1
	stepPartType.classList.toggle('step-primary', currentStep >= 1)
	stepPart.classList.toggle('step-primary', currentStep >= 2)
	stepAction.classList.toggle('step-primary', currentStep >= 3)

	// Step 2: Show/hide the main action area
	const isActionable = !!(activePartType && activePart)
	disabledIndicator.classList.toggle('hidden', isActionable)

	// Step 3: Show/hide the "include data" toggle if data files exist
	const hasDataFiles = fountJson?.data_files?.length > 0
	dataToggleContainer.classList.toggle('hidden', !hasDataFiles)

	// Step 4: Update the Share Button's text and behavior
	const hasExistingShareLink = !includeDataCheckbox.checked && fountJson?.share_link
	shareButton.toggleAttribute('tabindex', hasExistingShareLink) // Correct use for boolean attributes
	shareButtonText.dataset.i18n = hasExistingShareLink ? 'export.buttons.copyShareLink' : 'export.buttons.generateShareLink'
}

// --- Data & State Changers ---

/**
 * Handles the logic when a part type is selected.
 * @param {string | null} partType The selected part type name.
 */
async function onPartTypeSelected(partType) {
	activePartType = partType
	// Reset dependent state
	activePart = null
	parts = []
	fountJson = null

	updateURLParams(activePartType, null)

	if (activePartType) try {
		parts = await getPartList(activePartType)
	} catch (err) {
		console.error('Failed to fetch parts:', err)
		showToast('error', `${geti18n('export.alerts.fetchPartsFailed')}: ${err.message}`)
	}

	await renderPartDropdown()
	updateUIState()
}

/**
 * Handles the logic when a specific part is selected.
 * @param {string | null} partName The selected part name.
 */
async function onPartSelected(partName) {
	activePart = partName
	fountJson = null // Reset before fetching

	updateURLParams(activePartType, activePart)

	if (activePartType && activePart) try {
		fountJson = await getFountJson(activePartType, activePart)
	} catch (err) {
		console.error('Failed to load part details:', err)
		showToast('error', `${geti18n('export.alerts.loadPartDetailsFailed')}: ${err.message}`)
	}

	updateUIState()
}

// --- Data Fetching & Rendering ---

async function fetchAndRenderPartTypes() {
	try {
		partTypes = await getPartTypes()
		const fragment = document.createDocumentFragment()
		const defaultOption = document.createElement('option')
		defaultOption.disabled = true
		defaultOption.selected = true
		defaultOption.dataset.i18n = 'export.placeholders.partTypeSelect'
		fragment.appendChild(defaultOption)

		partTypes.forEach(type => {
			const option = document.createElement('option')
			option.value = type
			option.textContent = type
			fragment.appendChild(option)
		})
		partTypeSelect.innerHTML = ''
		partTypeSelect.appendChild(fragment)
	}
	catch (err) {
		console.error('Failed to fetch part types:', err)
		showToast('error', geti18n('export.alerts.fetchPartTypesFailed') + ': ' + err.message)
	}
}

async function renderPartDropdown() {
	const dataList = parts.map(name => ({ name, value: name }))

	// Set the initial value if activePart is already known (e.g., from URL)
	if (activePart) partNameDropdown.dataset.value = activePart
	else delete partNameDropdown.dataset.value

	await createSearchableDropdown({
		dropdownElement: partNameDropdown,
		dataList,
		textKey: 'name',
		valueKey: 'value',
		disabled: !parts || parts.length === 0,
		onSelect: async (selectedItem) => {
			await onPartSelected(selectedItem ? selectedItem.value : null)
			return false
		},
	})
}

// --- Actions ---

async function handleExport() {
	if (!activePartType || !activePart) return

	const withData = includeDataCheckbox.checked
	setButtonLoading(exportButton, exportStatusIcon, true)

	try {
		const { blob, format } = await exportPart(activePartType, activePart, withData)
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${activePart}${withData ? '_with_data' : ''}.${format}`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
		setButtonState(exportStatusIcon, 'success')
	}
	catch (err) {
		showToast('error', geti18n('export.alerts.exportFailed') + ': ' + err.message)
		console.error('Failed to export part:', err)
		setButtonState(exportStatusIcon, 'error')
	}

	setTimeout(() => setButtonLoading(exportButton, exportStatusIcon, false), 2000)
}

async function handleShareAction({ copyOnly = false, expiration = null }) {
	if (!activePartType || !activePart) return

	const withData = includeDataCheckbox.checked
	setButtonLoading(shareButton, shareStatusIcon, true)

	try {
		let link
		if (copyOnly && fountJson?.share_link)
			// Case 1: Just copy the pre-existing share link
			link = `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;${fountJson.share_link}`
		else if (expiration)
			// Case 2: Generate a new share link
			link = await createShareLink(activePartType, activePart, expiration, withData)
		else
			throw new Error('Invalid share action call')

		await navigator.clipboard.writeText(link)
		showToastI18n('success', 'export.alerts.shareLinkCopied')
		setButtonState(shareStatusIcon, 'success')
	}
	catch (err) {
		showToast('error', geti18n('export.alerts.shareFailed') + ': ' + err.message)
		console.error('Failed to handle share action:', err)
		setButtonState(shareStatusIcon, 'error')
	}
	finally {
		setTimeout(() => setButtonLoading(shareButton, shareStatusIcon, false), 2000)
	}
}

// --- UI Helpers ---

function setButtonLoading(button, icon, isLoading) {
	button.disabled = isLoading
	if (isLoading)
		icon.innerHTML = '<img src="https://api.iconify.design/line-md/loading-loop.svg" class="h-6 w-6" />'
	else
		icon.innerHTML = ''
}

function setButtonState(icon, state) {
	const iconUrl = state === 'success'
		? 'https://api.iconify.design/line-md/confirm-circle.svg'
		: 'https://api.iconify.design/line-md/emoji-frown.svg'
	icon.innerHTML = `<img src="${iconUrl}" class="h-6 w-6" />`
}

// --- URL Management ---

function getURLParams() {
	return new URLSearchParams(window.location.search)
}

function updateURLParams(partType, partName) {
	const urlParams = new URLSearchParams()
	if (partType) urlParams.set('type', partType)
	if (partName) urlParams.set('name', partName)
	const newURL = `${window.location.pathname}?${urlParams.toString()}`
	window.history.pushState({ path: newURL }, '', newURL)
}

// --- Initialization ---

async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const partType = urlParams.get('type')
	const partName = urlParams.get('name')

	await fetchAndRenderPartTypes()

	if (partType && partTypes.includes(partType)) {
		partTypeSelect.value = partType
		await onPartTypeSelected(partType)

		if (partName && parts.includes(partName))
			partNameDropdown.dataset.value = partName
	}
	else await onPartTypeSelected(null)

	// Initial UI state sync after potential URL-based selections
	updateUIState()
}

async function init() {
	applyTheme()
	await initTranslations('export')

	// Event Listeners
	partTypeSelect.addEventListener('change', (e) => onPartTypeSelected(e.target.value))

	exportButton.addEventListener('click', handleExport)
	includeDataCheckbox.addEventListener('change', updateUIState)

	shareButton.addEventListener('click', event => {
		if (!fountJson?.share_link || includeDataCheckbox.checked) return
		event.preventDefault()
		handleShareAction({ copyOnly: true })
	})

	document.getElementById('shareMenu').addEventListener('click', event => {
		document.activeElement?.blur?.()
		if (event.target.tagName === 'A' && event.target.dataset.value)
			handleShareAction({ expiration: event.target.dataset.value })
	})

	await initializeFromURLParams()
}

init()
