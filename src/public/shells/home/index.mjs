import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { initTranslations, geti18n, confirmI18n, console } from '../../scripts/i18n.mjs'
import { renderMarkdown } from '../../scripts/markdown.mjs'
import {
	getCharDetails, noCacheGetCharDetails, getCharList,
	getPersonaList, getPersonaDetails, noCacheGetPersonaDetails,
	getWorldList, getWorldDetails, noCacheGetWorldDetails,
	setDefaultPart, getDefaultParts
} from '../../scripts/parts.mjs'
import { parseRegexFromString, escapeRegExp } from '../../scripts/regex.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import { getHomeRegistry } from './src/public/endpoints.mjs'

usingTemplates('/shells/home/src/public/templates')

const charContainer = document.getElementById('char-container')
const worldContainer = document.getElementById('world-container')
const personaContainer = document.getElementById('persona-container')
const itemDescription = document.getElementById('item-description')
const drawerToggle = document.getElementById('drawer-toggle')
const functionButtonsContainer = document.getElementById('function-buttons-container')
const filterInput = document.getElementById('filter-input')
const pageTitle = document.getElementById('page-title')
const instruction = document.getElementById('subtitle')

const charsTab = document.getElementById('chars-tab')
const worldsTab = document.getElementById('worlds-tab')
const personasTab = document.getElementById('personas-tab')
const charsTabDesktop = document.getElementById('chars-tab-desktop')
const worldsTabDesktop = document.getElementById('worlds-tab-desktop')
const personasTabDesktop = document.getElementById('personas-tab-desktop')

let itemDetailsCache = {} // Combined cache
let currentItemType = sessionStorage.getItem('fount.home.lastTab') || 'chars' // Persist tab selection
let homeRegistry
let defaultParts = {} // Store default parts

// Utility for mouse wheel scrolling
const handleMouseWheelScroll = (event) => {
	const scrollContainer = event.currentTarget
	scrollContainer.scrollLeft += Math.sign(event.deltaY) * 40
	event.preventDefault()
}

window.addEventListener('languagechange', () => {
	itemDetailsCache = {}
})

// --- Item Details Fetching ---
async function getItemDetails(itemType, itemName, useCache = true) {
	const cacheKey = `${itemType}-${itemName}`
	if (useCache && itemDetailsCache[cacheKey] && !itemDetailsCache[cacheKey].supportedInterfaces.includes('info'))
		return itemDetailsCache[cacheKey]

	let fetchFunction
	switch (itemType) {
		case 'chars':
			fetchFunction = useCache ? getCharDetails : noCacheGetCharDetails
			break
		case 'worlds':
			fetchFunction = useCache ? getWorldDetails : noCacheGetWorldDetails
			break
		case 'personas':
			fetchFunction = useCache ? getPersonaDetails : noCacheGetPersonaDetails
			break
		default:
			throw new Error(`Invalid item type: ${itemType}`)
	}

	itemDetailsCache[cacheKey] = await fetchFunction(itemName)
	return itemDetailsCache[cacheKey]
}

// --- Rendering ---
const ItemDOMCache = {}

async function renderItemView(itemType, itemDetails, itemName) {
	const cacheKey = `${itemType}-${itemName}`

	// Check if the DOM node is cached and if data hasn't changed
	if (ItemDOMCache[cacheKey]?.info && JSON.stringify(ItemDOMCache[cacheKey].info) === JSON.stringify(itemDetails))
		return ItemDOMCache[cacheKey].node

	const templateName = `${itemType.slice(0, -1)}_list_view`
	const itemElement = await renderTemplate(templateName, itemDetails)
	itemElement.dataset.name = itemName
	await attachCardEventListeners(itemElement, itemDetails, itemName, homeRegistry[`home_${itemType.slice(0, -1)}_interfaces`], itemType)
	ItemDOMCache[cacheKey] = { info: itemDetails, node: itemElement }  // Cache info and DOM node
	return itemElement
}

async function attachCardEventListeners(itemElement, itemDetails, itemName, interfacesRegistry, itemType) {
	const actionsContainer = itemElement.querySelector('.card-actions > div')
	actionsContainer.innerHTML = '' // Clear existing buttons
	actionsContainer.addEventListener('wheel', handleMouseWheelScroll, { passive: false })

	// Add interface buttons
	for (const interfaceItem of interfacesRegistry)
		if (!interfaceItem.interface || itemDetails.supportedInterfaces.includes(interfaceItem.interface)) {
			const button = document.createElement('a')
			const classes = ['btn', `btn-${interfaceItem.type ?? 'primary'}`, ...interfaceItem.classes ? interfaceItem.classes.split(' ') : []]
			button.classList.add(...classes)
			if (interfaceItem.style) button.style.cssText = interfaceItem.style

			button.innerHTML = interfaceItem.button ?? '<img src="https://api.iconify.design/line-md/question-circle.svg" />'
			button.title = interfaceItem.info.title
			svgInliner(button)

			if (interfaceItem.onclick)
				button.addEventListener('click', () => async_eval(interfaceItem.onclick.replaceAll('${name}', itemName).replaceAll('${type}', itemType), { geti18n }))
			else
				button.href = interfaceItem.url.replaceAll('${name}', itemName).replaceAll('${type}', itemType)
			actionsContainer.appendChild(button)
		}

	// Tag click events
	itemElement.querySelectorAll('.badge').forEach(tagElement => {
		tagElement.addEventListener('click', (event) => {
			event.stopPropagation()
			const tag = tagElement.textContent.trim()
			filterInput.value = filterInput.value.split(' ').includes(tag)
				? filterInput.value.split(' ').filter(t => t && t !== tag).join(' ')
				: filterInput.value ? `${filterInput.value} ${tag}` : tag
			filterItemList()
		})
	})

	// Click/Hover to display info
	const clickHandler = () => {
		displayItemInfo(itemDetails)
		if (window.innerWidth < 1024) drawerToggle.checked = true
	}

	itemElement.addEventListener('click', (event) => {
		if (window.innerWidth < 1024 && !event.target.closest('button'))
			clickHandler()
	})
	itemElement.addEventListener('mouseover', () => {
		if (window.innerWidth >= 1024) displayItemInfo(itemDetails)
	})

	// Refresh card data
	itemElement.querySelector('.refresh-button').addEventListener('click', async () => {
		itemElement.replaceWith(await renderItemView(currentItemType, await getItemDetails(currentItemType, itemName, false), itemName))
	})

	// Default item checkbox
	const defaultCheckbox = itemElement.querySelector('.default-checkbox')
	if (defaultCheckbox) {
		// Set initial checkbox state
		defaultCheckbox.checked = defaultParts[currentItemType.slice(0, -1)] === itemName
		if (defaultCheckbox.checked) itemElement.classList.add('selected-item')

		defaultCheckbox.addEventListener('change', async (event) => {
			const isChecked = event.target.checked
			// Update default part in backend
			const response = await setDefaultPart(currentItemType.slice(0, -1), isChecked ? itemName : null)

			if (response.ok) {
				// Update local state and UI
				defaultParts[currentItemType.slice(0, -1)] = isChecked ? itemName : null
				updateDefaultPartDisplay()
			}
			else
				console.error('Failed to update default part:', await response.text())
		})
	}
}

function updateDefaultPartDisplay() {
	for (const itemType of ['chars', 'worlds', 'personas']) {
		const defaultPartName = defaultParts[itemType.slice(0, -1)]
		const container = document.getElementById(`${itemType.slice(0, -1)}-container`)
		container.querySelectorAll('.card-container').forEach(el => {
			el.classList.remove('selected-item')
			const checkbox = el.querySelector('.default-checkbox')
			if (checkbox) checkbox.checked = false
		})
		if (defaultPartName) {
			const itemElement = container.querySelector(`.card-container[data-name="${defaultPartName}"]`)
			if (itemElement) {
				itemElement.classList.add('selected-item')
				const checkbox = itemElement.querySelector('.default-checkbox')
				if (checkbox) checkbox.checked = true
			}
		}
	}
}

async function displayItemInfo(itemDetails) {
	itemDescription.innerHTML = itemDetails.info.description_markdown
		? (await renderMarkdown(itemDetails.info.description_markdown)).outerHTML
		: geti18n('home.noDescription')
}

// --- Filtering ---

// Helper function for parsing regex filter
function parseRegexFilter(filter) {
	if (filter.startsWith('+') || filter.startsWith('-')) filter = filter.slice(1)
	try {
		return parseRegexFromString(filter)
	} catch (_) {
		return new RegExp(escapeRegExp(filter))
	}
}

function applyFilters(itemName, itemType, commonFilters, forceFilters, excludeFilters) {
	const cacheKey = `${itemType}-${itemName}`
	const itemData = itemDetailsCache[cacheKey]

	// Should be in cache if fetched previously
	if (!itemData) return false

	const itemString = JSON.stringify(itemData)

	const hasCommonMatch = commonFilters.length === 0 || commonFilters.some(filter => filter.test(itemString))
	const hasForceMatch = forceFilters.every(filter => filter.test(itemString))
	const hasExcludeMatch = excludeFilters.some(filter => filter.test(itemString))
	return hasCommonMatch && hasForceMatch && !hasExcludeMatch
}

async function filterItemList() {
	// Trigger re-render based on filters
	await displayItemList(currentItemType)
}

// --- Displaying Items ---
async function displayItemList(itemType) {
	// Hide all containers
	[charContainer, worldContainer, personaContainer].forEach(container => container.classList.add('hidden'))

	let currentContainer
	switch (itemType) {
		case 'chars': currentContainer = charContainer; break
		case 'worlds': currentContainer = worldContainer; break
		case 'personas': currentContainer = personaContainer; break
	}

	currentContainer.classList.remove('hidden')
	let targetContainer = currentContainer
	// Use temp container if current one has children to avoid multiple reflows
	if (currentContainer.children.length > 0)
		targetContainer = {
			children: [],
			appendChild: _ => targetContainer.children.push(_),
			replaceChild: (thenew, theold) => targetContainer.children.splice(targetContainer.children.indexOf(theold), 1, thenew),
			removeChild: _ => targetContainer.children.splice(targetContainer.children.indexOf(_), 1),
		}

	// Clear target container
	targetContainer.innerHTML = ''

	// Get all item names
	const allItemNames = await getItemList(itemType)

	// Get current filters
	const filterValue = filterInput.value.toLowerCase()
	const filtersArray = filterValue.split(' ').filter(f => f)
	const [commonFilters, forceFilters, excludeFilters] = [[], [], []]

	filtersArray.forEach(filterStr => {
		const regex = parseRegexFilter(filterStr)
		if (filterStr.startsWith('+')) forceFilters.push(regex)
		else if (filterStr.startsWith('-')) excludeFilters.push(regex)
		else commonFilters.push(regex)
	})

	const skeletons = Array(allItemNames.length).fill(0).map(_ => {
		const skeleton = document.createElement('div')
		skeleton.classList.add('skeleton')
		skeleton.classList.add('card-skeleton')
		targetContainer.appendChild(skeleton)
		return skeleton
	})
	await Promise.all(allItemNames
		.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
		.map(async (itemName, index) => {
			const skeleton = skeletons[index]
			// Fetch details (populates itemDetailsCache)
			const itemDetails = await getItemDetails(itemType, itemName, true)

			// Apply filters
			if (applyFilters(itemName, itemType, commonFilters, forceFilters, excludeFilters)) {
				const itemElement = await renderItemView(itemType, itemDetails, itemName)
				itemElement.classList.add(`${itemType}-card`)
				targetContainer.replaceChild(itemElement, skeleton)
			}
			else
				targetContainer.removeChild(skeleton)
		}))
	// Replace children if a temp container was used
	if (targetContainer !== currentContainer)
		currentContainer.replaceChildren(...targetContainer.children)
}

async function getItemList(itemType) {
	switch (itemType) {
		case 'chars': return await getCharList()
		case 'worlds': return await getWorldList()
		case 'personas': return await getPersonaList()
		default: return []
	}
}

// --- Function Buttons ---
async function displayFunctionButtons() {
	functionButtonsContainer.innerHTML = '' // Clear existing buttons
	if (!homeRegistry?.home_function_buttons) return // Avoid error if registry is not loaded

	for (const buttonItem of homeRegistry.home_function_buttons) {
		const li = document.createElement('li')
		const button = document.createElement('a')
		const classes = ['flex', 'items-center', 'justify-start', ...buttonItem.classes ? buttonItem.classes.split(' ') : []]
		button.classList.add(...classes)
		if (buttonItem.style) button.style.cssText = buttonItem.style

		const iconSpan = document.createElement('span')
		iconSpan.classList.add('mr-2')
		iconSpan.innerHTML = buttonItem.button ?? '<img src="https://api.iconify.design/line-md/question-circle.svg" class="text-icon" />'
		svgInliner(iconSpan)

		const titleSpan = document.createElement('span')
		titleSpan.textContent = buttonItem.info.title

		button.append(iconSpan, titleSpan)
		if (buttonItem.action)
			button.addEventListener('click', () => async_eval(buttonItem.action, { geti18n }))
		else if (buttonItem.url)
			button.href = buttonItem.url
		else
			console.warn('No action defined for this button')
		li.appendChild(button)
		functionButtonsContainer.appendChild(li)
	}
}

// --- Tab Management ---
async function updateTabContent(itemType) {
	currentItemType = itemType
	sessionStorage.setItem('fount.home.lastTab', itemType) // Persist tab in sessionStorage

	const pageTitleKey = `home.${itemType}.title`
	const instructionKey = `home.${itemType}.subtitle`
	pageTitle.textContent = geti18n(pageTitleKey)
	instruction.textContent = geti18n(instructionKey)

	// Display items for the new tab
	await displayItemList(itemType)

	itemDescription.innerHTML = geti18n('home.itemDescription') // Reset sidebar
}

// --- Initialization ---
async function initializeApp() {
	applyTheme()
	await initTranslations('home') // Initialize i18n first

	// Fetch initial data
	await fetchData()

	const tabs = [
		{ tab: charsTab, tabDesktop: charsTabDesktop, itemType: 'chars' },
		{ tab: worldsTab, tabDesktop: worldsTabDesktop, itemType: 'worlds' },
		{ tab: personasTab, tabDesktop: personasTabDesktop, itemType: 'personas' },
	]

	tabs.forEach(({ tab, tabDesktop, itemType }) => {
		[tab, tabDesktop].filter(Boolean).forEach(tabElement => {
			tabElement.addEventListener('click', async () => {
				await updateTabContent(itemType)
				// Remove active class from all tabs, then add to current
				tabs.forEach(t => {
					[t.tab, t.tabDesktop].filter(Boolean).forEach(el => el.classList.remove('tab-active'))
				})
				tabElement.classList.add('tab-active')
			})
		})
	})

	// Initial display (using the stored tab or default 'chars')
	await updateTabContent(currentItemType)

	// Set active tab UI
	const initialTab = tabs.find(t => t.itemType === currentItemType)
	if (initialTab)
		[initialTab.tab, initialTab.tabDesktop].filter(Boolean).forEach(el => el.classList.add('tab-active'))

	// Filter input event (consider debouncing)
	filterInput.addEventListener('input', filterItemList)

	// Refresh data on focus
	window.addEventListener('focus', async () => {
		await fetchData()
		// Refresh and display filtered list
		await filterItemList()
	})

	// esc按键
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape')
			if (!confirmI18n('home.escapeConfirm'))
				event.stopImmediatePropagation()
	}, true)
}

async function fetchData() {
	await Promise.all([
		getHomeRegistry().then(async (data) => {
			homeRegistry = data
			await displayFunctionButtons()
		}).catch(error => console.error('Failed to fetch home registry:', error)),
		getDefaultParts().then(data => {
			defaultParts = data
			updateDefaultPartDisplay()
		}).catch(error => console.error('Failed to fetch default parts:', error)),
	])
}

initializeApp().catch(error => {
	showToast(error.message, 'error')
	window.location.href = '/login'
})
