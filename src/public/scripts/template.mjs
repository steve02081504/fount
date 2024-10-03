let template_cache = {}
export async function renderTemplate(template, data) {
	if (!template_cache[template]) {
		// fetch template
		const response = await fetch('/template/' + template + '.html')

		// render template
		template_cache[template] = await response.text()
	}
	let html = template_cache[template]
	for (let key in data)
		html = html.replaceAll(`\${${key}}`, data[key])
	return html
}
