/* global cache, hosturl, parturl, sourceName, serviceSourcePath */
const { renderOauthPanel } = await import(new URL('/parts/shells:oauth_handler/src/oauthDisplay.mjs', hosturl).href)
const { codexModels } = await import(`${parturl}/endpoints.mjs`)
const { getServiceSourceFile } = await import(new URL('/parts/shells:serviceSourceManage/src/endpoints.mjs', hosturl).href)

const i18nBase = 'serviceSource_manager.common_config_interface'

/**
 * Codex 服务源附加配置：模型与推理强度只是 JSON 编辑器的快捷选择，不校验或限制手填值。
 * @param {object} args - 管理页提供的配置、容器及编辑器。
 * @returns {Promise<void>} 完成当前轮渲染。
 */
return async function onJsonUpdate({ data, containers, editors }) {
	const renderId = cache.codexRenderId = (cache.codexRenderId ?? 0) + 1
	await renderOauthPanel({
		data,
		containers,
		editors,
		provider: 'openai-codex',
		sourceName,
		serviceSourcePath,
		cache,
	})
	if (renderId !== cache.codexRenderId) return

	if (!sourceName || !data.oauth?.access) {
		delete cache.codexCatalogPromise
		return
	}

	const panel = document.createElement('div')
	panel.className = 'flex flex-col gap-3 mb-4'
	const status = document.createElement('p')
	status.className = 'text-sm opacity-80'
	panel.append(status)
	containers.generatorDisplay.append(panel)

	const catalogKey = `${sourceName}\0${data.oauth.accountId ?? ''}`
	if (cache.codexCatalogKey !== catalogKey || !cache.codexCatalogPromise) {
		cache.codexCatalogKey = catalogKey
		cache.codexCatalogPromise = codexModels(sourceName).catch(error => {
			delete cache.codexCatalogPromise
			throw error
		})
	}
	status.dataset.i18n = `${i18nBase}.loadingModels`
	let models, catalogError
	try {
		models = (await cache.codexCatalogPromise).models
	}
	catch (error) {
		catalogError = error
	}
	// 服务端可能在读取目录时刷新 OAuth；只合并新凭证，保留正在编辑的其他字段。
	try {
		const latest = (await getServiceSourceFile(sourceName, serviceSourcePath)).config?.oauth
		if (renderId !== cache.codexRenderId || !panel.isConnected) return
		const current = editors.json.getJson()
		if (latest?.access && latest.access !== data.oauth.access && current.oauth?.access === data.oauth.access) {
			const updated = { ...current, oauth: latest }
			editors.json.set({ json: updated })
			return onJsonUpdate({ data: updated, containers, editors }) // 程序设置 JSON 不触发编辑器的 onChange。
		}
	}
	catch (error) {
		catalogError = error
	}
	if (renderId !== cache.codexRenderId || !panel.isConnected) return
	if (catalogError) {
		status.dataset.message = catalogError.message
		status.dataset.i18n = `${i18nBase}.loadModelsFailed`
		return
	}

	status.remove()
	const modelLabel = document.createElement('label')
	modelLabel.className = 'form-control w-full'
	const modelTitle = document.createElement('span')
	modelTitle.className = 'label-text mb-1'
	modelTitle.dataset.i18n = `${i18nBase}.availableModels`
	const modelSelect = document.createElement('select')
	modelSelect.className = 'select select-bordered w-full'
	modelSelect.dataset.codexModelSelect = ''
	modelLabel.append(modelTitle, modelSelect)

	const effortLabel = document.createElement('label')
	effortLabel.className = 'form-control w-full'
	const effortTitle = document.createElement('span')
	effortTitle.className = 'label-text mb-1'
	effortTitle.dataset.i18n = `${i18nBase}.reasoningEffort`
	const effortSelect = document.createElement('select')
	effortSelect.className = 'select select-bordered w-full'
	effortSelect.dataset.codexEffortSelect = ''
	effortLabel.append(effortTitle, effortSelect)
	const effortWarning = document.createElement('p')
	effortWarning.className = 'text-sm text-warning'
	effortWarning.dataset.i18n = `${i18nBase}.unsupportedEffort`
	panel.append(modelLabel, effortLabel, effortWarning)

	const getConfig = () => editors.json.getJson()
	const currentModel = getConfig().model ?? ''
	if (!currentModel) {
		const placeholder = new Option('', '')
		placeholder.disabled = true
		placeholder.selected = true
		placeholder.dataset.i18n = `${i18nBase}.selectModel`
		modelSelect.add(placeholder)
	}
	if (currentModel && !models.some(model => model.slug === currentModel)) {
		const option = new Option(currentModel, currentModel)
		option.setAttribute('user-content', '')
		modelSelect.add(option)
	}
	for (const model of models) {
		const option = new Option(model.displayName === model.slug ? model.slug : `${model.displayName} (${model.slug})`, model.slug)
		option.setAttribute('user-content', '')
		modelSelect.add(option)
	}
	// 空目录也不擦掉用户原先手填的模型。
	if (currentModel) modelSelect.value = currentModel
	modelSelect.disabled = !modelSelect.options.length

	function updateEffortOptions() {
		const selectedModel = models.find(model => model.slug === modelSelect.value)
		const currentEffort = getConfig().model_arguments?.reasoning?.effort
		effortSelect.replaceChildren()
		const providerDefault = new Option('', '')
		providerDefault.dataset.i18n = selectedModel?.defaultReasoningLevel
			? `${i18nBase}.useDefaultReasoningWithLevel`
			: `${i18nBase}.useDefaultReasoning`
		providerDefault.dataset.level = selectedModel?.defaultReasoningLevel ?? ''
		effortSelect.add(providerDefault)
		const levels = selectedModel?.supportedReasoningLevels ?? []
		if (currentEffort && !levels.includes(currentEffort)) {
			const option = new Option(currentEffort, currentEffort)
			option.setAttribute('user-content', '')
			effortSelect.add(option)
		}
		for (const level of levels) {
			const option = new Option(level, level)
			option.setAttribute('user-content', '')
			effortSelect.add(option)
		}
		effortSelect.value = currentEffort ?? ''
		effortWarning.hidden = !selectedModel || !currentEffort || levels.includes(currentEffort)
	}
	updateEffortOptions()

	modelSelect.addEventListener('change', () => {
		const current = getConfig()
		editors.json.set({ json: { ...current, model: modelSelect.value } })
		updateEffortOptions()
	})
	effortSelect.addEventListener('change', () => {
		const current = getConfig()
		const model_arguments = { ...current.model_arguments }
		const reasoning = { ...model_arguments.reasoning }
		if (effortSelect.value) reasoning.effort = effortSelect.value
		else delete reasoning.effort
		if (Object.keys(reasoning).length) model_arguments.reasoning = reasoning
		else delete model_arguments.reasoning
		editors.json.set({ json: { ...current, model_arguments } })
	})
}
