return async function ({ data, containers }) {
	const div = containers.generatorDisplay
	if (data.account_id && data.apikey) {
		div.replaceChildren()
		return
	}
	const hint = document.createElement('p')
	hint.className = 'text-warning'
	hint.dataset.i18n = 'serviceSource_manager.common_config_interface.oauth.credentialsRequired'
	div.replaceChildren(hint)
}
