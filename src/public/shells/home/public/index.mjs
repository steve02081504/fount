/**
 * 主页 shell 的客户端逻辑。
 */
import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { getUserSetting, setUserSetting, unlockAchievement } from '../../scripts/endpoints.mjs'
import { initTranslations, geti18n, confirmI18n, console, onLanguageChange } from '../../scripts/i18n.mjs'
import { renderMarkdown } from '../../scripts/markdown.mjs'
import {
	getCharDetails, noCacheGetCharDetails, getPersonaDetails, noCacheGetPersonaDetails, getWorldDetails, noCacheGetWorldDetails,
	setDefaultPart, getDefaultParts, getAllCachedPartDetails
} from '../../scripts/parts.mjs'
import { getFiltersFromString, compileFilter, makeSearchable } from '../../scripts/search.mjs'
import { onServerEvent } from '../../scripts/server_events.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import { getHomeRegistry } from './src/endpoints.mjs'

usingTemplates('/shells/home/src/templates')

const functionMenuButton = document.getElementById('function-menu-button')
const charContainer = document.getElementById('char-container')
const worldContainer = document.getElementById('world-container')
const personaContainer = document.getElementById('persona-container')
const itemDescription = document.getElementById('item-description')
const drawerToggle = document.getElementById('drawer-toggle')
const functionButtonsContainer = document.getElementById('function-buttons-container')
const filterInput = document.getElementById('filter-input')
const sfwToggle = document.getElementById('sfw-toggle')
const pageTitle = document.getElementById('page-title')
const instruction = document.getElementById('subtitle')

const charsTab = document.getElementById('chars-tab')
const worldsTab = document.getElementById('worlds-tab')
const personasTab = document.getElementById('personas-tab')
const charsTabDesktop = document.getElementById('chars-tab-desktop')
const worldsTabDesktop = document.getElementById('worlds-tab-desktop')
const personasTabDesktop = document.getElementById('personas-tab-desktop')

let itemDetailsCache = {} // Combined cache
let partListsCache = {} // Cache for item lists
let currentItemType = sessionStorage.getItem('fount.home.lastTab') || 'chars' // Persist tab selection
let homeRegistry
let defaultParts = {} // Store default parts
let isSfw = false

/**
 * 处理鼠标滚轮滚动事件。
 * @param {WheelEvent} event - 滚轮事件。
 */
const handleMouseWheelScroll = event => {
	const scrollContainer = event.currentTarget
	scrollContainer.scrollLeft += Math.sign(event.deltaY) * 40
	event.preventDefault()
}

/**
 * 获取项目详细信息。
 * @param {string} itemType - 项目类型。
 * @param {string} itemName - 项目名称。
 * @param {boolean} [useCache=true] - 是否使用缓存。
 * @returns {Promise<any>} - 项目详细信息。
 */
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
let ItemDOMCache = {}

/**
 * 渲染项目视图。
 * @param {string} itemType - 项目类型。
 * @param {any} itemDetails - 项目详细信息。
 * @param {string} itemName - 项目名称。
 * @returns {Promise<HTMLElement>} - 项目元素。
 */
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

/**
 * 附加卡片事件监听器。
 * @param {HTMLElement} itemElement - 项目元素。
 * @param {any} itemDetails - 项目详细信息。
 * @param {string} itemName - 项目名称。
 * @param {any[]} interfacesRegistry - 接口注册表。
 * @param {string} itemType - 项目类型。
 * @returns {Promise<void>}
 */
async function attachCardEventListeners(itemElement, itemDetails, itemName, interfacesRegistry, itemType) {
	const actionsContainer = itemElement.querySelector('.actions-buttons-container')
	actionsContainer.innerHTML = '' // Clear existing buttons
	actionsContainer.addEventListener('wheel', handleMouseWheelScroll, { passive: false })

	// Add interface buttons
	for (const interfaceItem of interfacesRegistry)
		if (!interfaceItem.interface || itemDetails.supportedInterfaces.includes(interfaceItem.interface)) {
			const button = document.createElement('a')
			const classes = ['btn', `btn-${interfaceItem.type ?? 'primary'}`, ...interfaceItem.classes ? interfaceItem.classes.split(' ') : []]
			button.classList.add(...classes)
			if (interfaceItem.style) button.style.cssText = interfaceItem.style

			button.innerHTML = interfaceItem.button ?? /* html */ '<img src="https://api.iconify.design/line-md/question-circle.svg" />'
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
		tagElement.addEventListener('click', event => {
			event.stopPropagation()
			const tag = tagElement.textContent.trim()
			const tagTerm = tag.includes(' ') ? `"${tag}"` : tag
			const filters = new Set(getFiltersFromString(filterInput.value))
			filters.has(tagTerm) ? filters.delete(tagTerm) : filters.add(tagTerm)
			filterInput.value = [...filters].join(' ')

			// Dispatch input event to trigger makeSearchable
			filterInput.dispatchEvent(new Event('input'))
		})
	})

	/**
	 * 单击处理程序
	 * @returns {void}
	 */
	const clickHandler = () => {
		displayItemInfo(itemDetails)
		if (window.innerWidth < 1024) drawerToggle.checked = true
	}

	itemElement.addEventListener('click', event => {
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

		defaultCheckbox.addEventListener('change', async event => {
			const isChecked = event.target.checked
			// Update default part in backend
			const response = await setDefaultPart(currentItemType.slice(0, -1), isChecked ? itemName : null)

			if (response.ok) {
				// Update local state and UI
				defaultParts[currentItemType.slice(0, -1)] = isChecked ? itemName : null
				updateDefaultPartDisplay()
				if (itemType === 'personas' && isChecked)
					unlockAchievement('shells', 'home', 'set_default_persona')
			}
			else
				console.error('Failed to update default part:', await response.text())
		})
	}
}

/**
 * 更新默认部件显示。
 */
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

/**
 * 显示项目信息。
 * @param {any} itemDetails - 项目详细信息。
 * @returns {Promise<void>}
 */
async function displayItemInfo(itemDetails) {
	itemDescription.innerHTML = itemDetails.info.description_markdown
		? (await renderMarkdown(itemDetails.info.description_markdown)).outerHTML
		: geti18n('home.noDescription')
}

/**
 * 渲染已过滤的项目。
 * @param {string} itemType - 项目类型。
 * @param {string[]} filteredNames - 已过滤的名称。
 * @returns {Promise<void>}
 */
async function renderFilteredItems(itemType, filteredNames) {
	let currentContainer
	switch (itemType) {
		case 'chars': currentContainer = charContainer; break
		case 'worlds': currentContainer = worldContainer; break
		case 'personas': currentContainer = personaContainer; break
	}
	currentContainer.classList.remove('hidden')
	currentContainer.innerHTML = '' // Clear container

	const fragment = document.createDocumentFragment()
	const itemElements = {} // Use a map to hold skeletons for later replacement

	// Create promises for all elements (real items or skeletons)
	const elementPromises = filteredNames.map(itemName => {
		const itemDetails = itemDetailsCache[`${itemType}-${itemName}`]
		if (itemDetails)
			return renderItemView(itemType, itemDetails, itemName)
		else
			return renderTemplate('item_list_view_skeleton').then(skeleton => {
				itemElements[itemName] = skeleton
				return skeleton
			})
	})

	// Wait for all initial elements to be created
	const elements = await Promise.all(elementPromises)
	elements.forEach(el => fragment.appendChild(el))
	currentContainer.appendChild(fragment)

	// Now, asynchronously fetch data for the skeletons and replace them
	const uncachedNames = Object.keys(itemElements)
	uncachedNames.forEach(async (itemName) => {
		const skeleton = itemElements[itemName]
		try {
			const itemDetails = await getItemDetails(itemType, itemName, true)
			const itemElement = await renderItemView(itemType, itemDetails, itemName)
			skeleton.parentNode?.replaceChild(itemElement, skeleton)
		}
		catch (error) {
			console.error(`Failed to fetch details for ${itemName}:`, error)
			skeleton.remove()
		}
	})
}

/**
 * 获取所有项目名称。
 * @param {string} itemType - 项目类型。
 * @returns {Promise<string[]>} - 项目名称。
 */
async function getAllItemNames(itemType) {
	const { cachedDetails, uncachedNames } = await getAllCachedPartDetails(itemType).catch(e => {
		console.error(`Failed to get all part details for ${itemType}`, e)
		return { cachedDetails: {}, uncachedNames: [] } // return empty object on failure
	})

	// Populate global cache from the bulk fetch
	for (const itemName in cachedDetails)
		itemDetailsCache[`${itemType}-${itemName}`] = cachedDetails[itemName]

	return [
		...Object.keys(cachedDetails),
		...uncachedNames,
	].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}


/**
 * 显示功能按钮。
 * @returns {Promise<void>}
 */
async function displayFunctionButtons() {
	functionButtonsContainer.innerHTML = '' // Clear existing buttons
	if (!homeRegistry?.home_function_buttons) return // Avoid error if registry is not loaded

	/**
	 * @param {any} buttonItem - 按钮项目。
	 * @returns {HTMLElement} - 菜单项。
	 */
	const createMenuItem = (buttonItem) => {
		const li = document.createElement('li')

		// A button is a submenu if it has sub_items
		if (buttonItem.sub_items?.length) {
			const details = document.createElement('details')
			const summary = document.createElement('summary')

			const iconSpan = document.createElement('span')
			iconSpan.classList.add('mr-2')
			iconSpan.innerHTML = buttonItem.button ?? /* html */ '<img src="https://api.iconify.design/line-md/folder-filled.svg" class="text-icon" />'
			svgInliner(iconSpan)

			const titleSpan = document.createElement('span')
			titleSpan.textContent = buttonItem.info.title

			summary.append(iconSpan, titleSpan)
			details.appendChild(summary)

			const ul = document.createElement('ul')
			ul.classList.add('rounded-t-none')

			// Sort children by level before rendering
			const sortedChildren = buttonItem.sub_items.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))

			sortedChildren.forEach(child => {
				ul.appendChild(createMenuItem(child))
			})
			details.appendChild(ul)
			li.appendChild(details)
		}
		else {
			// It's a regular button
			const button = document.createElement('a')
			const classes = ['flex', 'items-center', 'justify-start', ...buttonItem.classes ? buttonItem.classes.split(' ') : []]
			button.classList.add(...classes)
			if (buttonItem.style) button.style.cssText = buttonItem.style

			const iconSpan = document.createElement('span')
			iconSpan.classList.add('mr-2')
			iconSpan.innerHTML = buttonItem.button ?? /* html */ '<img src="https://api.iconify.design/line-md/question-circle.svg" class="text-icon" />'
			svgInliner(iconSpan)

			const titleSpan = document.createElement('span')
			titleSpan.textContent = buttonItem.info.title

			button.append(iconSpan, titleSpan)
			if (buttonItem.action)
				button.addEventListener('click', () => async_eval(buttonItem.action, { geti18n }))
			else if (buttonItem.url)
				button.href = buttonItem.url
			else if (!buttonItem.sub_items)  // Don't warn for menu containers that are empty
				console.warn('No action defined for this button', buttonItem)

			li.appendChild(button)
		}
		return li
	}

	const searchInput = document.createElement('input')
	searchInput.type = 'text'
	searchInput.classList.add('input', 'input-sm', 'w-full')
	searchInput.dataset.i18n = 'home.functionMenu.search'
	searchInput.addEventListener('click', e => e.stopPropagation())
	functionButtonsContainer.appendChild(searchInput)

	const menuItemsContainer = document.createElement('ul')
	menuItemsContainer.classList.add('menu', 'p-0', 'w-full')
	functionButtonsContainer.appendChild(menuItemsContainer)

	/**
	 * @param {any[]} items - 项目。
	 */
	const renderMenu = (items) => {
		menuItemsContainer.innerHTML = ''
		items.forEach(buttonItem => {
			menuItemsContainer.appendChild(createMenuItem(buttonItem))
		})
	}

	const originalItems = homeRegistry.home_function_buttons

	const allButtons = []
	/**
	 * 扁平化项目。
	 * @param {any[]} items - 项目。
	 * @returns {void}
	 */
	function flatten(items) {
		items.forEach(item => {
			allButtons.push(item)
			if (item.sub_items)
				flatten(item.sub_items)
		})
	}
	flatten(originalItems)
	const leafButtons = allButtons.filter(item => !item.sub_items?.length)

	/**
	 * 过滤并渲染
	 * @returns {void}
	 */
	const filterAndRender = () => {
		const filterValue = searchInput.value
		if (!filterValue) return renderMenu(originalItems)

		const filterFn = compileFilter(filterValue)
		const filteredButtons = leafButtons.filter(button => filterFn(button.info))
		renderMenu(filteredButtons)
	}

	searchInput.addEventListener('input', filterAndRender)

	renderMenu(originalItems) // Initial render
}

/**
 * 更新选项卡内容。
 * @param {string} itemType - 项目类型。
 * @returns {Promise<void>}
 */
async function updateTabContent(itemType) {
	currentItemType = itemType
	sessionStorage.setItem('fount.home.lastTab', itemType) // Persist tab in sessionStorage

	pageTitle.dataset.i18n = `home.${itemType}.title`
	instruction.dataset.i18n = `home.${itemType}.subtitle`

	// Hide all containers
	;[charContainer, worldContainer, personaContainer].forEach(container => {
		container.classList.add('hidden')
	})

	const allItemNames = await getAllItemNames(itemType)

	makeSearchable({
		searchInput: filterInput,
		data: allItemNames,
		/**
		 * @param {string} name - 名称。
		 * @returns {any} - 数据。
		 */
		dataAccessor: (name) => {
			const details = itemDetailsCache[`${itemType}-${name}`]
			return details || name
		},
		/**
		 * @param {string[]} filteredNames - 已过滤的名称。
		 */
		onUpdate: (filteredNames) => {
			renderFilteredItems(itemType, filteredNames)
		},
	})

	itemDescription.innerHTML = geti18n('home.itemDescription') // Reset sidebar

	// Set active tab UI
	const tabs = [
		{ tab: charsTab, tabDesktop: charsTabDesktop, itemType: 'chars' },
		{ tab: worldsTab, tabDesktop: worldsTabDesktop, itemType: 'worlds' },
		{ tab: personasTab, tabDesktop: personasTabDesktop, itemType: 'personas' },
	]
	tabs.forEach(t => {
		[t.tab, t.tabDesktop].filter(Boolean).forEach(el => el.classList.remove('tab-active'))
	})
	const initialTab = tabs.find(t => t.itemType === itemType)
	if (initialTab)
		[initialTab.tab, initialTab.tabDesktop].filter(Boolean).forEach(el => el.classList.add('tab-active'))
}

/**
 * 获取数据。
 * @returns {Promise<void>}
 */
async function fetchData() {
	await Promise.all([
		getHomeRegistry().then(async data => {
			homeRegistry = data
			await displayFunctionButtons()
		}).catch(error => console.error('Failed to fetch home registry:', error)),
		getDefaultParts().then(data => {
			defaultParts = data
			updateDefaultPartDisplay()
		}).catch(error => console.error('Failed to fetch default parts:', error)),
	])
}

/**
 * 刷新当前选项卡。
 * @returns {Promise<void>}
 */
async function refreshCurrentTab() {
	itemDetailsCache = {}
	ItemDOMCache = {}
	partListsCache = {}
	await fetchData()
	await updateTabContent(currentItemType)
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function initializeApp() {
	applyTheme()
	await initTranslations('home') // Initialize i18n first

	unlockAchievement('shells', 'home', 'first_login')

	// SFW Toggle Initialization
	sfwToggle.checked = isSfw = await getUserSetting('sfw').catch(() => false)
	sfwToggle.addEventListener('change', async () => {
		if (sfwToggle.checked == isSfw) return // No change
		try {
			await setUserSetting('sfw', isSfw = sfwToggle.checked)
			unlockAchievement('shells', 'home', isSfw ? 'sfw_mode_on' : 'sfw_mode_off')
		}
		catch (e) {
			console.error('Failed to set SFW state', e)
			sfwToggle.checked = isSfw = !isSfw
			return
		}
		refreshCurrentTab()
	})

	onLanguageChange(refreshCurrentTab)

	const tabConfigs = [
		{ elements: [charsTab, charsTabDesktop], type: 'chars' },
		{ elements: [worldsTab, worldsTabDesktop], type: 'worlds' },
		{ elements: [personasTab, personasTabDesktop], type: 'personas' },
	]

	tabConfigs.forEach(({ elements, type }) => {
		elements.filter(Boolean).forEach(el => {
			el.addEventListener('click', e => {
				e.preventDefault()
				updateTabContent(type)
			})
		})
	})

	functionMenuButton.addEventListener('click', () => {
		unlockAchievement('shells', 'home', 'open_function_list')
	}, { once: true })

	// The focus listener is no longer needed as all updates are handled by websockets.

	onServerEvent('default-part-updated', ({ parttype, partname }) => {
		console.log(`Received default-part-update: ${parttype}=${partname}`)
		if (partname)
			defaultParts[parttype] = partname
		else
			delete defaultParts[parttype]

		updateDefaultPartDisplay()
	})

	onServerEvent('home-registry-updated', async () => {
		console.log('Received home-registry-update, refreshing...')
		await getHomeRegistry().then(async data => {
			homeRegistry = data
			await displayFunctionButtons()
			// The registry also affects item cards, so we need to refresh them
			await refreshCurrentTab()
		}).catch(error => console.error('Failed to fetch home registry:', error))
	})

	onServerEvent('part-installed', async ({ parttype, partname }) => {
		partListsCache[parttype]?.push?.(partname)

		if (parttype === currentItemType)
			await updateTabContent(currentItemType)
	})

	onServerEvent('part-uninstalled', async ({ parttype, partname }) => {
		if (partListsCache[parttype]) {
			const index = partListsCache[parttype].indexOf(partname)
			if (index + 1) partListsCache[parttype].splice(index, 1)
		}
		delete itemDetailsCache[`${parttype}-${partname}`]
		delete ItemDOMCache[`${parttype}-${partname}`]

		if (parttype === currentItemType)
			await updateTabContent(currentItemType)
	})

	// esc按键
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape')
			if (!confirmI18n('home.escapeConfirm'))
				event.stopImmediatePropagation()
	}, true)
}

initializeApp().catch(error => {
	showToast('error', error.message)
	window.location.href = '/login'
})
