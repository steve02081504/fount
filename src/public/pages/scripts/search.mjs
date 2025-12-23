import { onElementRemoved } from './onElementRemoved.mjs'
import { parseRegexFromString, escapeRegExp } from './regex.mjs'

/**
 * Symbol 用于在输入元素上存储清理函数。
 * @type {symbol}
 */
const CLEANUP_SYMBOL = Symbol('makeSearchableCleanup')

/**
 * 将单个筛选词解析为 RegExp 的辅助函数。
 * 它会创建一个不区分大小写的正则表达式。
 * @param {string} filter - 筛选词。
 * @returns {RegExp} - 解析后的正则表达式。
 */
function parseRegexFilter(filter) {
	try { return parseRegexFromString(filter) }
	catch { return new RegExp(escapeRegExp(filter), 'i') }
}

/**
 * 将字符串拆分为筛选词数组。
 * 支持普通筛选、强制包含筛选（以“+”为前缀）和排除筛选（以“-”为前缀）。还支持带引号的词。
 * @param {string} str - 要拆分为筛选词的字符串。
 * @returns {string[]} - 筛选词数组。
 */
export function getFiltersFromString(str) {
	return str.match(/[+-]?(?:"(?:[^"\\]|\\.)*"|\S+)(\s|$)/g) || []
}

/**
 * 解析筛选字符串并返回一个筛选函数。
 * 返回的函数接受一个对象，如果该对象与筛选条件匹配，则返回 true。
 * 支持普通筛选、强制包含筛选（以“+”为前缀）和排除筛选（以“-”为前缀）。还支持带引号的词。
 * 例如，'common term' +forced -"excluded term"
 * @param {string} filterString - 用户输入的原始筛选字符串。
 * @returns {(item: object) => boolean} - 一个筛选对象的函数。
 */
export function compileFilter(filterString) {
	const [commonFilters, forceFilters, excludeFilters] = [[], [], []]
	const FiltersMap = {
		'': commonFilters,
		'+': forceFilters,
		'-': excludeFilters
	}

	getFiltersFromString(filterString).forEach(filterStr => {
		const { prefix, quotedTerm, unquotedTerm } = /^(?<prefix>[+-]?)("(?<quotedTerm>.+)"|(?<unquotedTerm>\S+))\s*$/.exec(filterStr)?.groups || {}
		const term = quotedTerm || unquotedTerm
		FiltersMap[prefix].push(parseRegexFilter(term))
	})

	/**
	 * @param {object} item The data object to check.
	 * @returns {boolean} True if the item matches the filter criteria.
	 */
	return (item) => {
		const itemString = JSON.stringify(item)
		if (excludeFilters.some(filter => filter.test(itemString))) return false
		if (!forceFilters.every(filter => filter.test(itemString))) return false
		return !commonFilters.length || commonFilters.some(filter => filter.test(itemString))
	}
}

/**
 * 将搜索输入框绑定到项目列表以进行自动实时筛选。
 *
 * 此函数会为搜索输入框附加一个事件侦听器。当用户键入时，它会根据搜索查询筛选提供的项目列表。
 * 如果同一个输入元素之前已经调用过此函数，会自动清理旧的监听器。
 *
 * @param {object} options - 搜索功能的配置。
 * @param {HTMLInputElement} options.searchInput - 用于搜索查询的 `<input>` 元素。
 * @param {Array<HTMLElement|object>} options.data - 要筛选的项目数组。这些可以是 HTML 元素或数据对象。
 * @param {function(HTMLElement|object): (object|string)} [options.dataAccessor=(item) => item] - 一个函数，它接受一个项目并返回用于搜索的数据（对象或字符串）。
 * @param {function(Array<HTMLElement|object>): void} options.onUpdate - 当筛选后的列表更新时调用的回调函数。
 * @returns {HTMLInputElement} - 搜索输入框。
 */
export function makeSearchable({ searchInput, data, dataAccessor = (item) => item, onUpdate }) {
	searchInput[CLEANUP_SYMBOL]?.()
	delete searchInput[CLEANUP_SYMBOL]

	/**
	 * 根据搜索查询筛选提供的项目列表。
	 */
	const filterItems = () => {
		const filterFn = compileFilter(searchInput.value)
		const filteredData = data.filter(item => filterFn(dataAccessor(item)))
		onUpdate(filteredData)
	}

	/**
	 * 处理点击事件，阻止事件冒泡。
	 * @param {Event} e - 点击事件对象。
	 * @returns {void}
	 */
	const clickHandler = (e) => e.stopPropagation()

	searchInput.addEventListener('input', filterItems)
	searchInput.addEventListener('click', clickHandler)
	filterItems() // Initial call

	/**
	 * 清理函数，用于移除事件监听器。
	 * @returns {void}
	 */
	searchInput[CLEANUP_SYMBOL] = onElementRemoved(searchInput, () => {
		searchInput.removeEventListener('input', filterItems)
		searchInput.removeEventListener('click', clickHandler)
	})

	return searchInput
}

/**
 * 创建和管理一个可搜索的下拉菜单，使用现有的输入元素作为触发器。
 * 它会动态生成下拉菜单内容，绑定搜索功能，并处理项目选择。
 *
 * @param {object} options - 可搜索下拉菜单的配置。
 * @param {HTMLElement} options.dropdownElement - 将充当下拉菜单的容器元素。将自动创建或在其内部查找一个输入元素作为触发器。
 * @param {Array<object>} options.dataList - 用于填充下拉菜单的数据对象数组。
 * @param {string} options.textKey - 每个数据对象中用作下拉菜单中文本显示的键。
 * @param {string} options.valueKey - 每个数据对象中用作选择值的键。
 * @param {function(object): void} [options.onSelect=()=>{}] - 选择项目时的回调函数。接收所选的数据对象。
 * @param {function(object): (object|string)} [options.dataAccessor] - 一个函数，它接受一个数据对象并返回用于搜索的数据（对象或字符串）。默认为使用 `textKey`。
 * @param {boolean} [options.disabled=false] - 是否禁用下拉菜单。
 * @returns {Promise<HTMLElement>} - 下拉菜单元素。
 */
export async function createSearchableDropdown({
	dropdownElement,
	dataList,
	textKey,
	valueKey,
	onSelect = () => { },
	dataAccessor = item => item,
	disabled = false,
}) {
	const is_builted_dropdown = dropdownElement.querySelector('.dropdown-content')
	const triggerPlaceholder = is_builted_dropdown ? dropdownElement.querySelector('input').placeholder : dropdownElement.placeholder || 'Select an option...'
	const oldSearchInput = is_builted_dropdown ? dropdownElement.querySelector('.dropdown-content').querySelector('input') : dropdownElement.querySelector('input') || { dataset: {} }
	const searchPlaceholder = oldSearchInput.placeholder || 'Search...'

	// Ensure the dropdownElement has the 'dropdown' class
	dropdownElement.classList.add('dropdown', 'searchable-dropdown')
	dropdownElement.setAttribute('role', 'combobox')
	dropdownElement.setAttribute('aria-haspopup', 'listbox')
	dropdownElement.setAttribute('aria-expanded', 'false')

	if (disabled)
		dropdownElement.innerHTML = /* html */ `<input type="text" placeholder="${triggerPlaceholder}" class="input input-bordered w-full" tabindex="0" role="button" readonly disabled />`
	else {
		const uniqueId = `dropdown-list-${Math.random().toString(36).substring(2, 9)}`

		// Create the dropdown content HTML structure
		dropdownElement.innerHTML = /* html */ `\
<input type="text" placeholder="${triggerPlaceholder}" class="input input-bordered w-full cursor-pointer" tabindex="0" role="button" readonly aria-controls="${uniqueId}" />
<div tabindex="0" id="${uniqueId}" class="dropdown-content z-50 p-4 shadow bg-base-100 rounded-box w-full flex flex-col gap-4 mt-2" role="listbox">
	<input type="text" placeholder="${searchPlaceholder}" class="input input-bordered w-full" />
	<ul class="flex flex-col w-full p-0 max-h-48 overflow-y-auto bg-base-100 rounded-box">
		<!-- Options will be inserted here -->
	</ul>
</div>
`
	}
	const dropdownContent = dropdownElement.querySelector('.dropdown-content')
	const searchInput = (disabled ? dropdownElement : dropdownContent).querySelector('input')

	// Placeholders are now set in the template string, but we can still respect oldInput for search
	searchInput.placeholder = oldSearchInput.placeholder || searchInput.placeholder
	Object.assign(searchInput.dataset, oldSearchInput.dataset)

	if (disabled) return dropdownElement

	// Get references to the newly created elements
	const triggerInput = dropdownElement.querySelector('input:not(.dropdown-content input)')
	const optionsList = dropdownContent.querySelector('ul')

	/**
	 * 获取项目文本。
	 * @param {object} itemData - 项目数据。
	 * @returns {string} - 项目文本。
	 */
	const getItemText = itemData => itemData[textKey] || itemData
	/**
	 * 获取项目值。
	 * @param {object} itemData - 项目数据。
	 * @returns {any} - 项目值。
	 */
	const getItemValue = itemData => itemData[valueKey] || itemData
	const buttonListeners = []

	/**
	 * 设置下拉菜单的值并更新其显示的集中式函数。
	 * @param {string | number} newValue - 要设置的新值。
	 * @returns {Promise<void>}
	 */
	const setValue = async (newValue) => {
		const selectedItem = dataList.find(item => getItemValue(item) == newValue)
		if (selectedItem) {
			triggerInput.value = getItemText(selectedItem)
			// Synchronize dataset.value if it's not already set to this value.
			if (dropdownElement.dataset.value !== String(newValue))
				dropdownElement.dataset.value = newValue
		}
		else {
			// If value is invalid, reset to placeholder.
			triggerInput.value = ''
			delete dropdownElement.dataset.value
		}
	}

	/**
	 * 聚焦事件侦听器。
	 * @returns {void}
	 */
	const focusinListener = () => dropdownElement.setAttribute('aria-expanded', 'true')
	/**
	 * 失焦事件侦听器。
	 * @returns {void}
	 */
	const focusoutListener = () => {
		if (!dropdownElement.contains(document.activeElement))
			dropdownElement.setAttribute('aria-expanded', 'false')
	}

	dropdownElement.addEventListener('focusin', focusinListener)
	dropdownElement.addEventListener('focusout', focusoutListener)

	// Function to render options
	/**
	 * 渲染选项。
	 * @param {Array<object>} filteredData - 筛选后的数据。
	 * @returns {void}
	 */
	const renderOptions = (filteredData) => {
		buttonListeners.forEach(({ button, listener }) => button.removeEventListener('click', listener))
		buttonListeners.length = 0 // Clear the array
		optionsList.innerHTML = filteredData.map(itemData => /* html */ `\
			<li class="w-full block">
				<button class="btn btn-ghost justify-start w-full" data-value="${getItemValue(itemData)}" role="option">${getItemText(itemData)}</button>
			</li>
		`).join('')

		optionsList.querySelectorAll('button').forEach(button => {
			/**
			 * 按钮点击事件侦听器。
			 * @returns {Promise<void>}
			 */
			const listener = async () => {
				const selectedValue = button.dataset.value
				const selectedItem = dataList.find(item => getItemValue(item) == selectedValue)
				if (await onSelect(selectedItem)) return
				await setValue(selectedValue)
				document.activeElement?.blur() // Close the dropdown
			}
			button.addEventListener('click', listener)
			buttonListeners.push({ button, listener })
		})
	}

	// Make the list searchable and Initial render
	makeSearchable({ searchInput, data: dataList, dataAccessor, onUpdate: renderOptions })

	// Initialize with existing dataset.value if it exists.
	await setValue(dropdownElement.dataset.value || null)

	// Observe for external changes to `data-value` to provide setter functionality.
	const observer = new MutationObserver(mutations => {
		mutations.forEach(async mutation => {
			if (mutation.type === 'attributes' && mutation.attributeName === 'data-value') {
				const newValue = dropdownElement.dataset.value
				await setValue(newValue)
			}
		})
	})
	observer.observe(dropdownElement, { attributes: true })

	onElementRemoved(dropdownElement, () => {
		buttonListeners.forEach(({ button, listener }) => button.removeEventListener('click', listener))
		dropdownElement.removeEventListener('focusin', focusinListener)
		dropdownElement.removeEventListener('focusout', focusoutListener)
		observer.disconnect()
	})
	return dropdownElement
}

// fix overlay issue
{
	const style = document.createElement('style')
	style.textContent = /* html */ `\
.searchable-dropdown:not(:focus-within) .dropdown-content {
	display: none;
}
`
	document.head.appendChild(style)
}
