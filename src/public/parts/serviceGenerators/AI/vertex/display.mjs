return async function ({ data, containers }) {
	const { generatorDisplay } = containers
	if (data.project && data.location) {
		generatorDisplay.replaceChildren()
		return
	}
	const hint = document.createElement('p')
	hint.className = 'text-warning'
	hint.dataset.i18n = 'serviceSource_manager.platforms.vertex.credentialsRequired'
	generatorDisplay.replaceChildren(hint)
}
