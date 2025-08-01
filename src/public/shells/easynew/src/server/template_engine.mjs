export async function evaluateTemplate(html, data) {
	if (!html) return ''
	if (!data) data = {}

	const data_unpacker = `let { ${Object.keys(data).join(', ')} } = data;`
	let result = ''
	let remaining_html = html
	while (remaining_html.indexOf('${') != -1) {
		const length = remaining_html.indexOf('${')
		result += remaining_html.slice(0, length)
		remaining_html = remaining_html.slice(length + 2)
		let end_index = 0
		find: while (remaining_html.indexOf('}', end_index) != -1) {
			end_index = remaining_html.indexOf('}', end_index) + 1
			const expression = remaining_html.slice(0, end_index - 1)
			try {
				const eval_result = await eval(data_unpacker + '(async ()=>(' + expression + '))()')
				result += String(eval_result ?? '')
				remaining_html = remaining_html.slice(end_index)
				break find
			} catch (error) {
				// continue to find next '}'
			}
		}
	}
	result += remaining_html
	return result
}