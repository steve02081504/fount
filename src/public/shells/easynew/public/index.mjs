/**
 * “轻松新建” shell 的客户端逻辑。
 */
import { initTranslations, geti18n, i18nElement } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

import { getTemplates, getTemplateHtml, createPart } from './src/endpoints.mjs'

const templateSelect = document.getElementById('template-select')
const templateFormContainer = document.getElementById('template-form-container')
const form = document.getElementById('create-part-form')
const responseMessage = document.getElementById('response-message')
const submitButton = document.getElementById('submit-button')
const submitSpinner = document.getElementById('submit-spinner')

/**
 * 加载模板。
 * @returns {Promise<void>}
 */
async function loadTemplates() {
	try {
		const templates = await getTemplates()
		templateSelect.innerHTML = ''
		for (const templateName in templates) {
			const option = document.createElement('option')
			option.value = templateName
			option.textContent = templateName
			templateSelect.appendChild(option)
		}
		await loadTemplateUI()
	}
	catch (error) {
		console.error('Failed to load templates:', error)
	}
}

/**
 * 加载模板 UI。
 * @returns {Promise<void>}
 */
async function loadTemplateUI() {
	const selectedTemplate = templateSelect.value
	if (!selectedTemplate) {
		templateFormContainer.innerHTML = ''
		return
	}

	try {
		const html = await getTemplateHtml(selectedTemplate)
		templateFormContainer.innerHTML = html
		i18nElement(templateFormContainer)
	}
	catch (error) {
		console.error(`Failed to load UI for template ${selectedTemplate}:`, error)
		templateFormContainer.innerHTML = /* html */ '<p class="text-error">Failed to load template UI.</p>'
	}
}

/**
 * 处理表单提交。
 * @param {Event} event - 事件。
 * @returns {Promise<void>}
 */
async function handleFormSubmit(event) {
	event.preventDefault()
	responseMessage.textContent = ''
	responseMessage.className = 'mt-4'
	submitButton.disabled = true
	submitSpinner.classList.remove('hidden')

	const templateName = templateSelect.value

	try {
		const templateForm = templateFormContainer.querySelector('form') || form
		const formData = new FormData(templateForm)

		formData.append('templateName', templateName)

		const result = await createPart(formData)

		responseMessage.textContent = geti18n('easynew.alerts.success', { partName: result.partName }) || result.message
		responseMessage.classList.add('alert', 'alert-success')
		form.reset()
		await loadTemplateUI()
	}
	catch (error) {
		responseMessage.textContent = geti18n('easynew.alerts.error', { message: error.message })
		responseMessage.classList.add('alert', 'alert-error')
	}
	finally {
		submitButton.disabled = false
		submitSpinner.classList.add('hidden')
	}
}

/**
 * 主函数。
 * @returns {Promise<void>}
 */
async function main() {
	applyTheme()
	await initTranslations('easynew')
	i18nElement(document.body)

	templateSelect.addEventListener('change', loadTemplateUI)
	form.addEventListener('submit', handleFormSubmit)

	await loadTemplates()
}

main()
