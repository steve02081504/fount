import { renderTemplate } from '../../scripts/template.mjs'
import { getCharDetails, noCacheGetCharDetails, getCharList } from '../../scripts/parts.mjs'
import { renderMarkdown } from '../../scripts/markdown.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { parseRegexFromString, escapeRegExp } from '../../scripts/regex.mjs'

const roleContainer = document.getElementById('role-container')
const characterDescription = document.getElementById('character-description')
const drawerToggle = document.getElementById('my-drawer-2')
const functionButtonsContainer = document.getElementById('function-buttons-container')
const filterInput = document.getElementById('filter-input')

let charDetailsCache = {} // Cache for character details

// 获取已展开的注册项
async function getHomeRegistry() {
	const response = await fetch('/api/gethomeregistry')
	if (response.ok) return await response.json()
	else throw new Error('Failed to fetch home registry')
}

let homeRegistry
const currentLocale = navigator.language || navigator.userLanguage

// Function to handle mouse wheel scrolling
function handleMouseWheelScroll(event) {
	const scrollContainer = event.currentTarget
	const delta = Math.sign(event.deltaY) // Get the direction of scrolling

	// Adjust the scrollLeft property based on the scroll direction
	scrollContainer.scrollLeft += delta * 40 // Adjust the scroll amount as needed

	event.preventDefault() // Prevent the default page scrolling behavior
}

async function getCharDetailsCached(char) {
	return charDetailsCache[char] ??= await getCharDetails(char)
}
async function getCharDetailsRefreshed(char) {
	return charDetailsCache[char] = await noCacheGetCharDetails(char)
}

const CharDOMCache = {}
async function renderCharView(charDetails, charname) {
	// Check if data has changed before rendering
	if (JSON.stringify(CharDOMCache[charname]?.info) === JSON.stringify(charDetails))
		return CharDOMCache[charname].node


	const roleElement = await renderTemplate('char_list_view', charDetails)
	const actionsContainer = roleElement.querySelector('.card-actions > div') // Target the inner div
	actionsContainer.innerHTML = ''

	// Add mouse wheel event listener to the scrollable container
	actionsContainer.addEventListener('wheel', handleMouseWheelScroll)

	// 检查并添加按钮
	for (const interfaceItem of homeRegistry.home_char_interfaces)
		if (
			!interfaceItem.interface ||
			charDetails.supportedInterfaces.includes(interfaceItem.interface)
		) {
			const button = document.createElement('button')
			const classes = ['btn']
			classes.push(`btn-${interfaceItem.type ?? 'primary'}`)
			if (interfaceItem.classes) classes.push(...interfaceItem.classes.split(' '))
			button.classList.add(...classes)

			if (interfaceItem.style) button.style.cssText = interfaceItem.style

			const localizedInfo =
				interfaceItem.info[currentLocale] ||
				interfaceItem.info[Object.keys(interfaceItem.info)[0]]
			button.innerHTML =
				interfaceItem.button ??
				'<img src="https://api.iconify.design/line-md/question-circle.svg" />'
			button.title = localizedInfo.title
			button.addEventListener('click', () => {
				if (interfaceItem.onclick) eval(interfaceItem.onclick)
				else window.open(interfaceItem.url.replaceAll('${charname}', charname))
			})

			actionsContainer.appendChild(button)
		}

	// Add event listeners to tags
	const tagElements = roleElement.querySelectorAll('.badge')
	tagElements.forEach((tagElement) => {
		tagElement.addEventListener('click', (event) => {
			event.stopPropagation()
			const tag = tagElement.textContent.trim()
			const currentFilter = filterInput.value
			if (currentFilter.split(' ').includes(tag))
				// Remove tag from filter
				filterInput.value = currentFilter.split(' ').filter((t) => t && t !== tag).join(' ')
			else
				// Add tag to filter
				filterInput.value = currentFilter ? `${currentFilter} ${tag}` : tag

			filterCharList()
		})
	})

	// 移动端点击卡片非按钮区域时显示侧边栏
	roleElement.addEventListener('click', (event) => {
		if (window.innerWidth < 1024 && !event.target.closest('button')) {
			displayCharacterInfo(charDetails)
			drawerToggle.checked = true
		}
	})

	// 桌面端添加悬浮事件监听
	roleElement.addEventListener('mouseover', () => {
		if (window.innerWidth >= 1024) displayCharacterInfo(charDetails)
	})

	CharDOMCache[charname] = { info: charDetails, node: roleElement }

	const refreshButton = roleElement.querySelector('.refresh-button')
	refreshButton.addEventListener('click', async (event) => {
		roleElement.replaceWith(await renderCharView(await getCharDetailsRefreshed(charname), charname))
	})

	return roleElement
}

async function displayCharacterInfo(charDetails) {
	characterDescription.innerHTML =
		await renderMarkdown(charDetails.info.description_markdown) || '无描述信息'
}

async function setLocale(locale) {
	const response = await fetch('/api/setlocale', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ locale }),
	})

	const data = await response.json()

	if (response.ok) console.log(data.message)
	else throw new Error(data.message)
}

/**
 * Applies all filter conditions to a character.
 * @param {string} charName - The name of the character.
 * @param {RegExp[]} commonFilters - Array of common filters.
 * @param {RegExp[]} forceFilters - Array of forced filters.
 * @param {RegExp[]} excludeFilters - Array of excluded filters.
 * @returns {boolean} - True if the character matches all conditions, false otherwise.
 */
function applyFilters(charName, commonFilters, forceFilters, excludeFilters) {
	const charData = charDetailsCache[charName]
	const charString = JSON.stringify(charData) // Optimize: Consider targeting specific properties

	// Check for common filters (at least one must match)
	const hasCommonMatch = commonFilters.length === 0 || commonFilters.some(filter => filter.test(charString))

	// Check for forced filters (all must match)
	const hasForceMatch = forceFilters.every(filter => filter.test(charString))

	// Check for excluded filters (none must match)
	const hasExcludeMatch = excludeFilters.some(filter => filter.test(charString))

	return hasCommonMatch && hasForceMatch && !hasExcludeMatch
}

/**
 * Filters the character list based on user input.
 */
async function filterCharList() {
	const filters = filterInput.value.toLowerCase().split(' ').filter(f => f)
	if (filters.length === 0) return displayCharList()

	const commonFilters = []
	const forceFilters = []
	const excludeFilters = []

	function parseRegexFilter(filter) {
		if (filter.startsWith('+') || filter.startsWith('-')) filter = filter.slice(1)
		const parsed = parseRegexFromString(filter)
		return parsed ? parsed : new RegExp(escapeRegExp(filter))
	}

	// Categorize filters
	for (const filter of filters) {
		const regex = parseRegexFilter(filter)

		if (filter.startsWith('+'))
			forceFilters.push(regex)
		else if (filter.startsWith('-'))
			excludeFilters.push(regex)
		else
			commonFilters.push(regex)

	}

	// Apply filters and get filtered character names
	const filteredCharNames = Object.keys(charDetailsCache).filter(charName =>
		applyFilters(charName, commonFilters, forceFilters, excludeFilters)
	)

	await displayCharList(filteredCharNames)
}

async function displayCharList(charNames = Object.keys(charDetailsCache)) {
	// Clear the container
	roleContainer.innerHTML = ''

	// Render each character
	for (const charName of charNames) {
		const charDetails = charDetailsCache[charName]
		const roleElement = await renderCharView(charDetails, charName)
		roleContainer.appendChild(roleElement)
	}
}

filterInput.addEventListener('input', filterCharList)

// 添加功能按钮
async function displayFunctionButtons() {
	for (const buttonItem of homeRegistry.home_function_buttons) {
		const li = document.createElement('li')
		const button = document.createElement('a')
		const classes = ['flex', 'items-center', 'justify-start']
		if (buttonItem.classes) classes.push(...buttonItem.classes.split(' '))
		button.classList.add(...classes)

		if (buttonItem.style) button.style.cssText = buttonItem.style

		const localizedInfo =
			buttonItem.info[currentLocale] ||
			buttonItem.info[Object.keys(buttonItem.info)[0]]

		// 添加图标和标题
		const iconSpan = document.createElement('span')
		iconSpan.classList.add('mr-2') // 图标和文字之间添加一些间距
		iconSpan.innerHTML =
			buttonItem.button ??
			'<img src="https://api.iconify.design/line-md/question-circle.svg" class="dark:invert" />'

		const titleSpan = document.createElement('span')
		titleSpan.textContent = localizedInfo.title

		button.appendChild(iconSpan)
		button.appendChild(titleSpan)

		button.addEventListener('click', () => {
			if (buttonItem.onclick) eval(buttonItem.onclick)
			else window.open(buttonItem.url)
		})
		li.appendChild(button)
		functionButtonsContainer.appendChild(li)
	}
}

// 初始化
async function initializeApp() {
	applyTheme()
	try {
		await setLocale(navigator.language || navigator.userLanguage)
	} catch (error) {
		// jump to login page
		window.location = '/login'
	}
	homeRegistry = await getHomeRegistry()
	displayFunctionButtons()

	await refetchCharData()

	filterCharList()
}

// Function to refetch character data
async function refetchCharData() {
	charDetailsCache = {}
	// Refetch data for all characters
	const allCharNames = await getCharList()
	await Promise.all(allCharNames.map(charName => getCharDetailsCached(charName)))
}

// Add event listener for window focus
window.addEventListener('focus', async () => {
	await refetchCharData()
	await displayCharList()
})

initializeApp()
