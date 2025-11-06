/**
 * 导出 shell 的客户端逻辑。
 */
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
 * 根据当前应用程序状态更新整个 UI。
 * 此函数集中了所有 UI 逻辑。
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
	const hasDataFiles = fountJson?.data_files?.length
	dataToggleContainer.classList.toggle('hidden', !hasDataFiles)

	// Step 4: Update the Share Button's text and behavior
	const hasExistingShareLink = !includeDataCheckbox.checked && fountJson?.share_link
	shareButton.toggleAttribute('tabindex', hasExistingShareLink) // Correct use for boolean attributes
	shareButtonText.dataset.i18n = hasExistingShareLink ? 'export.buttons.copyShareLink' : 'export.buttons.generateShareLink'
}

// --- Data & State Changers ---

/**
 * 处理选择部件类型时的逻辑。
 * @param {string | null} partType - 选定的部件类型名称。
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
 * 处理选择特定部件时的逻辑。
 * @param {string | null} partName - 选定的部件名称。
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

/**
 * 获取并渲染部件类型。
 * @returns {Promise<void>}
 */
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

/**
 * 渲染部件下拉列表。
 * @returns {Promise<void>}
 */
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
		disabled: !parts || !parts.length,
		/**
		 * @param {object} selectedItem - 选定的项目。
		 * @returns {Promise<boolean>} - 是否成功。
		 */
		onSelect: async (selectedItem) => {
			await onPartSelected(selectedItem ? selectedItem.value : null)
			return false
		},
	})
}

// --- Actions ---

/**
 * 处理导出。
 * @returns {Promise<void>}
 */
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

/**
 * 处理共享操作。
 * @param {object} root0 - 根对象。
 * @param {boolean} [root0.copyOnly=false] - 是否仅复制。
 * @param {string | null} [root0.expiration=null] - 过期时间。
 * @returns {Promise<void>}
 */
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

/**
 * 设置按钮加载状态。
 * @param {HTMLButtonElement} button - 按钮。
 * @param {HTMLElement} icon - 图标。
 * @param {boolean} isLoading - 是否正在加载。
 */
function setButtonLoading(button, icon, isLoading) {
	button.disabled = isLoading
	if (isLoading)
		icon.innerHTML = /* html */ '<img src="https://api.iconify.design/line-md/loading-loop.svg" class="h-6 w-6" />'
	else
		icon.innerHTML = /* html */ ''
}

/**
 * 设置按钮状态。
 * @param {HTMLElement} icon - 图标。
 * @param {'success' | 'error'} state - 状态。
 */
function setButtonState(icon, state) {
	const iconUrl = state === 'success'
		? 'https://api.iconify.design/line-md/confirm-circle.svg'
		: 'https://api.iconify.design/line-md/emoji-frown.svg'
	icon.innerHTML = /* html */ `<img src="${iconUrl}" class="h-6 w-6" />`
}

// --- URL Management ---

/**
 * 获取 URL 参数。
 * @returns {URLSearchParams} - URL 参数。
 */
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

/**
 * 更新 URL 参数。
 * @param {string} partType - 部件类型。
 * @param {string} partName - 部件名称。
 */
function updateURLParams(partType, partName) {
	const urlParams = new URLSearchParams()
	if (partType) urlParams.set('type', partType)
	if (partName) urlParams.set('name', partName)
	const newURL = `${window.location.pathname}?${urlParams.toString()}`
	window.history.pushState({ path: newURL }, '', newURL)
}

// --- Initialization ---

/**
 * 从 URL 参数初始化。
 * @returns {Promise<void>}
 */
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

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
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
