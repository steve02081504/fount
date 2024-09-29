export async function renderTemplate(template, data) {
	// fetch template
	const response = await fetch('/template/' + template + '.html')

	// render template
	let html = await response.text()
	for (let key in data)
		html = html.replaceAll(`\${${key}}`, data[key])
	return html
}
