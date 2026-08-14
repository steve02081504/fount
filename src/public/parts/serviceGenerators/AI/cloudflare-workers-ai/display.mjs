return async function ({ data, containers }) {
	const generatorDisplay = containers.generatorDisplay
	if (data.account_id && data.apikey) {
		generatorDisplay.replaceChildren()
		return
	}
	const hint = document.createElement('p')
	hint.className = 'text-warning'
	hint.dataset.i18n = 'serviceSource_manager.common_config_interface.oauth.credentialsRequired'
	generatorDisplay.replaceChildren(hint)
}
