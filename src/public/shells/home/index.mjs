import { renderTemplate } from '../../scripts/template.mjs'
import {
	getCharDetails, noCacheGetCharDetails, getCharList,
	getPersonaList, getPersonaDetails, noCacheGetPersonaDetails,
	getWorldList, getWorldDetails, noCacheGetWorldDetails
} from '../../scripts/parts.mjs'
import { renderMarkdown } from '../../scripts/markdown.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { parseRegexFromString, escapeRegExp } from '../../scripts/regex.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { svgInliner } from '../../scripts/svg-inliner.mjs'

const charContainer = document.getElementById('char-container')
const worldContainer = document.getElementById('world-container')
const personaContainer = document.getElementById('persona-container')
const itemDescription = document.getElementById('item-description')
const drawerToggle = document.getElementById('drawer-toggle')
const functionButtonsContainer = document.getElementById('function-buttons-container')
const filterInput = document.getElementById('filter-input')
const pageTitle = document.getElementById('page-title')
const instruction = document.querySelector('p[data-i18n="home.instruction"]')

const charsTab = document.getElementById('chars-tab')
const worldsTab = document.getElementById('worlds-tab')
const personasTab = document.getElementById('personas-tab')
const charsTabDesktop = document.getElementById('chars-tab-desktop')
const worldsTabDesktop = document.getElementById('worlds-tab-desktop')
const personasTabDesktop = document.getElementById('personas-tab-desktop')

const itemDetailsCache = {} // Combined cache for all item types
let currentItemType = localStorage.getItem('lastTab') || 'chars' // Persist tab selection
let homeRegistry
let defaultParts = {} // Store default parts

// Utility function for mouse wheel scrolling (could be moved to a separate utility file)
const handleMouseWheelScroll = (event) => {
	const scrollContainer = event.currentTarget
	scrollContainer.scrollLeft += Math.sign(event.deltaY) * 40
	event.preventDefault()
}

// --- Item Details Fetching (Generic) ---
async function getItemDetails(itemType, itemName, useCache = true) {
	const cacheKey = `${itemType}-${itemName}`
	if (useCache && itemDetailsCache[cacheKey])
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


// --- Rendering (Generic) ---
const ItemDOMCache = {}

async function renderItemView(itemType, itemDetails, itemName) {
	const cacheKey = `${itemType}-${itemName}`

	// Check if the DOM node is cached and if the data hasn't changed
	if (ItemDOMCache[cacheKey]?.info && JSON.stringify(ItemDOMCache[cacheKey].info) === JSON.stringify(itemDetails))
		return ItemDOMCache[cacheKey].node

	const templateName = `home/${itemType.slice(0, -1)}_list_view`
	const itemElement = await renderTemplate(templateName, itemDetails)
	await attachCardEventListeners(itemElement, itemDetails, itemName, homeRegistry[`home_${itemType.slice(0, -1)}_interfaces`])
	ItemDOMCache[cacheKey] = { info: itemDetails, node: itemElement }  // Cache both info and node
	return itemElement
}



async function attachCardEventListeners(itemElement, itemDetails, itemName, interfacesRegistry) {
	const actionsContainer = itemElement.querySelector('.card-actions > div')
	actionsContainer.innerHTML = '' // Clear existing buttons
	actionsContainer.addEventListener('wheel', handleMouseWheelScroll)

	// Add interface buttons
	for (const interfaceItem of interfacesRegistry)
		if (!interfaceItem.interface || itemDetails.supportedInterfaces.includes(interfaceItem.interface)) {
			const button = document.createElement('button')
			const classes = ['btn', `btn-${interfaceItem.type ?? 'primary'}`, ...interfaceItem.classes ? interfaceItem.classes.split(' ') : []]
			button.classList.add(...classes)
			if (interfaceItem.style) button.style.cssText = interfaceItem.style

			button.innerHTML = interfaceItem.button ?? '<img src="https://api.iconify.design/line-md/question-circle.svg" />'
			button.title = interfaceItem.info.title
			svgInliner(button)

			button.addEventListener('click', () => {
				if (interfaceItem.onclick)
					eval(interfaceItem.onclick.replaceAll('${name}', itemName))
				else
					window.open(interfaceItem.url.replaceAll('${name}', itemName))
			})
			actionsContainer.appendChild(button)
		}

	// Tag click handler
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

	// Click/Hover for sidebar
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

	// Refresh button
	itemElement.querySelector('.refresh-button').addEventListener('click', async () => {
		itemElement.replaceWith(await renderItemView(currentItemType, await getItemDetails(currentItemType, itemName, false), itemName))
	})

	// Default Checkbox
	const defaultCheckbox = itemElement.querySelector('.default-checkbox')
	if (defaultCheckbox) {
		// Set initial state based on defaultParts
		defaultCheckbox.checked = defaultParts[currentItemType.slice(0, -1)] === itemName
		if (defaultCheckbox.checked) itemElement.classList.add('selected-item')

		defaultCheckbox.addEventListener('change', async (event) => {
			const isChecked = event.target.checked
			// Update default part in the backend
			const response = await fetch('/api/shells/home/setdefault', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ parttype: currentItemType.slice(0, -1), partname: isChecked ? itemName : null }),
			})

			if (response.ok) {
				// Update local defaultParts and UI
				defaultParts[currentItemType.slice(0, -1)] = isChecked ? itemName : null
				document.querySelectorAll(`.card-container .card.${currentItemType}-card`).forEach(el => {
					el.classList.remove('selected-item')
					const checkbox = el.querySelector('.default-checkbox')
					if (checkbox) checkbox.checked = false
				})
				if (isChecked) {
					itemElement.classList.add('selected-item')
					defaultCheckbox.checked = true
				}
			}
			else
				console.error('Failed to update default part:', await response.text())
		})
	}
}

async function displayItemInfo(itemDetails) {
	itemDescription.innerHTML = itemDetails.info.description_markdown
		? (await renderMarkdown(itemDetails.info.description_markdown)).outerHTML
		: geti18n('home.noDescription')
}

// --- Filtering ---
function applyFilters(itemName, itemType, commonFilters, forceFilters, excludeFilters) {
	const cacheKey = `${itemType}-${itemName}`
	const itemData = itemDetailsCache[cacheKey]

	if (!itemData) return false

	const itemString = JSON.stringify(itemData)

	const hasCommonMatch = commonFilters.length === 0 || commonFilters.some(filter => filter.test(itemString))
	const hasForceMatch = forceFilters.every(filter => filter.test(itemString))
	const hasExcludeMatch = excludeFilters.some(filter => filter.test(itemString))
	return hasCommonMatch && hasForceMatch && !hasExcludeMatch
}

async function filterItemList() {
	const filters = filterInput.value.toLowerCase().split(' ').filter(f => f)
	const [commonFilters, forceFilters, excludeFilters] = [[], [], []]

	filters.forEach(filter => {
		const regex = parseRegexFilter(filter)
		if (filter.startsWith('+')) forceFilters.push(regex)
		else if (filter.startsWith('-')) excludeFilters.push(regex)
		else commonFilters.push(regex)
	})

	function parseRegexFilter(filter) {
		if (filter.startsWith('+') || filter.startsWith('-')) filter = filter.slice(1)
		const parsed = parseRegexFromString(filter)
		return parsed ? parsed : new RegExp(escapeRegExp(filter))
	}

	// Fetch item list ONLY if filters are applied.
	if (filters.length > 0)
		await fetchAndCacheItemList(currentItemType)


	const filteredItemNames = Object.keys(itemDetailsCache)
		.filter(key => key.startsWith(`${currentItemType}-`))  // Filter cache keys
		.map(key => key.replace(`${currentItemType}-`, ''))      // Extract item name
		.filter(itemName => applyFilters(itemName, currentItemType, commonFilters, forceFilters, excludeFilters))

	displayItemList(currentItemType, filteredItemNames) // Display with filtered names.
}
// --- Displaying Items ---
async function displayItemList(itemType, itemNames) {
	// Hide all containers first
	[charContainer, worldContainer, personaContainer].forEach(container => container.classList.add('hidden'))

	let currentContainer
	switch (itemType) {
		case 'chars': currentContainer = charContainer; break
		case 'worlds': currentContainer = worldContainer; break
		case 'personas': currentContainer = personaContainer; break
	}

	currentContainer.classList.remove('hidden')
	currentContainer.innerHTML = '' // Clear only the current container

	// If itemNames is undefined or null, fetch all item names
	if (!itemNames)
		itemNames = await getItemList(itemType)


	for (const itemName of itemNames.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
		const itemDetails = await getItemDetails(itemType, itemName)
		const itemElement = await renderItemView(itemType, itemDetails, itemName)
		itemElement.classList.add(`${itemType}-card`) // Add a class for easier selection
		currentContainer.appendChild(itemElement)
	}
}


async function fetchAndCacheItemList(itemType) {
	const itemNames = await getItemList(itemType)
	await Promise.all(itemNames.map(itemName => getItemDetails(itemType, itemName)))
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
		button.addEventListener('click', () => {
			if (buttonItem.action)
				eval(buttonItem.action.replaceAll('${name}', action)) // Consider alternatives to eval
			else if (buttonItem.url)
				window.open(buttonItem.url)
			else
				console.warn('No action defined for this button')

		})
		li.appendChild(button)
		functionButtonsContainer.appendChild(li)
	}
}

// --- Tab Management ---
function updateTabContent(itemType) {
	currentItemType = itemType
	localStorage.setItem('lastTab', itemType) // Remember the selected tab

	const pageTitleKey = `home.${itemType}.title`
	const instructionKey = `home.${itemType}.subtitle`
	pageTitle.textContent = geti18n(pageTitleKey)
	instruction.textContent = geti18n(instructionKey)

	// Fetch and display list when switching tabs
	fetchAndCacheItemList(itemType).then(() => {
		displayItemList(itemType)
	})

	itemDescription.innerHTML = geti18n('home.itemDescription') // Reset sidebar
}

// --- Initialization ---
async function initializeApp() {
	applyTheme()
	await initTranslations('home') // Initialize i18n first

	// Fetch initial data (registry and default parts)
	await fetchData()


	const tabs = [
		{ tab: charsTab, tabDesktop: charsTabDesktop, itemType: 'chars' },
		{ tab: worldsTab, tabDesktop: worldsTabDesktop, itemType: 'worlds' },
		{ tab: personasTab, tabDesktop: personasTabDesktop, itemType: 'personas' },
	]

	tabs.forEach(({ tab, tabDesktop, itemType }) => {
		[tab, tabDesktop].filter(Boolean).forEach(tabElement => {
			tabElement.addEventListener('click', () => {
				updateTabContent(itemType)
				// Remove active class from all tabs, then add to current
				tabs.forEach(t => {
					[t.tab, t.tabDesktop].filter(Boolean).forEach(el => el.classList.remove('tab-active'))
				})
				tabElement.classList.add('tab-active')
			})
		})
	})

	// Initial display (using the stored tab or default 'chars')
	updateTabContent(currentItemType)
	// Set the active tab based on currentItemType
	const initialTab = tabs.find(t => t.itemType === currentItemType)
	if (initialTab)
		[initialTab.tab, initialTab.tabDesktop].filter(Boolean).forEach(el => el.classList.add('tab-active'))


	filterInput.addEventListener('input', filterItemList)

	// Refresh data on focus
	window.addEventListener('focus', async () => {
		await fetchData()  //Refresh Registry
		fetchAndCacheItemList(currentItemType).then(() => { // Refresh List
			filterItemList()
		})
	})
}
async function fetchData() {
	const [registryResponse, defaultPartsResponse] = await Promise.all([
		fetch('/api/shells/home/gethomeregistry'),
		fetch('/api/shells/home/getdefaultparts')
	])

	if (registryResponse.ok) {
		homeRegistry = await registryResponse.json()
		displayFunctionButtons() // Update function buttons
	}
	else
		console.error('Failed to fetch home registry:', await registryResponse.text())

	if (defaultPartsResponse.ok)
		defaultParts = await defaultPartsResponse.json()
	else
		console.error('Failed to fetch default parts:', await defaultPartsResponse.text())
}

initializeApp()
