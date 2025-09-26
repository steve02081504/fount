import { initTranslations, geti18n, console } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import { getPartTypes, getPartList, getFountJson, exportPart, createShareLink } from './src/endpoints.mjs'

// DOM Elements
const partTypeSelect = document.getElementById('partTypeSelect')
const partSelect = document.getElementById('partSelect')
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

// State
let partTypes = []
let parts = []
let activePartType = null
let activePart = null
let fountJson = null

// --- UI Control ---

function updateStep(currentStep) {
	stepPartType.classList.toggle('step-primary', currentStep >= 1)
	stepPart.classList.toggle('step-primary', currentStep >= 2)
	stepAction.classList.toggle('step-primary', currentStep >= 3)
}

function showExportArea(show) {
	disabledIndicator.classList.toggle('hidden', show)
}

function showDataToggle(show) {
	dataToggleContainer.classList.toggle('hidden', !show)
}

/**
 * Updates the share button's appearance and behavior based on whether a share_link exists.
 */
function updateShareButtonUI() {
	const hasShareLink = !includeDataCheckbox.checked && fountJson?.share_link

	if (hasShareLink) {
		shareButton.removeAttribute('tabindex')
		shareButtonText.textContent = geti18n('export.buttons.copyShareLink')
	}
	else {
		shareButton.setAttribute('tabindex', '0')
		shareButtonText.textContent = geti18n('export.buttons.generateShareLink')
	}
}

// --- Data Fetching ---

async function fetchPartTypes() {
	try {
		partTypes = await getPartTypes()
		renderPartTypeSelect()
	}
	catch (err) {
		console.error('Failed to fetch part types:', err)
		showToast(geti18n('export.alerts.fetchPartTypesFailed') + ': ' + err.message, 'error')
	}
}

async function fetchParts(partType) {
	try {
		parts = await getPartList(partType)
		renderPartSelect()
	}
	catch (err) {
		console.error('Failed to fetch parts:', err)
		showToast(geti18n('export.alerts.fetchPartsFailed') + ': ' + err.message, 'error')
	}
}

async function loadPartDetails(partType, partName) {
	try {
		fountJson = await getFountJson(partType, partName)
		updateShareButtonUI()
		const hasDataFiles = fountJson && fountJson.data_files && fountJson.data_files?.length > 0
		showDataToggle(hasDataFiles)
		showExportArea(true)
		updateStep(3)
	}
	catch (err) {
		showToast(geti18n('export.alerts.loadPartDetailsFailed') + ': ' + err.message, 'error')
		console.error('Failed to load part details:', err)
		showExportArea(false)
	}
}

// --- Rendering ---

function renderPartTypeSelect() {
	const fragment = document.createDocumentFragment()
	const defaultOption = document.createElement('option')
	defaultOption.disabled = true
	defaultOption.selected = true
	defaultOption.textContent = geti18n('export.placeholders.partTypeSelect')
	fragment.appendChild(defaultOption)

	partTypes.forEach(partType => {
		const option = document.createElement('option')
		option.value = partType
		option.textContent = partType
		fragment.appendChild(option)
	})

	partTypeSelect.innerHTML = ''
	partTypeSelect.appendChild(fragment)
}

function renderPartSelect() {
	const fragment = document.createDocumentFragment()
	const defaultOption = document.createElement('option')
	defaultOption.disabled = true
	defaultOption.selected = true
	defaultOption.textContent = geti18n('export.placeholders.partSelect')
	fragment.appendChild(defaultOption)

	parts.forEach(partName => {
		const option = document.createElement('option')
		option.value = partName
		option.textContent = partName
		fragment.appendChild(option)
	})

	partSelect.innerHTML = ''
	partSelect.disabled = false
	partSelect.appendChild(fragment)
}

// --- Actions ---

async function handleExport() {
	if (!activePartType || !activePart) return

	const withData = includeDataCheckbox.checked
	const button = exportButton
	const icon = exportStatusIcon

	setButtonLoading(button, icon, true)

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
		setButtonState(icon, 'success')
	}
	catch (err) {
		showToast(geti18n('export.alerts.exportFailed') + ': ' + err.message, 'error')
		console.error('Failed to export part:', err)
		setButtonState(icon, 'error')
	}

	setTimeout(() => setButtonLoading(button, icon, false), 2000)
}

/**
 * Handles copying the permanent share link to the clipboard.
 */
async function handleDirectShare() {
	if (!fountJson || !fountJson.share_link) return

	const button = shareButton
	const icon = shareStatusIcon
	setButtonLoading(button, icon, true)

	try {
		const link = `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;${fountJson.share_link}`
		await navigator.clipboard.writeText(link)
		showToast(geti18n('export.alerts.shareLinkCopied'), 'success')
		setButtonState(icon, 'success')
	}
	catch (err) {
		showToast(geti18n('export.alerts.shareFailed') + ': ' + err.message, 'error')
		console.error('Failed to copy share link:', err)
		setButtonState(icon, 'error')
	}
	setTimeout(() => setButtonLoading(button, icon, false), 2000)
}


async function handleShareAction(expiration) {
	if (!activePartType || !activePart || !expiration) return

	if (document.activeElement) document.activeElement.blur()

	const withData = includeDataCheckbox.checked
	const button = shareButton
	const icon = shareStatusIcon

	setButtonLoading(button, icon, true)

	try {
		const link = await createShareLink(activePartType, activePart, expiration, withData)
		await navigator.clipboard.writeText(link)
		showToast(geti18n('export.alerts.shareLinkCopied'), 'success')
		setButtonState(icon, 'success')
	}
	catch (err) {
		showToast(geti18n('export.alerts.shareFailed') + ': ' + err.message, 'error')
		console.error('Failed to create share link:', err)
		setButtonState(icon, 'error')
	}

	setTimeout(() => setButtonLoading(button, icon, false), 2000)
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

	await fetchPartTypes()

	if (partType) {
		partTypeSelect.value = partType
		activePartType = partType
		updateStep(2)
		await fetchParts(partType)

		if (partName) {
			partSelect.value = partName
			activePart = partName
			await loadPartDetails(partType, partName)
		}
		else showExportArea(false)
	}
	else {
		showExportArea(false)
		updateStep(1)
	}
}

async function init() {
	applyTheme()
	await initTranslations('export')
	initializeFromURLParams()

	// Event Listeners
	partTypeSelect.addEventListener('change', async () => {
		activePartType = partTypeSelect.value
		activePart = null
		fountJson = null
		updateShareButtonUI()
		partSelect.selectedIndex = 0
		showExportArea(false)
		showDataToggle(false)
		updateStep(2)
		updateURLParams(activePartType, null)
		await fetchParts(activePartType)
	})

	partSelect.addEventListener('change', async () => {
		activePart = partSelect.value
		if (activePart) {
			updateURLParams(activePartType, activePart)
			await loadPartDetails(activePartType, activePart)
		}
		else {
			fountJson = null
			updateShareButtonUI()
			showExportArea(false)
			showDataToggle(false)
			updateStep(2)
			updateURLParams(activePartType, null)
		}
	})

	exportButton.addEventListener('click', handleExport)
	includeDataCheckbox.addEventListener('change', updateShareButtonUI)

	shareButton.addEventListener('click', event => {
		if (fountJson?.share_link) {
			event.preventDefault()
			handleDirectShare()
		}
	})

	document.getElementById('shareMenu').addEventListener('click', event => {
		if (event.target.tagName === 'A')
			handleShareAction(event.target.dataset.value)
	})

	window.addEventListener('popstate', initializeFromURLParams)
}

init()
