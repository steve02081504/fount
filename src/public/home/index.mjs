import { renderTemplate } from '../scripts/template.mjs'
import { getCharDetails, getCharList } from '../scripts/parts.mjs'
import { renderMarkdown } from '../scripts/markdown.mjs'
import { applyTheme } from '../scripts/theme.mjs'

const roleContainer = document.getElementById('role-container')
const characterDescription = document.getElementById('character-description')
const drawerToggle = document.getElementById('my-drawer-2')
const functionButtonsContainer = document.getElementById('function-buttons-container')

// 获取已展开的注册项
async function getHomeRegistry() {
	const response = await fetch('/api/gethomeregistry')
	if (response.ok)
		return await response.json()
	else
		throw new Error('Failed to fetch home registry')
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

async function renderCharView(charDetails, charname) {
	const roleElement = await renderTemplate('char_list_view', charDetails)
	const actionsContainer = roleElement.querySelector('.card-actions > div') // Target the inner div
	actionsContainer.innerHTML = ''

	// Add mouse wheel event listener to the scrollable container
	actionsContainer.addEventListener('wheel', handleMouseWheelScroll)

	// 检查并添加按钮
	for (const interfaceItem of homeRegistry.home_char_interfaces)
		if (!interfaceItem.interface || charDetails.supportedInterfaces.includes(interfaceItem.interface)) {
			const button = document.createElement('button')
			const classes = ['btn']
			classes.push(`btn-${interfaceItem.type ?? 'primary'}`)
			if (interfaceItem.classes) classes.push(...interfaceItem.classes.split(' '))
			button.classList.add(...classes)

			if (interfaceItem.style) button.style.cssText = interfaceItem.style

			const localizedInfo = interfaceItem.info[currentLocale] || interfaceItem.info[Object.keys(interfaceItem.info)[0]]
			button.innerHTML = interfaceItem.button ?? '<img src="https://api.iconify.design/line-md/question-circle.svg" />'
			button.title = localizedInfo.title
			button.addEventListener('click', () => {
				if (interfaceItem.onclick)
					eval(interfaceItem.onclick)
				else
					window.open(interfaceItem.url.replaceAll('${charname}', charname))
			})

			actionsContainer.appendChild(button)
		}

	// 移动端点击卡片非按钮区域时显示侧边栏
	roleElement.addEventListener('click', (event) => {
		if (window.innerWidth < 1024 && !event.target.closest('button')) {
			displayCharacterInfo(charDetails)
			drawerToggle.checked = true
		}
	})

	// 桌面端添加悬浮事件监听
	roleElement.addEventListener('mouseover', () => {
		if (window.innerWidth >= 1024)
			displayCharacterInfo(charDetails)

	})

	return roleElement
}

async function displayCharacterInfo(charDetails) {
	characterDescription.innerHTML = await renderMarkdown(charDetails.info.description_markdown) || '无描述信息'
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

	if (response.ok)
		console.log(data.message)
	else
		throw new Error(data.message)
}

async function displayCharList() {
	const charList = await getCharList()
	roleContainer.innerHTML = ''

	for (const char of charList) {
		const charDetails = await getCharDetails(char)
		const roleElement = await renderCharView(charDetails, char)
		roleContainer.appendChild(roleElement)
	}
}

// 添加功能按钮
async function displayFunctionButtons() {
	for (const buttonItem of homeRegistry.home_function_buttons) {
		const li = document.createElement('li')
		const button = document.createElement('a')
		const classes = ['flex', 'items-center', 'justify-start']
		if (buttonItem.classes)
			classes.push(...buttonItem.classes.split(' '))
		button.classList.add(...classes)

		if (buttonItem.style) button.style.cssText = buttonItem.style

		const localizedInfo = buttonItem.info[currentLocale] || buttonItem.info[Object.keys(buttonItem.info)[0]]

		// 添加图标和标题
		const iconSpan = document.createElement('span')
		iconSpan.classList.add('mr-2') // 图标和文字之间添加一些间距
		iconSpan.innerHTML = buttonItem.button ?? '<img src="https://api.iconify.design/line-md/question-circle.svg" class="dark:invert" />'

		const titleSpan = document.createElement('span')
		titleSpan.textContent = localizedInfo.title

		button.appendChild(iconSpan)
		button.appendChild(titleSpan)

		button.addEventListener('click', () => {
			if (buttonItem.onclick)
				eval(buttonItem.onclick)
			else
				window.open(buttonItem.url)
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
	}
	catch (error) {
		// jump to login page
		window.location = '/login'
	}
	homeRegistry = await getHomeRegistry()
	displayFunctionButtons()
	displayCharList()
}

initializeApp()
