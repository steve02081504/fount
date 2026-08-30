/**
 * “轻松新建” shell 的客户端逻辑。
 */
import { initTranslations, geti18n } from '../../scripts/i18n/index.mjs'
import { applyTheme } from '../../scripts/theme/index.mjs'
import { createMarkdownRichInput } from '/scripts/components/markdownRichInput.mjs'

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
 * 安装模板表单内的 markdown 富文本输入框（`[data-markdown-rich-input]`，幂等）。
 * i18n 观察器异步处理 `data-i18n`，这里先同步把 placeholder 落上，保证空态占位可见。
 * @returns {void}
 */
function installRichInputs() {
	for (const el of templateFormContainer.querySelectorAll('[data-markdown-rich-input]')) {
		if (!(el instanceof HTMLElement) || el.classList.contains('fount-markdown-rich-input')) continue
		const placeholderKey = el.dataset.i18n ? `${el.dataset.i18n}.placeholder` : ''
		const placeholder = placeholderKey ? geti18n(placeholderKey) : ''
		if (placeholder) el.setAttribute('placeholder', placeholder)
		createMarkdownRichInput(el, { enableDockedToolbar: true })
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
		installRichInputs()
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

		// 富文本输入框不是表单控件，手动同步回 FormData。
		for (const el of templateFormContainer.querySelectorAll('.fount-markdown-rich-input')) {
			const name = el.getAttribute('name')
			if (!name) continue
			formData.set(name, el.value)
		}

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

	templateSelect.addEventListener('change', loadTemplateUI)
	form.addEventListener('submit', handleFormSubmit)

	await loadTemplates()
}

main()
