import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { geti18n, console } from '../../../scripts/i18n.mjs'
import { renderMarkdown } from '../../../scripts/markdown.mjs'
import { onElementRemoved } from '../../../scripts/onElementRemoved.mjs'
import { unlockAchievement, setDefaultPart, unsetDefaultPart, getAllDefaultParts } from '../../../scripts/parts.mjs'
import { getFiltersFromString, compileFilter, makeSearchable } from '../../../scripts/search.mjs'
import { svgInliner } from '../../../scripts/svgInliner.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'

import { defaultIcons, genericDefaultIcon } from './constants.mjs'
import { partDetailsCache, getpartDetails, clearCache, getAllpartNames } from './data.mjs'
import { getHomeRegistry } from './endpoints.mjs'
import { setHomeRegistry, setDefaultParts, setCurrentPartType, setCurrentPartPath, homeRegistry, defaultParts, currentPartType, preloadDragGenerators, currentPartPath, partBranches } from './state.mjs'
import { createActionButtons, showItemModal } from './ui/itemModal.mjs'

// ==========================================
// DOM Elements
// ==========================================

/** 功能菜单按钮元素 */
export const functionMenuButton = document.getElementById('function-menu-button')
/** 项目描述元素 */
export const itemDescription = document.getElementById('item-description')
/** 功能按钮容器元素 */
export const functionButtonsContainer = document.getElementById('function-buttons-container')
/** 过滤输入框元素 */
export const filterInput = document.getElementById('filter-input')
/** SFW（安全工作）模式切换开关元素 */
export const sfwToggle = document.getElementById('sfw-toggle')
/** 页面标题元素 */
export const pageTitle = document.getElementById('page-title')
/** 指示文本元素 */
export const instruction = document.getElementById('subtitle')
/** 部件类型选项卡容器元素 */
export const partTypesTabsContainer = document.getElementById('part-types-tabs')
/** 部件类型内容容器元素 */
export const partTypesContainers = document.getElementById('part-types-containers')

// 初始化模板
usingTemplates('/parts/shells:home/src/templates')

// ==========================================
// Utilities
// ==========================================


/**
 * 标准化路径（去除首尾斜杠）
 * @param {string} partpath - 部件路径
 * @returns {string} 标准化后的路径
 */
function normalizePath(partpath) {
	return partpath ? partpath.replace(/^\/+|\/+$/g, '') : ''
}

/**
 * 将路径写入 URL
 * @param {string} path - 路径
 * @returns {void}
 */
function updateUrlWithPath(path) {
	const url = new URL(window.location.href)
	if (path) url.searchParams.set('partpath', path)
	else url.searchParams.delete('partpath')
	window.history.replaceState({}, '', url)
}

/**
 * 构建子路径
 * @param {string} basePath - 基础路径
 * @param {string} child - 子路径名称
 * @returns {string} 组合后的路径
 */
function buildChildPath(basePath, child) {
	return normalizePath([basePath, child].filter(Boolean).join('/'))
}

// ==========================================
// Rendering Logic
// ==========================================

/**
 * 渲染单个项目视图的DOM元素。
 * @param {object} part - 包含部件类型、部件名称和部件详细信息的部件对象。
 * @returns {Promise<HTMLElement>} 渲染后的元素
 */
export async function renderItemView(part) {
	const { partpath, partdetails } = part
	const normalizedPath = normalizePath(partpath)
	// 获取父级作为 parttype
	const parttype = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))

	const itemElement = await renderTemplate('item_list_view', {
		...partdetails,
		parttype,
		defaultIcon: defaultIcons[parttype] || genericDefaultIcon
	})

	itemElement.dataset.name = partpath
	itemElement.dataset.partpath = partpath
	await attachCardEventListeners(itemElement, part)
	return itemElement
}

/**
 * 渲染一个过滤后的项目列表。
 * @param {object} partTypeObject - 部件类型对象
 * @param {string[]} filteredPaths - 过滤后的路径列表
 * @returns {Promise<void>}
 */
export async function renderFilteredItems(partTypeObject, filteredPaths) {
	const partTypeName = partTypeObject.name
	const currentContainer = partTypesContainers.querySelector(`#${partTypeName}-container`)
	if (!currentContainer) return

	if (!filteredPaths.length) {
		currentContainer.innerHTML = ''
		return currentContainer.appendChild(await renderTemplate('empty_list_view'))
	}

	const skeletonMap = new Map()

	// 并行创建元素
	const elementPromises = filteredPaths.map(partPath => {
		const partDetails = partDetailsCache[partPath]
		if (partDetails)
			return renderItemView({ partpath: partPath, partdetails: partDetails, interfaces: getInterfacesForPath(partPath) })
		else
			return renderTemplate('item_list_view_skeleton').then(skeleton => {
				skeletonMap.set(partPath, skeleton)
				return skeleton
			})
	})

	const elements = await Promise.all(elementPromises)

	currentContainer.innerHTML = ''
	const fragment = document.createDocumentFragment()
	elements.forEach(el => fragment.appendChild(el))
	currentContainer.appendChild(fragment)

	// 异步替换骨架屏
	skeletonMap.forEach(async (skeleton, partPath) => {
		try {
			const partDetails = await getpartDetails(partPath, true)
			const part = { partpath: partPath, partdetails: partDetails, interfaces: getInterfacesForPath(partPath) }
			const itemElement = await renderItemView(part)
			skeleton.parentNode?.replaceChild?.(itemElement, skeleton)
		} catch (error) {
			console.error(`Failed to fetch details for ${partPath}:`, error)
			skeleton.remove()
		}
	})
}

/**
 * 在侧边栏中显示项目的描述信息。
 * @param {object} part - 部件对象
 * @returns {Promise<void>}
 */
export async function displayItemInfo(part) {
	itemDescription.innerHTML = ''
	if (part.partdetails.info.description_markdown) {
		const fragment = await renderMarkdown(part.partdetails.info.description_markdown)
		itemDescription.appendChild(fragment)
	}
	else
		itemDescription.innerHTML = geti18n('home.noDescription')
}

// ==========================================
// Interaction & Event Listeners
// ==========================================

/**
 * 处理鼠标滚轮横向滚动
 * @param {WheelEvent} event - 滚轮事件
 */
function handleMouseWheelScroll(event) {
	const scrollContainer = event.currentTarget
	scrollContainer.scrollLeft += Math.sign(event.deltaY) * 40
	event.preventDefault()
}

/**
 * 配置卡片的拖拽功能
 * @param {HTMLElement} itemElement - 项目元素
 * @param {object} part - 部件数据对象
 * @param {AbortSignal} signal - 中止信号
 */
function setupDragAndDrop(itemElement, part, signal) {
	const { partpath, partdetails } = part
	const normalizedPath = normalizePath(partpath)
	const partname = normalizedPath.split('/').pop()

	// 仅当不在交互元素上按下时允许拖拽
	itemElement.addEventListener('mousedown', e => {
		if (e.target.closest('a, button, input, .text-content, .details-container'))
			itemElement.draggable = false
		else
			itemElement.draggable = true
	}, { signal })

	/**
	 *
	 */
	const cleanupDraggable = () => { itemElement.draggable = false }
	itemElement.addEventListener('mouseup', cleanupDraggable, { signal })
	itemElement.addEventListener('mouseleave', cleanupDraggable, { signal })
	itemElement.addEventListener('dragend', cleanupDraggable, { signal })

	itemElement.addEventListener('dragstart', event => {
		event.dataTransfer.effectAllowed = 'copy'

		// 文本数据
		const textDetails = [`${partname}`]
		if (partdetails.info?.version) textDetails.push(`Version: ${partdetails.info.version}`)
		if (partdetails.info?.author) textDetails.push(`Author: ${partdetails.info.author}`)
		if (partdetails.info?.home_page) textDetails.push(`Homepage: ${partdetails.info.home_page}`)
		event.dataTransfer.setData('text/plain', textDetails.join('\n'))

		// URL 数据
		const partUrl = `fount://page/parts/shells:home?partpath=${encodeURIComponent(normalizedPath)}`
		const fountUrl = `https://steve02081504.github.io/fount/protocol?url=${encodeURIComponent(partUrl)}`
		event.dataTransfer.setData('text/uri-list', fountUrl)
		event.dataTransfer.setData('URL', fountUrl)

		// 扩展生成器数据
		const generators = homeRegistry.home_drag_out_generators || []
		for (const generatorConfig of generators) try {
			const data = generatorConfig.func(normalizedPath, partdetails, generatorConfig)
			if (data) event.dataTransfer.setData(generatorConfig.type, data)
		} catch (error) {
			console.error(`Generator error (${generatorConfig.path}):`, error)
		}
	}, { signal })
}

/**
 * 配置默认部件复选框逻辑
 * @param {HTMLElement} itemElement - 项目元素
 * @param {string} parttype - 部件类型
 * @param {string} partname - 部件名称
 * @param {AbortSignal} signal - 中止信号
 */
function setupDefaultCheckbox(itemElement, parttype, partname, signal) {
	const defaultCheckbox = itemElement.querySelector('.default-checkbox')
	if (!defaultCheckbox) return

	const isDefault = (defaultParts[parttype] || []).includes(partname)
	defaultCheckbox.checked = isDefault
	if (isDefault) itemElement.classList.add('selected-item')

	defaultCheckbox.addEventListener('change', async event => {
		const isChecked = event.target.checked
		const response = await (isChecked ? setDefaultPart : unsetDefaultPart)(parttype, partname)

		if (response.ok) {
			if (parttype === 'personas' && isChecked) unlockAchievement('shells', 'home', 'set_default_persona')
		} else {
			console.error('Failed to update default part:', await response.text())
			event.target.checked = !isChecked
		}
	}, { signal })
}

/**
 * 为项目卡片元素附加所有必要的事件监听器。
 * @param {HTMLElement} itemElement - 项目元素
 * @param {object} part - 部件数据对象
 * @returns {Promise<void>}
 */
export async function attachCardEventListeners(itemElement, part) {
	const { partpath } = part
	const normalizedPath = normalizePath(partpath)
	const splitPath = normalizedPath.split('/')
	const parttype = splitPath[0]
	const partname = splitPath.slice(1).join('/')

	const actionsContainer = itemElement.querySelector('.actions-buttons-container')
	actionsContainer.innerHTML = ''

	const controller = new AbortController()
	const { signal } = controller

	// 1. 操作按钮与滚动
	actionsContainer.addEventListener('wheel', handleMouseWheelScroll, { passive: false, signal })
	const buttons = createActionButtons(part, part.interfaces || [])
	buttons.forEach(button => actionsContainer.appendChild(button))

	// 2. 标签点击
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

	// 3. 全局点击与交互
	itemElement.addEventListener('click', event => {
		if (event.target.closest('.details-container')) {
			document.getElementById('drawer-toggle').checked = true
			displayItemInfo(part)
			return
		}
		// 如果不是点击交互元素，则显示模态框
		if (!event.target.closest('a, button, .refresh-button, .default-checkbox, .details-container')) {
			event.preventDefault()
			event.stopPropagation()
			showItemModal(part)
		}
	}, { signal })

	itemElement.addEventListener('mouseover', () => {
		if (window.innerWidth >= 1024) displayItemInfo(part)
	}, { signal })

	// 4. 进入按钮与刷新
	itemElement.querySelector('.enter-button')?.addEventListener('click', e => {
		e.stopPropagation()
		goToPath(partpath)
	}, { signal })

	itemElement.querySelector('.refresh-button').addEventListener('click', async (e) => {
		e.stopPropagation()
		const updatedDetails = await getpartDetails(partpath, false)
		const updatedPart = { ...part, partdetails: updatedDetails, interfaces: getInterfacesForPath(partpath) }
		itemElement.replaceWith(await renderItemView(updatedPart))
	}, { signal })

	// 5. 默认选中逻辑
	setupDefaultCheckbox(itemElement, parttype, partname, signal)

	// 6. 视觉效果 (Vanilla Tilt)
	window.VanillaTilt?.init?.(itemElement, {
		max: 15, speed: 400, glare: true, 'max-glare': 0.2,
	})

	// 7. 拖拽功能
	setupDragAndDrop(itemElement, part, signal)

	// 清理
	onElementRemoved(itemElement, () => {
		controller.abort()
		itemElement.vanillaTilt?.destroy?.()
	})
}

/**
 * 更新所有项目卡片上“默认”状态的显示。
 */
export function updateDefaultPartDisplay() {
	homeRegistry?.part_types?.forEach?.(pt => {
		const partType = pt.name
		const defaultNames = defaultParts[partType] || []
		const container = partTypesContainers.querySelector(`#${partType}-container`)

		// 重置
		container?.querySelectorAll?.('.selected-item')?.forEach?.(itemElement => {
			itemElement.classList.remove('selected-item')
			Object.assign(itemElement.querySelector('.default-checkbox') || {}, { checked: false })
		})

		// 设置新状态
		defaultNames.forEach(name => {
			const targetPath = `${partType}/${name}`
			const itemElement = container?.querySelector?.(`.card-container[data-partpath="${targetPath}"]`)
			itemElement?.classList?.add?.('selected-item')
			Object.assign(itemElement?.querySelector?.('.default-checkbox') || {}, { checked: true })
		})
	})
}

// ==========================================
// Navigation & State Management
// ==========================================

/**
 * 更新当前选定选项卡的内容。
 * @param {object} partTypeObject - 部件类型对象
 * @returns {Promise<void>}
 */
export async function updateTabContent(partTypeObject) {
	const oldIndex = homeRegistry.part_types.findIndex(p => p.name === currentPartType?.name)
	const newIndex = homeRegistry.part_types.findIndex(p => p.name === partTypeObject.name)
	const direction = newIndex > oldIndex ? 'forward' : 'backward'

	setCurrentPartType(partTypeObject)
	const partTypeName = partTypeObject.name

	// 确保路径前缀匹配
	if (!currentPartPath?.startsWith?.(partTypeName))
		setCurrentPartPath(partTypeName)

	sessionStorage.setItem('fount.home.lastTab', partTypeName)

	/**
	 * 更新并渲染视图
	 * @returns {Promise<void>}
	 */
	async function updateAndRender() {
		pageTitle.dataset.i18n = `home.part_pages.${partTypeName}.title;home.part_pages.default.title`
		instruction.dataset.i18n = `home.part_pages.${partTypeName}.subtitle;home.part_pages.default.subtitle`

		// 切换容器可见性
		Array.from(partTypesContainers.children).forEach(container => {
			if (container.id === `${partTypeName}-container`) container.classList.remove('hidden')
			else container.classList.add('hidden')
		})

		const rootPath = currentPartPath || partTypeName
		const allNames = await getAllpartNames(rootPath)

		makeSearchable({
			searchInput: filterInput,
			data: allNames,
			/**
			 * 获取数据访问器
			 * @param {string} path - 路径
			 * @returns {object|string} 缓存的数据或路径
			 */
			dataAccessor: (path) => partDetailsCache[path] || path,
			/**
			 * 更新回调
			 * @param {string[]} filteredNames - 过滤后的名称列表
			 * @returns {Promise<void>}
			 */
			onUpdate: (filteredNames) => renderFilteredItems(partTypeObject, filteredNames),
		})

		itemDescription.innerHTML = geti18n('home.itemDescription')
	}

	if (document.startViewTransition && oldIndex !== -1) {
		document.documentElement.dataset.transitionDirection = direction
		await document.startViewTransition(updateAndRender).finished
		delete document.documentElement.dataset.transitionDirection
	} else await updateAndRender()
}

/**
 * 跳转到指定部件路径。
 * @param {string} path - 目标路径
 * @returns {void}
 */
function goToPath(path) {
	if (!path) return
	const rootType = path.split('/')[0]
	const targetType = homeRegistry?.part_types?.find(pt => pt.name === rootType)

	if (!targetType) return
	// 避免重复渲染
	if (currentPartPath === path && currentPartType?.name === rootType) return

	setCurrentPartType(targetType)
	setCurrentPartPath(path)
	updateUrlWithPath(path)
	updateTabContent(targetType)
}

// ==========================================
// Data & Tree Logic
// ==========================================

/**
 * 在分支树中获取节点
 * @param {object} branches - 分支树对象
 * @param {string} partpath - 部件路径
 * @returns {object|null} 节点对象或 null
 */
function getNodeByPath(branches, partpath) {
	const normalized = normalizePath(partpath)
	if (!normalized) return branches
	let node = branches
	for (const segment of normalized.split('/')) {
		if (!(node instanceof Object)) return null
		node = node[segment]
	}
	return node
}

/**
 * 获取指定路径的直接子节点
 * @param {object} branches - 分支树对象
 * @param {string} partpath - 部件路径
 * @param {Function} [filterPath] - 过滤函数
 * @returns {string[]} 子节点名称列表
 */
function getChildrenOfPath(branches, partpath, filterPath) {
	const node = getNodeByPath(branches, partpath)
	if (!(node instanceof Object)) return []
	const children = Object.keys(node).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))

	return filterPath
		? children.filter(child => filterPath(buildChildPath(partpath, child)))
		: children
}

/**
 * 检查路径在树中是否有子节点
 * @param {string} path - 路径
 * @param {object} branches - 分支树对象
 * @returns {boolean} 是否有子节点
 */
function hasChildrenInBranches(path, branches) {
	if (!branches) return false
	const node = getNodeByPath(branches, path)
	return node instanceof Object && Object.keys(node).length > 0
}

/**
 * 判断是否需要显示为文件夹样式
 * 逻辑：只要有子节点结构，或者任何子节点支持 parts 接口，就应视为文件夹
 * @param {string} path - 路径
 * @param {object} branches - 分支树对象
 * @returns {Promise<boolean>} 是否应显示为文件夹
 */
async function shouldBeFolderStyle(path, branches) {
	if (!branches) return false
	const children = getChildrenOfPath(branches, path)
	if (children.length === 0) return false

	// 1. 结构检查：任何子项在树中是分支
	for (const child of children)
		if (hasChildrenInBranches(buildChildPath(path, child), branches)) return true


	// 2. 缓存检查：任何子项已缓存且有 parts 接口
	for (const child of children)
		if (partDetailsCache[buildChildPath(path, child)]?.supportedInterfaces?.includes('parts')) return true

	// 3. 深度检查：加载未缓存的子项详情
	const uncachedPaths = children
		.map(c => buildChildPath(path, c))
		.filter(path => !partDetailsCache[path])

	return await Promise.any(uncachedPaths.map(async (p) => {
		const details = await getpartDetails(p, true)
		if (details?.supportedInterfaces?.includes?.('parts')) return true
		throw new Error('not matched')
	})).catch(() => false)
}

/**
 * 递归创建菜单项
 * @param {string} name - 名称
 * @param {string} path - 路径
 * @param {object} branches - 分支树对象
 * @param {Function} [filterFn] - 过滤函数
 * @returns {Promise<HTMLLIElement>} 列表项元素
 */
async function createMenuItem(name, path, branches, filterFn) {
	// 获取显示名称（优先缓存）
	let displayName = name
	if (partDetailsCache[path]?.info?.name)
		displayName = partDetailsCache[path].info.name
	else
		try {
			// 尝试异步获取但不阻塞 UI 太久，若失败则保持原名
			const details = await getpartDetails(path, true).catch(() => null)
			if (details?.info?.name) displayName = details.info.name
		} catch (e) {
			console.error(`Fetch name failed for ${path}`, e)
		}


	const isFolder = await shouldBeFolderStyle(path, branches)
	const li = document.createElement('li')

	if (isFolder) {
		// 文件夹样式构造
		const iconSpan = document.createElement('span')
		iconSpan.classList.add('mr-2')
		iconSpan.innerHTML = '<img src="https://api.iconify.design/line-md/folder-filled.svg" class="text-icon" />'

		const nameSpan = document.createElement('span')
		nameSpan.textContent = displayName
		nameSpan.dataset.i18n = `home.part_types.${name};'${displayName}'`

		const summaryContent = [iconSpan, nameSpan]
		iconSpan.firstChild && svgInliner(iconSpan)

		const summary = document.createElement('summary')
		summaryContent.forEach(child => summary.appendChild(child))

		const ul = document.createElement('ul')
		ul.classList.add('ml-4', 'mt-1')

		const details = document.createElement('details')
		details.appendChild(summary)
		details.appendChild(ul)

		let isLoaded = false

		// 监听展开事件
		details.addEventListener('toggle', async (e) => {
			if (details.open) {
				goToPath(path)

				if (!isLoaded) {
					isLoaded = true
					ul.innerHTML = ''

					// 1. 获取所有原始子节点（先不过滤）
					const rawChildren = getChildrenOfPath(branches, path)

					// 2. 找出所有还没加载详情的子节点路径
					const uncachedPaths = rawChildren
						.map(child => buildChildPath(path, child))
						.filter(childPath => !partDetailsCache[childPath])

					// 3. 如果有未缓存的，并行加载它们的数据
					await Promise.allSettled(uncachedPaths.map(p => getpartDetails(p, true)))

					// 4. 数据加载完了，现在过滤才是准确的
					const validChildren = rawChildren.filter(child =>
						!filterFn || filterFn(buildChildPath(path, child))
					)

					// 5. 渲染子节点
					for (const child of validChildren)
						ul.appendChild(await createMenuItem(child, buildChildPath(path, child), branches, filterFn))
				}
			}
		})
		li.appendChild(details)
	} else {
		// 普通项样式构造
		const div = document.createElement('div')
		div.classList.add('cursor-pointer')
		div.textContent = displayName
		div.dataset.target = `${path.split('/')[0]}-container`
		div.dataset.i18n = `home.part_types.${name};'${displayName}'`
		div.addEventListener('click', (e) => {
			e.preventDefault()
			e.stopPropagation()
			goToPath(path)
		})
		li.appendChild(div)
	}

	return li
}

/**
 * 初始化部件类型 UI
 * @param {object[]} partTypes - 部件类型列表
 * @param {string} [initialPath] - 初始路径
 * @returns {Promise<void>}
 */
export async function setupPartTypeUI(partTypes, initialPath) {
	partTypesTabsContainer.innerHTML = ''
	partTypesContainers.innerHTML = ''

	/**
	 * 路径过滤函数
	 * @param {string} path - 路径
	 * @returns {boolean} 是否保留
	 */
	const filterPath = (path) => {
		if (!path) return true
		const rootType = path.split('/')[0]
		// 根类型总是允许
		if (homeRegistry?.part_types?.some(pt => pt.name === rootType) && path === rootType) return true
		// 其他检查 parts 接口
		return hasPartsInterface(path)
	}

	for (const pt of partTypes) {
		const partType = pt.name
		// 创建根菜单项
		const menuItem = await createMenuItem(partType, partType, partBranches, filterPath)
		partTypesTabsContainer.appendChild(menuItem)

		// 创建内容容器
		const container = document.createElement('div')
		container.classList.add('grid', 'gap-4', 'hidden', 'part-items-grid')
		container.id = `${partType}-container`
		partTypesContainers.appendChild(container)
	}

	if (partTypes[0]) goToPath(initialPath || currentPartPath || partTypes[0].name)
}

// ==========================================
// Function Buttons & Interfaces
// ==========================================

/**
 * 判断是否存在 parts 接口
 * @param {string} path - 路径
 * @returns {boolean} 是否存在
 */
function hasPartsInterface(path) {
	return partDetailsCache[path]?.supportedInterfaces?.includes?.('parts')
}

/**
 * 获取当前路径可用的接口
 * @param {string} path - 路径
 * @returns {object[]} 接口列表
 */
function getInterfacesForPath(path) {
	const map = homeRegistry?.home_interfaces || {}
	const result = []
	for (const [key, list] of Object.entries(map))
		if (key === '*' || path === key || path.startsWith(key + '/') || key.startsWith(path + '/'))
			result.push(...list)

	return result
}

/**
 * 显示功能按钮菜单
 */
export async function displayFunctionButtons() {
	functionButtonsContainer.innerHTML = ''
	if (!homeRegistry?.home_function_buttons) return

	// 辅助：创建单个菜单项
	/**
	 * 创建按钮菜单项
	 * @param {object} item - 菜单项配置
	 * @returns {HTMLLIElement} 列表项元素
	 */
	function createButtonMenuItem(item) {
		const li = document.createElement('li')
		const info = geti18n(item.info)
		const iconHtml = item.button ?? '<img src="https://api.iconify.design/line-md/question-circle.svg" class="text-icon" />'

		if (item.sub_items?.length) {
			// 子菜单
			const iconSpan = document.createElement('span')
			iconSpan.classList.add('mr-2')
			iconSpan.innerHTML = item.button ?? '<img src="https://api.iconify.design/line-md/folder-filled.svg" class="text-icon" />'
			svgInliner(iconSpan)

			const titleSpan = document.createElement('span')
			titleSpan.textContent = info.title

			const summary = document.createElement('summary')
			summary.appendChild(iconSpan)
			summary.appendChild(titleSpan)

			const ul = document.createElement('ul')
			ul.classList.add('rounded-t-none')
			item.sub_items
				.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
				.forEach(child => ul.appendChild(createButtonMenuItem(child)))

			const details = document.createElement('details')
			details.appendChild(summary)
			details.appendChild(ul)
			li.appendChild(details)
		} else {
			// 普通按钮
			const iconSpan = document.createElement('span')
			iconSpan.classList.add('mr-2')
			iconSpan.innerHTML = iconHtml
			svgInliner(iconSpan)

			const titleSpan = document.createElement('span')
			titleSpan.textContent = info.title

			const classes = ['btn', 'btn-ghost', 'btn-sm', 'flex', 'items-center', 'justify-start', ...item.classes?.split(' ') || []]
			const btn = document.createElement('a')
			btn.classList.add(...classes)
			if (item.style) btn.style.cssText = item.style
			btn.appendChild(iconSpan)
			btn.appendChild(titleSpan)

			if (item.action) btn.addEventListener('click', () => async_eval(item.action, { geti18n }))
			else if (item.url) btn.href = item.url

			li.appendChild(btn)
		}
		return li
	}

	// 搜索框
	const searchInput = document.createElement('input')
	searchInput.classList.add('input', 'input-sm', 'w-full')
	searchInput.type = 'text'
	searchInput.dataset.i18n = 'home.functionMenu.search'
	searchInput.addEventListener('click', e => e.stopPropagation())

	const menuList = document.createElement('ul')
	menuList.classList.add('menu', 'p-0', 'w-full')
	functionButtonsContainer.append(searchInput, menuList)

	const allItems = homeRegistry.home_function_buttons
	const flatItems = []
	/**
	 * 扁平化数组
	 * @param {object[]} arr - 数组
	 * @returns {void}
	 */
	const flatten = (arr) => arr.forEach(i => { flatItems.push(i); if (i.sub_items) flatten(i.sub_items) })
	flatten(allItems)
	const leafItems = flatItems.filter(i => !i.sub_items?.length)

	/**
	 * 渲染菜单
	 * @param {object[]} items - 菜单项列表
	 * @returns {void}
	 */
	function renderMenu(items) {
		menuList.innerHTML = ''
		items.forEach(item => {
			try { menuList.appendChild(createButtonMenuItem(item)) }
			catch (e) { console.error('Error creating menu item:', e) }
		})
	}

	searchInput.addEventListener('input', () => {
		if (!searchInput.value) return renderMenu(allItems)
		const filterFn = compileFilter(searchInput.value)
		renderMenu(leafItems.filter(btn => filterFn(geti18n(btn.info))))
	})

	renderMenu(allItems)
}

/**
 * 刷新当前选项卡
 * @returns {Promise<void>}
 */
export async function refreshCurrentTab() {
	clearCache()
	try {
		const [regData, defData] = await Promise.all([
			getHomeRegistry(),
			getAllDefaultParts()
		])

		if (regData) {
			setHomeRegistry(regData)
			await preloadDragGenerators(regData)
			await displayFunctionButtons()
		}
		if (defData) setDefaultParts(defData)

		await updateTabContent(currentPartType)
		updateDefaultPartDisplay()
	} catch (error) {
		console.error('Refresh failed:', error)
	}
}
