/**
 * 主页 shell 的客户端逻辑。
 */
import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { getUserSetting, setUserSetting, unlockAchievement } from '../../scripts/endpoints.mjs'
import { initTranslations, geti18n, confirmI18n, console, onLanguageChange } from '../../scripts/i18n.mjs'
import { renderMarkdown } from '../../scripts/markdown.mjs'
import { addDefaultPart, unsetDefaultPart, getDefaultParts, getAllCachedPartDetails, getPartDetails, noCacheGetPartDetails } from '../../scripts/parts.mjs'
import { getFiltersFromString, compileFilter, makeSearchable } from '../../scripts/search.mjs'
import { onServerEvent } from '../../scripts/server_events.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import { getHomeRegistry } from './src/endpoints.mjs'

usingTemplates('/shells/home/src/templates')

const functionMenuButton = document.getElementById('function-menu-button')
const itemDescription = document.getElementById('item-description')
const drawerToggle = document.getElementById('drawer-toggle')
const functionButtonsContainer = document.getElementById('function-buttons-container')
const filterInput = document.getElementById('filter-input')
const sfwToggle = document.getElementById('sfw-toggle')
const pageTitle = document.getElementById('page-title')
const instruction = document.getElementById('subtitle')
const partTypesTabsContainer = document.getElementById('part-types-tabs')
const partTypesContainers = document.getElementById('part-types-containers')

let itemDetailsCache = {} // 所有部件类型的组合缓存
let partListsCache = {}   // 每个部件类型的项目列表缓存
let homeRegistry          // 主页注册表
let defaultParts = {}     // 存储默认部件
let isSfw = false         // SFW（安全工作）模式状态
let currentPartType       // 当前选中的部件类型对象

const defaultIcons = {
	chars: 'https://api.iconify.design/line-md/person.svg',
	worlds: 'https://api.iconify.design/line-md/map-marker-radius.svg',
	personas: 'https://api.iconify.design/line-md/emoji-grin.svg',
	AIsourceGenerators: 'https://api.iconify.design/material-symbols/factory.svg',
	AIsources: 'https://api.iconify.design/line-md/engine.svg',
	plugins: 'https://api.iconify.design/mdi/puzzle-outline.svg',
	shells: 'https://api.iconify.design/mynaui/shell.svg',
}
const genericDefaultIcon = 'https://api.iconify.design/line-md/question-circle.svg'

// --- 数据获取 ---

/**
 * 异步获取指定类型和名称的项目的详细信息。
 * @param {string} itemType - 项目的类型 (例如, 'chars')。
 * @param {string} itemName - 项目的名称。
 * @param {boolean} [useCache=true] - 是否应使用缓存数据（如果可用）。
 * @returns {Promise<any>} 返回一个解析为项目详细信息的Promise。
 */
async function getItemDetails(itemType, itemName, useCache = true) {
	const cacheKey = `${itemType}-${itemName}`
	if (useCache && itemDetailsCache[cacheKey] && !itemDetailsCache[cacheKey].supportedInterfaces.includes('info'))
		return itemDetailsCache[cacheKey]

	const fetchFunction = useCache ? getPartDetails : noCacheGetPartDetails
	itemDetailsCache[cacheKey] = await fetchFunction(itemType, itemName)
	return itemDetailsCache[cacheKey]
}

/**
 * 获取指定类型的所有项目名称，结合缓存和非缓存列表。
 * @param {string} itemType - 要获取名称的部件类型。
 * @returns {Promise<string[]>} 一个解析为排序后的项目名称数组的Promise。
 */
async function getAllItemNames(itemType) {
	const { cachedDetails, uncachedNames } = await getAllCachedPartDetails(itemType).catch(e => {
		console.error(`Failed to get all part details for ${itemType}`, e)
		return { cachedDetails: {}, uncachedNames: [] } // return empty object on failure
	})

	// 从批量获取中填充全局缓存
	for (const itemName in cachedDetails)
		itemDetailsCache[`${itemType}-${itemName}`] = cachedDetails[itemName]

	return [
		...Object.keys(cachedDetails),
		...uncachedNames,
	].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

// --- 渲染 ---

let ItemDOMCache = {}

/**
 * 渲染单个项目视图的DOM元素。
 * @param {object} partType - 来自注册表的部件类型对象。
 * @param {any} itemDetails - 要渲染的项目的详细信息。
 * @param {string} itemName - 项目的名称。
 * @returns {Promise<HTMLElement>} 一个解析为渲染后的HTML元素的Promise。
 */
async function renderItemView(partType, itemDetails, itemName) {
	const itemType = partType.name
	const cacheKey = `${itemType}-${itemName}`

	// 检查DOM节点是否已缓存且数据未更改
	if (ItemDOMCache[cacheKey]?.info && JSON.stringify(ItemDOMCache[cacheKey].info) === JSON.stringify(itemDetails))
		return ItemDOMCache[cacheKey].node

	const specificTemplateName = `${itemType.slice(0, -1)}_list_view`
	const genericTemplateName = 'item_list_view'
	let itemElement
	const dataForTemplate = { ...itemDetails, itemType, defaultIcon: defaultIcons[itemType] || genericDefaultIcon }

	try {
		// 首先尝试渲染特定模板
		itemElement = await renderTemplate(specificTemplateName, dataForTemplate)
	} catch (e) {
		// 如果失败（例如，404 Not Found），则回退到通用模板
		console.log(`Specific template '${specificTemplateName}' not found, falling back to generic.`)
		itemElement = await renderTemplate(genericTemplateName, dataForTemplate)
	}

	itemElement.dataset.name = itemName
	await attachCardEventListeners(itemElement, itemDetails, itemName, partType)
	ItemDOMCache[cacheKey] = { info: itemDetails, node: itemElement }  // 缓存信息和DOM节点
	return itemElement
}

/**
 * 渲染一个过滤后的项目列表。
 * @param {object} partType - 当前的部件类型对象。
 * @param {string[]} filteredNames - 要渲染的已过滤项目名称数组。
 * @returns {Promise<void>}
 */
async function renderFilteredItems(partType, filteredNames) {
	const itemType = partType.name
	const currentContainer = partTypesContainers.querySelector(`#${itemType}-container`)
	if (!currentContainer) return

	currentContainer.innerHTML = '' // 清空容器

	const fragment = document.createDocumentFragment()
	const itemElements = {} // 使用一个映射来存放骨架屏，以便稍后替换

	// 为所有元素（真实项目或骨架屏）创建Promise
	const elementPromises = filteredNames.map(itemName => {
		const itemDetails = itemDetailsCache[`${itemType}-${itemName}`]
		if (itemDetails)
			return renderItemView(partType, itemDetails, itemName)
		else
			return renderTemplate('item_list_view_skeleton').then(skeleton => {
				itemElements[itemName] = skeleton
				return skeleton
			})
	})

	// 等待所有初始元素创建完成
	const elements = await Promise.all(elementPromises)
	elements.forEach(el => fragment.appendChild(el))
	currentContainer.appendChild(fragment)

	// 现在，异步获取骨架屏的数据并替换它们
	const uncachedNames = Object.keys(itemElements)
	uncachedNames.forEach(async (itemName) => {
		const skeleton = itemElements[itemName]
		try {
			const itemDetails = await getItemDetails(itemType, itemName, true)
			const itemElement = await renderItemView(partType, itemDetails, itemName)
			skeleton.parentNode?.replaceChild(itemElement, skeleton)
		}
		catch (error) {
			console.error(`Failed to fetch details for ${itemName}:`, error)
			skeleton.remove()
		}
	})
}

/**
 * 在侧边栏中显示项目的描述信息。
 * @param {any} itemDetails - 包含要显示信息的项目详情对象。
 * @returns {Promise<void>}
 */
async function displayItemInfo(itemDetails) {
	itemDescription.innerHTML = itemDetails.info.description_markdown
		? (await renderMarkdown(itemDetails.info.description_markdown)).outerHTML
		: geti18n('home.noDescription')
}

// --- 事件处理器与UI更新 ---

/**
 * 处理鼠标滚轮事件以实现横向滚动。
 * @param {WheelEvent} event - 滚轮事件对象。
 */
const handleMouseWheelScroll = event => {
	const scrollContainer = event.currentTarget
	scrollContainer.scrollLeft += Math.sign(event.deltaY) * 40
	event.preventDefault()
}

/**
 * 为项目卡片元素附加所有必要的事件监听器。
 * @param {HTMLElement} itemElement - 要附加事件监听器的项目卡片元素。
 * @param {any} itemDetails - 与该项目关联的详细信息对象。
 * @param {string} itemName - 项目的名称。
 * @param {object} partType - 来自注册表的部件类型对象。
 * @returns {Promise<void>}
 */
async function attachCardEventListeners(itemElement, itemDetails, itemName, partType) {
	const itemType = partType.name
	const interfacesRegistry = partType.interfaces
	const actionsContainer = itemElement.querySelector('.actions-buttons-container')
	actionsContainer.innerHTML = '' // 清空现有按钮
	actionsContainer.addEventListener('wheel', handleMouseWheelScroll, { passive: false })

	// 添加接口按钮
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

	// 标签点击事件
	itemElement.querySelectorAll('.badge').forEach(tagElement => {
		tagElement.addEventListener('click', event => {
			event.stopPropagation()
			const tag = tagElement.textContent.trim()
			const tagTerm = tag.includes(' ') ? `"${tag}"` : tag
			const filters = new Set(getFiltersFromString(filterInput.value))
			filters.has(tagTerm) ? filters.delete(tagTerm) : filters.add(tagTerm)
			filterInput.value = [...filters].join(' ')
			filterInput.dispatchEvent(new Event('input'))
		})
	})

	itemElement.addEventListener('click', event => {
		if (window.innerWidth < 1024 && !event.target.closest('button')) {
			displayItemInfo(itemDetails)
			if (window.innerWidth < 1024) drawerToggle.checked = true
		}
	})
	itemElement.addEventListener('mouseover', () => {
		if (window.innerWidth >= 1024) displayItemInfo(itemDetails)
	})

	// 刷新卡片数据
	itemElement.querySelector('.refresh-button').addEventListener('click', async () => {
		itemElement.replaceWith(await renderItemView(partType, await getItemDetails(itemType, itemName, false), itemName))
	})

	// 默认项目复选框
	const defaultCheckbox = itemElement.querySelector('.default-checkbox')
	if (defaultCheckbox) {
		const isDefault = (defaultParts[itemType] || []).includes(itemName)
		defaultCheckbox.checked = isDefault
		if (isDefault) itemElement.classList.add('selected-item')

		defaultCheckbox.addEventListener('change', async event => {
			const isChecked = event.target.checked
			const response = await (isChecked ? addDefaultPart : unsetDefaultPart)(itemType, itemName)

			if (response.ok) {
				if (itemType === 'personas' && isChecked)
					unlockAchievement('shells', 'home', 'set_default_persona')
			}
			else {
				console.error('Failed to update default part:', await response.text())
				event.target.checked = !isChecked
			}
		})
	}
}

/**
 * 更新所有项目卡片上“默认”状态的显示。
 */
function updateDefaultPartDisplay() {
	if (!homeRegistry?.part_types) return
	homeRegistry.part_types.forEach(pt => {
		const itemType = pt.name
		const defaultPartNames = defaultParts[itemType] || []
		const container = partTypesContainers.querySelector(`#${itemType}-container`)
		if (!container) return

		container.querySelectorAll('.card-container').forEach(el => {
			el.classList.remove('selected-item')
			const checkbox = el.querySelector('.default-checkbox')
			if (checkbox) checkbox.checked = false
		})

		defaultPartNames.forEach(defaultName => {
			const itemElement = container.querySelector(`.card-container[data-name="${defaultName}"]`)
			if (itemElement) {
				itemElement.classList.add('selected-item')
				const checkbox = itemElement.querySelector('.default-checkbox')
				if (checkbox) checkbox.checked = true
			}
		})
	})
}

/**
 * 更新当前选定选项卡的内容。
 * @param {object} partType - 要显示其内容的部件类型对象。
 * @returns {Promise<void>}
 */
async function updateTabContent(partType) {
	currentPartType = partType
	const itemType = partType.name
	sessionStorage.setItem('fount.home.lastTab', itemType)

	pageTitle.dataset.i18n = `home.${itemType}.title;home.default.title`
	instruction.dataset.i18n = `home.${itemType}.subtitle;home.default.subtitle`

	// 隐藏所有容器，然后显示当前的容器
	if (partTypesContainers.childNodes.length) {
		partTypesContainers.childNodes.forEach(container => container.classList.add('hidden'))
		const currentContainer = partTypesContainers.querySelector(`#${itemType}-container`)
		if (currentContainer) currentContainer.classList.remove('hidden')
	}

	const allItemNames = await getAllItemNames(itemType)

	makeSearchable({
		searchInput: filterInput,
		data: allItemNames,
		/**
		 * 用于搜索的数据访问器。
		 * @param {string} name - 项目名称。
		 * @returns {any} 与项目关联的数据。
		 */
		dataAccessor: (name) => itemDetailsCache[`${itemType}-${name}`] || name,
		/**
		 * 过滤后处理更新的回调函数。
		 * @param {string[]} filteredNames - 过滤后的项目名称数组。
		 * @returns {void}
		 */
		onUpdate: (filteredNames) => renderFilteredItems(partType, filteredNames),
	})

	itemDescription.innerHTML = geti18n('home.itemDescription') // 重置侧边栏

	// 设置活动选项卡的UI
	if (partTypesTabsContainer.childNodes.length) {
		partTypesTabsContainer.childNodes.forEach(tab => tab.classList.remove('tab-active'))
		const currentTab = partTypesTabsContainer.querySelector(`[data-target="${itemType}-container"]`)
		if (currentTab) currentTab.classList.add('tab-active')
	}
}

// --- 初始化 ---

/**
 * 为每种部件类型设置选项卡和内容容器。
 * @param {object[]} partTypes - 来自注册表的部件类型对象数组。
 */
function setupPartTypeUI(partTypes) {
	partTypesTabsContainer.innerHTML = ''
	partTypesContainers.innerHTML = ''

	partTypes.forEach(pt => {
		const itemType = pt.name
		const tab = document.createElement('div')
		tab.role = 'tab'
		tab.className = 'tab'
		tab.dataset.target = `${itemType}-container`
		tab.dataset.i18n = `home.part_types.${itemType};'${itemType}'`
		tab.addEventListener('click', e => {
			e.preventDefault()
			updateTabContent(pt)
		})
		partTypesTabsContainer.appendChild(tab)

		const container = document.createElement('div')
		container.id = `${itemType}-container`
		container.className = 'grid gap-4 hidden part-items-grid'
		partTypesContainers.appendChild(container)
	})
}

/**
 * 异步显示功能按钮菜单。
 * @returns {Promise<void>}
 */
async function displayFunctionButtons() {
	functionButtonsContainer.innerHTML = '' // 清空现有按钮
	if (!homeRegistry?.home_function_buttons) return // 如果注册表未加载，则避免错误

	/**
	 * 创建一个菜单项（可以是按钮或子菜单）。
	 * @param {any} buttonItem - 按钮项目数据。
	 * @returns {HTMLElement} 菜单项的 `<li>` 元素。
	 */
	const createMenuItem = (buttonItem) => {
		const li = document.createElement('li')

		// 如果按钮有子项目，则为子菜单
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

			// 渲染前按级别对子项进行排序
			const sortedChildren = buttonItem.sub_items.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))

			sortedChildren.forEach(child => {
				ul.appendChild(createMenuItem(child))
			})
			details.appendChild(ul)
			li.appendChild(details)
		}
		else {
			// 这是一个常规按钮
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
	 * 渲染菜单。
	 * @param {any[]} items - 要渲染的项目。
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
	 * 扁平化项目数组。
	 * @param {any[]} items - 要扁平化的项目。
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
	 * 根据搜索输入过滤并重新渲染菜单。
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

	renderMenu(originalItems) // 初始渲染
}

/**
 * 刷新当前选项卡，重新加载所有数据和UI组件。
 * @returns {Promise<void>}
 */
async function refreshCurrentTab() {
	itemDetailsCache = {}
	ItemDOMCache = {}
	partListsCache = {}
	await Promise.all([
		getHomeRegistry().then(async data => {
			homeRegistry = data
			await displayFunctionButtons()
		}).catch(error => console.error('Failed to fetch home registry:', error)),
		getDefaultParts().then(data => {
			defaultParts = data
		}).catch(error => console.error('Failed to fetch default parts:', error)),
	])
	await updateTabContent(currentPartType)
	updateDefaultPartDisplay()
}

/**
 * 处理 'home-registry-updated' 服务端事件。
 * 刷新主页注册表，更新UI，并重新渲染当前选项卡。
 * @returns {Promise<void>}
 */
const handleHomeRegistryUpdate = async () => {
	await getHomeRegistry().then(async data => {
		homeRegistry = data
		setupPartTypeUI(homeRegistry.part_types)
		await displayFunctionButtons()
		await refreshCurrentTab()
	}).catch(error => console.error('获取主页注册表失败:', error))
}

/**
 * 处理 'part-installed' 服务端事件。
 * 如果部件类型匹配，则将新安装的部件添加到缓存并更新当前选项卡。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已安装部件的类型。
 * @param {string} payload.partname - 已安装部件的名称。
 * @returns {Promise<void>}
 */
const handlePartInstalled = async ({ parttype, partname }) => {
	partListsCache[parttype]?.push?.(partname)
	if (currentPartType && parttype === currentPartType.name)
		await updateTabContent(currentPartType)
}

/**
 * 处理 'part-uninstalled' 服务端事件。
 * 如果部件类型匹配，则从缓存中删除已卸载的部件并更新当前选项卡。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已卸载部件的类型。
 * @param {string} payload.partname - 已卸载部件的名称。
 * @returns {Promise<void>}
 */
const handlePartUninstalled = async ({ parttype, partname }) => {
	if (partListsCache[parttype]) {
		const index = partListsCache[parttype].indexOf(partname)
		if (index > -1) partListsCache[parttype].splice(index, 1)
	}
	delete itemDetailsCache[`${parttype}-${partname}`]
	delete ItemDOMCache[`${parttype}-${partname}`]

	if (currentPartType && parttype === currentPartType.name)
		await updateTabContent(currentPartType)
}

/**
 * 处理 'default-part-setted' 服务端事件。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已设置默认部件的类型。
 * @param {string} payload.partname - 新的默认部件的名称。
 */
const handleDefaultPartSetted = ({ parttype, partname }) => {
	defaultParts[parttype] ??= []
	defaultParts[parttype].push(partname)

	updateDefaultPartDisplay()
}

/**
 * 处理 'default-part-unsetted' 服务端事件。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已取消设置默认部件的类型。
 * @param {string} payload.partname - 已取消设置的默认部件的名称。
 */
const handleDefaultPartUnsetted = ({ parttype, partname }) => {
	const parts = defaultParts[parttype] ?? []
	const index = parts.indexOf(partname)
	if (index > -1) parts.splice(index, 1)
	if (!parts.length) delete defaultParts[parttype]

	updateDefaultPartDisplay()
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function initializeApp() {
	applyTheme()
	await initTranslations('home')

	unlockAchievement('shells', 'home', 'first_login')

	// SFW 切换
	sfwToggle.checked = isSfw = await getUserSetting('sfw').catch(() => false)
	sfwToggle.addEventListener('change', async () => {
		if (sfwToggle.checked === isSfw) return
		try {
			await setUserSetting('sfw', isSfw = sfwToggle.checked)
			unlockAchievement('shells', 'home', isSfw ? 'sfw_mode_on' : 'sfw_mode_off')
			refreshCurrentTab()
		}
		catch (e) {
			console.error('Failed to set SFW state', e)
			sfwToggle.checked = isSfw = !isSfw
		}
	})

	// 获取数据并设置UI
	try {
		homeRegistry = await getHomeRegistry()
		defaultParts = await getDefaultParts()
	}
	catch (error) {
		console.error('Failed to fetch initial data:', error)
		showToast('error', 'Failed to load page data. Please try refreshing.')
		return // Stop execution if essential data fails to load
	}

	setupPartTypeUI(homeRegistry.part_types)
	displayFunctionButtons()

	// 确定初始部件类型并全局设置以进行事件驱动的渲染
	const lastTab = sessionStorage.getItem('fount.home.lastTab')
	currentPartType = homeRegistry.part_types.find(pt => pt.name === lastTab) || homeRegistry.part_types[0]

	// 在初始数据获取后附加事件处理器
	onLanguageChange(refreshCurrentTab)

	functionMenuButton.addEventListener('click', () => {
		unlockAchievement('shells', 'home', 'open_function_list')
	}, { once: true })

	onServerEvent('default-part-setted', handleDefaultPartSetted)
	onServerEvent('default-part-unsetted', handleDefaultPartUnsetted)
	onServerEvent('home-registry-updated', handleHomeRegistryUpdate)
	onServerEvent('part-installed', handlePartInstalled)
	onServerEvent('part-uninstalled', handlePartUninstalled)

	// Esc键确认
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape')
			if (!confirmI18n('home.escapeConfirm'))
				event.stopImmediatePropagation()
	}, true)
}

initializeApp().catch(error => {
	showToast('error', error.message)
	setTimeout(() => window.location.href = '/login', 5000)
})
