import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { unlockAchievement } from '../../../scripts/endpoints.mjs'
import { geti18n, console } from '../../../scripts/i18n.mjs'
import { renderMarkdown } from '../../../scripts/markdown.mjs'
import { onElementRemoved } from '../../../scripts/onElementRemoved.mjs'
import { addDefaultPart, unsetDefaultPart, getDefaultParts } from '../../../scripts/parts.mjs'
import { getFiltersFromString, compileFilter, makeSearchable } from '../../../scripts/search.mjs'
import { svgInliner } from '../../../scripts/svgInliner.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'


import { defaultIcons, genericDefaultIcon } from './constants.mjs'
import { partDetailsCache, getpartDetails, clearCache, getAllpartNames } from './data.mjs'
import { getHomeRegistry } from './endpoints.mjs'
import { setHomeRegistry, setDefaultParts, setCurrentPartType, homeRegistry, defaultParts, currentPartType, preloadDragGenerators } from './state.mjs'
import { createActionButtons, showItemModal } from './ui/itemModal.mjs'


// DOM Elements

/**
 * 功能菜单按钮元素。
 * @type {HTMLElement}
 */
export const functionMenuButton = document.getElementById('function-menu-button')
/**
 * 项目描述元素。
 * @type {HTMLElement}
 */
export const itemDescription = document.getElementById('item-description')
/**
 * 功能按钮容器元素。
 * @type {HTMLElement}
 */
export const functionButtonsContainer = document.getElementById('function-buttons-container')
/**
 * 过滤输入框元素。
 * @type {HTMLInputElement}
 */
export const filterInput = document.getElementById('filter-input')
/**
 * SFW（安全工作）模式切换开关元素。
 * @type {HTMLInputElement}
 */
export const sfwToggle = document.getElementById('sfw-toggle')
/**
 * 页面标题元素。
 * @type {HTMLElement}
 */
export const pageTitle = document.getElementById('page-title')
/**
 * 指示文本元素。
 * @type {HTMLElement}
 */
export const instruction = document.getElementById('subtitle')
/**
 * 桌面端部件类型选项卡容器元素。
 * @type {HTMLElement}
 */
export const partTypesTabsContainerDesktop = document.getElementById('part-types-tabs-desktop')
/**
 * 移动端部件类型选项卡容器元素。
 * @type {HTMLElement}
 */
export const partTypesTabsContainerMobile = document.getElementById('part-types-tabs-mobile')
/**
 * 部件类型内容容器元素。
 * @type {HTMLElement}
 */
export const partTypesContainers = document.getElementById('part-types-containers')

usingTemplates('/shells/home/src/templates')

/**
 * 渲染单个项目视图的DOM元素。
 * @param {object} part - 包含部件类型、部件名称和部件详细信息的部件对象。
 * @returns {Promise<HTMLElement>} 一个解析为渲染后的HTML元素的Promise。
 */
export async function renderItemView(part) {
	const { parttype, partname, partdetails } = part

	const itemElement = await renderTemplate('item_list_view', {
		...partdetails,
		parttype,
		defaultIcon: defaultIcons[parttype] || genericDefaultIcon
	})

	itemElement.dataset.name = partname
	await attachCardEventListeners(itemElement, part)
	return itemElement
}

/**
 * 渲染一个过滤后的项目列表。
 * @param {object} partTypeObject - 当前的部件类型对象。
 * @param {string[]} filteredNames - 要渲染的已过滤项目名称数组。
 * @returns {Promise<void>}
 */
export async function renderFilteredItems(partTypeObject, filteredNames) {
	const partTypeName = partTypeObject.name
	const currentContainer = partTypesContainers.querySelector(`#${partTypeName}-container`)
	if (!currentContainer) return

	currentContainer.innerHTML = '' // 清空容器

	if (!filteredNames.length)
		return currentContainer.appendChild(await renderTemplate('empty_list_view'))

	const fragment = document.createDocumentFragment()
	const itemElements = {} // 使用一个映射来存放骨架屏，以便稍后替换

	// 为所有元素（真实项目或骨架屏）创建Promise
	const elementPromises = filteredNames.map(partName => {
		const partDetails = partDetailsCache[partTypeName]?.[partName] // Use new cache access
		if (partDetails) {
			const part = { parttype: partTypeName, partname: partName, partdetails: partDetails, partTypeConfig: partTypeObject } // Create part object
			return renderItemView(part) // Pass part object
		}
		else
			return renderTemplate('item_list_view_skeleton').then(skeleton => {
				itemElements[partName] = skeleton
				return skeleton
			})
	})

	// 等待所有初始元素创建完成
	const elements = await Promise.all(elementPromises)
	elements.forEach(el => fragment.appendChild(el))
	currentContainer.appendChild(fragment)

	// 现在，异步获取骨架屏的数据并替换它们
	const uncachedNames = Object.keys(itemElements)
	uncachedNames.forEach(async (partName) => {
		const skeleton = itemElements[partName]
		try {
			const partDetails = await getpartDetails(partTypeName, partName, true)
			const part = { parttype: partTypeName, partname: partName, partdetails: partDetails, partTypeConfig: partTypeObject } // Create part object
			const itemElement = await renderItemView(part) // Pass part object
			skeleton.parentNode?.replaceChild(itemElement, skeleton)
		}
		catch (error) {
			console.error(`Failed to fetch details for ${partName}:`, error)
			skeleton.remove()
		}
	})
}

/**
 * 在侧边栏中显示项目的描述信息。
 * @param {object} part - The part object containing parttype, partname, and partdetails.
 * @returns {Promise<void>}
 */
export async function displayItemInfo(part) {
	if (part.partdetails.info.description_markdown) {
		const fragment = await renderMarkdown(part.partdetails.info.description_markdown)
		itemDescription.innerHTML = ''
		itemDescription.appendChild(fragment)
	} else itemDescription.innerHTML = geti18n('home.noDescription')
}

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
 * @param {object} part - 包含部件类型、部件名称和部件详细信息的部件对象。
 * @returns {Promise<void>}
 */
export async function attachCardEventListeners(itemElement, part) {
	const { parttype, partname, partdetails } = part
	const actionsContainer = itemElement.querySelector('.actions-buttons-container')
	actionsContainer.innerHTML = '' // 清空现有按钮

	const controller = new AbortController()
	const { signal } = controller

	actionsContainer.addEventListener('wheel', handleMouseWheelScroll, { passive: false, signal })

	// 使用 createActionButtons
	const buttons = createActionButtons(part)
	buttons.forEach(button => actionsContainer.appendChild(button))

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
		}, { signal })
	})

	itemElement.addEventListener('click', event => {
		// 如果点击在卡片上但不在交互元素上，则显示模态框。
		if (!event.target.closest('a, button, .refresh-button, .default-checkbox, .details-container')) {
			event.preventDefault()
			event.stopPropagation()
			showItemModal(part)
		}
	}, { signal })

	itemElement.addEventListener('mouseover', () => {
		if (window.innerWidth >= 1024) displayItemInfo(part)
	}, { signal })

	// 刷新卡片数据
	itemElement.querySelector('.refresh-button').addEventListener('click', async (e) => {
		e.stopPropagation()
		const updatedpartDetails = await getpartDetails(parttype, partname, false)
		const updatedPart = { parttype, partname, partdetails: updatedpartDetails, partTypeConfig: part.partTypeConfig }
		itemElement.replaceWith(await renderItemView(updatedPart))
	}, { signal })

	// 默认项目复选框
	const defaultCheckbox = itemElement.querySelector('.default-checkbox')
	if (defaultCheckbox) {
		const isDefault = (defaultParts[parttype] || []).includes(partname)
		defaultCheckbox.checked = isDefault
		if (isDefault) itemElement.classList.add('selected-item')

		defaultCheckbox.addEventListener('change', async event => {
			const isChecked = event.target.checked
			const response = await (isChecked ? addDefaultPart : unsetDefaultPart)(parttype, partname)

			if (response.ok) {
				if (parttype === 'personas' && isChecked)
					unlockAchievement('shells', 'home', 'set_default_persona')
			}
			else {
				console.error('Failed to update default part:', await response.text())
				event.target.checked = !isChecked
			}
		}, { signal })
	}

	// 初始化Vanilla Tilt
	window.VanillaTilt?.init?.(itemElement, {
		max: 15,
		speed: 400,
		glare: true,
		'max-glare': 0.2,
	})

	// 拖出功能
	itemElement.addEventListener('mousedown', e => {
		// If the mousedown is on an interactive part, don't make the card element draggable.
		// This allows text selection, button clicks, etc. to work as expected.
		if (e.target.closest('a, button, input, .text-content, .details-container'))
			itemElement.draggable = false
		else
			// Otherwise, allow dragging the whole card.
			itemElement.draggable = true
	}, { signal })

	/**
	 * Cleanup draggable state to prevent unintended behavior.
	 * @returns {void}
	 */
	const cleanupDraggable = () => { itemElement.draggable = false }
	itemElement.addEventListener('mouseup', cleanupDraggable, { signal })
	itemElement.addEventListener('mouseleave', cleanupDraggable, { signal })
	itemElement.addEventListener('dragend', cleanupDraggable, { signal })

	itemElement.addEventListener('dragstart', event => {
		event.dataTransfer.effectAllowed = 'copy'

		// Set default text/plain data
		const textDetails = [`${partname}`]
		if (partdetails.info?.version) textDetails.push(`Version: ${partdetails.info.version}`)
		if (partdetails.info?.author) textDetails.push(`Author: ${partdetails.info.author}`)
		if (partdetails.info?.home_page) textDetails.push(`Homepage: ${partdetails.info.home_page}`)
		event.dataTransfer.setData('text/plain', textDetails.join('\n'))

		// Set default URL data
		const partUrl = `fount://page/shells/home/?parttype=${parttype}&partname=${partname}`
		const fountUrl = `https://steve02081504.github.io/fount/protocol?url=${encodeURIComponent(partUrl)}`
		event.dataTransfer.setData('text/uri-list', fountUrl)
		event.dataTransfer.setData('URL', fountUrl)

		const generators = homeRegistry.home_drag_out_generators || []
		for (const generatorConfig of generators) try {
			const data = generatorConfig.func(parttype, partname, partdetails, generatorConfig)
			if (data) event.dataTransfer.setData(generatorConfig.type, data)
		} catch (error) {
			console.error(`Error executing preloaded drag-out generator from path ${generatorConfig.path} for type ${generatorConfig.type}:`, error)
		}
	}, { signal })

	onElementRemoved(itemElement, () => {
		controller.abort()
		// 销毁Vanilla Tilt实例
		if (itemElement.vanillaTilt)
			itemElement.vanillaTilt.destroy()
	})
}

/**
 * 更新所有项目卡片上“默认”状态的显示。
 */
export function updateDefaultPartDisplay() {
	if (!homeRegistry?.part_types) return
	homeRegistry.part_types.forEach(pt => {
		const partType = pt.name
		const defaultPartNames = defaultParts[partType] || []
		const container = partTypesContainers.querySelector(`#${partType}-container`)
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
 * @param {object} partTypeObject - 要显示其内容的部件类型对象。
 * @returns {Promise<void>}
 */
export async function updateTabContent(partTypeObject) {
	const oldIndex = homeRegistry.part_types.findIndex(p => p.name === currentPartType?.name)
	const newIndex = homeRegistry.part_types.findIndex(p => p.name === partTypeObject.name)
	const isSameTab = oldIndex === newIndex
	const isFirstLoad = oldIndex === -1

	const direction = newIndex > oldIndex ? 'forward' : 'backward'

	setCurrentPartType(partTypeObject)
	const partTypeName = partTypeObject.name
	sessionStorage.setItem('fount.home.lastTab', partTypeName)

	pageTitle.dataset.i18n = `home.${partTypeName}.title;home.default.title`
	instruction.dataset.i18n = `home.${partTypeName}.subtitle;home.default.subtitle`

	/**
	 * 更新当前选定选项卡的内容。
	 * @returns {Promise<void>}
	 */
	const updateAndRender = async () => {
		// 隐藏所有容器，然后显示当前的容器
		if (partTypesContainers.childNodes.length) {
			partTypesContainers.childNodes.forEach(container => container.classList.add('hidden'))
			const currentContainer = partTypesContainers.querySelector(`#${partTypeName}-container`)
			if (currentContainer) currentContainer.classList.remove('hidden')
		}

		const allpartNames = await getAllpartNames(partTypeName)

		makeSearchable({
			searchInput: filterInput,
			data: allpartNames,
			/**
			 * 用于搜索的数据访问器。
			 * @param {string} name - 项目名称。
			 * @returns {any} 与项目关联的数据。
			 */
			dataAccessor: (name) => partDetailsCache[partTypeName]?.[name] || name, // Use new cache access
			/**
			 * 过滤后处理的回调函数。
			 * @param {string[]} filteredNames - 过滤后的项目名称数组。
			 * @returns {void}
			 */
			onUpdate: (filteredNames) => renderFilteredItems(partTypeObject, filteredNames),
		})

		itemDescription.innerHTML = geti18n('home.itemDescription') // 重置侧边栏

		// 设置活动选项卡的UI
		;[partTypesTabsContainerDesktop, partTypesTabsContainerMobile].forEach(container => {
			if (container?.childNodes.length) {
				container.querySelectorAll('div').forEach(tab => tab.classList.remove('active'))
				const currentTab = container.querySelector(`[data-target="${partTypeName}-container"]`)
				if (currentTab) currentTab.classList.add('active')
			}
		})
	}

	if (document.startViewTransition && !isSameTab && !isFirstLoad) {
		document.documentElement.dataset.transitionDirection = direction
		const transition = document.startViewTransition(updateAndRender)
		transition.finished.finally(() => delete document.documentElement.dataset.transitionDirection)
	}
	else await updateAndRender()
}

/**
 * 为每种部件类型设置选项卡和内容容器。
 * @param {object[]} partTypes - 来自注册表的部件类型对象数组。
 * @returns {void}
 */
export function setupPartTypeUI(partTypes) {
	partTypesTabsContainerDesktop.innerHTML = ''
	partTypesTabsContainerMobile.innerHTML = ''
	partTypesContainers.innerHTML = ''

	partTypes.forEach(pt => {
		const partType = pt.name

		/**
		 * 为菜单创建一个选项卡元素。
		 * @returns {HTMLLIElement} 创建的选项卡元素。
		 */
		const createTab = () => {
			const li = document.createElement('li')
			const a = document.createElement('div')
			a.dataset.target = `${partType}-container`
			a.dataset.i18n = `home.part_types.${partType};'${partType}'`
			a.addEventListener('click', e => {
				e.preventDefault()
				if (a.classList.contains('active')) return // Prevent clicking the active tab
				updateTabContent(pt)
			})
			li.appendChild(a)
			return li
		}

		[partTypesTabsContainerDesktop, partTypesTabsContainerMobile].forEach(container => container.appendChild(createTab()))

		const container = document.createElement('div')
		container.id = `${partType}-container`
		container.className = 'grid gap-4 hidden part-items-grid'
		partTypesContainers.appendChild(container)
	})
}

/**
 * 异步显示功能按钮菜单。
 * @returns {Promise<void>}
 */
export async function displayFunctionButtons() {
	functionButtonsContainer.innerHTML = '' // 清空现有按钮
	if (!homeRegistry?.home_function_buttons) return // 如果注册表未加载，则避免错误

	/**
	 * 创建一个菜单项（可以是按钮或子菜单）。
	 * @param {any} buttonItem - 按钮项目数据。
	 * @returns {HTMLElement} 菜单项的 `<li>` 元素。
	 */
	const createMenuItem = (buttonItem) => {
		const li = document.createElement('li')
		const translatedInfo = geti18n(buttonItem.info)

		// 如果按钮有子项目，则为子菜单
		if (buttonItem.sub_items?.length) {
			const details = document.createElement('details')
			const summary = document.createElement('summary')

			const iconSpan = document.createElement('span')
			iconSpan.classList.add('mr-2')
			iconSpan.innerHTML = buttonItem.button ?? /* html */ '<img src="https://api.iconify.design/line-md/folder-filled.svg" class="text-icon" />'
			svgInliner(iconSpan)

			const titleSpan = document.createElement('span')
			titleSpan.textContent = translatedInfo.title

			summary.append(iconSpan, titleSpan)
			details.appendChild(summary)

			const ul = document.createElement('ul')
			ul.classList.add('rounded-t-none')

			// 渲染前按级别对子项进行排序
			const sortedChildren = buttonItem.sub_items.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))

			sortedChildren.forEach(child => {
				try { ul.appendChild(createMenuItem(child)) } catch (error) {
					console.error('Error creating menu item:', error)
				}
			})
			details.appendChild(ul)
			li.appendChild(details)
		}
		else {
			// 这是一个常规按钮
			const button = document.createElement('a')
			const classes = ['btn', 'btn-ghost', 'btn-sm', 'flex', 'items-center', 'justify-start', ...buttonItem.classes ? buttonItem.classes.split(' ') : []]
			button.classList.add(...classes)
			if (buttonItem.style) button.style.cssText = buttonItem.style

			const iconSpan = document.createElement('span')
			iconSpan.classList.add('mr-2')
			iconSpan.innerHTML = buttonItem.button ?? /* html */ '<img src="https://api.iconify.design/line-md/question-circle.svg" class="text-icon" />'
			svgInliner(iconSpan)

			const titleSpan = document.createElement('span')
			titleSpan.textContent = translatedInfo.title

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
			try { menuItemsContainer.appendChild(createMenuItem(buttonItem)) } catch (error) {
				console.error('Error creating menu item:', error)
			}
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
		const filteredButtons = leafButtons.filter(button => filterFn(geti18n(button.info)))
		renderMenu(filteredButtons)
	}

	searchInput.addEventListener('input', filterAndRender)

	renderMenu(originalItems) // 初始渲染
}

/**
 * 刷新当前选项卡，重新加载所有数据和UI组件。
 * @returns {Promise<void>}
 */
export async function refreshCurrentTab() {
	clearCache() // Use the new clearCache function
	await Promise.all([
		getHomeRegistry().then(async data => {
			setHomeRegistry(data)
			await preloadDragGenerators(data)
			await displayFunctionButtons()
		}).catch(error => console.error('Failed to fetch home registry:', error)),
		getDefaultParts().then(data => {
			setDefaultParts(data)
		}).catch(error => console.error('Failed to fetch default parts:', error)),
	])
	await updateTabContent(currentPartType)
	updateDefaultPartDisplay()
}
