import { onElementRemoved } from './onElementRemoved.mjs'
import { parseRegexFromString, escapeRegExp } from './regex.mjs'

/**
 * Helper function for parsing a single filter term into a RegExp.
 * It creates a case-insensitive regex.
 * @param {string} filter The filter term.
 * @returns {RegExp}
 */
function parseRegexFilter(filter) {
	try { return parseRegexFromString(filter) }
	catch { return new RegExp(escapeRegExp(filter), 'i') }
}

/**
 * Splits a string into an array of filter terms.
 * Supports common filters, forced inclusion filters (prefixed with '+'),
 * and exclusion filters (prefixed with '-'). Also handles quoted terms.
 * @param {string} str The string to split into filter terms.
 * @returns {string[]} An array of filter terms.
 */
export function getFiltersFromString(str) {
	return str.match(/[+-]?(?:"(?:[^"\\]|\\.)*"|\S+)(\s|$)/g) || []
}

/**
 * Parses a filter string and returns a filter function.
 * The returned function takes an object and returns true if it matches the filters.
 * Supports common filters, forced inclusion filters (prefixed with '+'),
 * and exclusion filters (prefixed with '-'). Also handles quoted terms.
 * e.g., 'common term' +forced -"excluded term"
 * @param {string} filterString The raw filter string from user input.
 * @returns {(item: object) => boolean} A function that filters an object.
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
 * Binds a search input to a list of items for automatic, live filtering.
 *
 * This function attaches an event listener to the search input. As the user types,
 * it filters the provided list of items based on the search query.
 *
 * @param {object} options - The configuration for the search functionality.
 * @param {HTMLInputElement} options.searchInput - The `<input>` element used for search queries.
 * @param {Array<HTMLElement|object>} options.items - An array of items to be filtered. These can be HTML elements or data objects.
 * @param {function(HTMLElement|object): (object|string)} options.dataAccessor - A function that takes an item and returns the data (object or string) to be used for searching.
 */
export function makeSearchable({ searchInput, data, dataAccessor = (item) => item, onUpdate }) {
	const filterItems = () => {
		const filterFn = compileFilter(searchInput.value)
		const filteredData = data.filter(item => filterFn(dataAccessor(item)))
		onUpdate(filteredData)
	}
	searchInput.addEventListener('input', filterItems)
	searchInput.addEventListener('click', e => e.stopPropagation())
	filterItems() // Initial call

	onElementRemoved(searchInput, () => {
		searchInput.removeEventListener('input', filterItems)
		searchInput.removeEventListener('click', e => e.stopPropagation())
	})
	return searchInput
}

/**
 * Creates and manages a searchable dropdown menu, using an existing input element as the trigger.
 * It dynamically generates the dropdown content, binds search functionality,
 * and handles item selection.
 *
 * @param {object} options - The configuration for the searchable dropdown.
 * @param {HTMLElement} options.dropdownElement - The container element that will act as the dropdown. An input element will be automatically created or found within it to serve as the trigger.
 * @param {Array<object>} options.dataList - The array of data objects to populate the dropdown.
 * @param {string} options.textKey - The key in each data object to display as text in the dropdown.
 * @param {string} options.valueKey - The key in each data object to use as the value for selection.
 * @param {function(object): void} [options.onSelect=()=>{}] - Callback function when an item is selected. Receives the selected data object.
 * @param {function(object): (object|string)} [options.dataAccessor] - A function that takes a data object and returns the data (object or string) to be used for searching. Defaults to using `textKey`.
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

	if (disabled)
		dropdownElement.innerHTML = `<input type="text" placeholder="${triggerPlaceholder}" class="input input-bordered w-full" tabindex="0" role="button" readonly aria-autocomplete="list" aria-expanded="false" disabled />`
	else {
		const uniqueId = `dropdown-list-${Math.random().toString(36).substring(2, 9)}`

		// Create the dropdown content HTML structure
		dropdownElement.innerHTML = `\
<input type="text" placeholder="${triggerPlaceholder}" class="input input-bordered w-full cursor-pointer" tabindex="0" role="button" readonly aria-autocomplete="list" aria-controls="${uniqueId}" aria-expanded="false" />
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

	const getItemText = itemData => itemData[textKey] || itemData
	const getItemValue = itemData => itemData[valueKey] || itemData
	const buttonListeners = []

	/**
	 * Centralized function to set the dropdown's value and update its display.
	 * @param {string | number} newValue The new value to set.
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
		await onSelect(selectedItem || null)
	}

	const focusinListener = () => triggerInput.setAttribute('aria-expanded', 'true')
	const focusoutListener = () => {
		if (!dropdownElement.contains(document.activeElement))
			triggerInput.setAttribute('aria-expanded', 'false')
	}

	dropdownElement.addEventListener('focusin', focusinListener)
	dropdownElement.addEventListener('focusout', focusoutListener)

	// Function to render options
	const renderOptions = (filteredData) => {
		buttonListeners.forEach(({ button, listener }) => button.removeEventListener('click', listener))
		buttonListeners.length = 0 // Clear the array
		optionsList.innerHTML = filteredData.map(itemData => `\
			<li class="w-full block">
				<button class="btn btn-ghost justify-start w-full" data-value="${getItemValue(itemData)}" role="option">${getItemText(itemData)}</button>
			</li>
		`).join('')

		optionsList.querySelectorAll('button').forEach(button => {
			const listener = async () => {
				const selectedValue = button.dataset.value
				const selectedItem = dataList.find(item => getItemValue(item) == selectedValue)
				if (await onSelect(selectedItem)) return
				await setValue(selectedValue) // Use the new setter function
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
	style.textContent = `\
.searchable-dropdown:not(:focus-within) .dropdown-content {
	display: none;
}
`
	document.head.appendChild(style)
}
