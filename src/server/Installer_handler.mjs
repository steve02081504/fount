import { LoadCharTemplate } from "./charTemplate_manager.mjs"
import { getPartList } from "./parts_loader.mjs"

export async function importChar(username, data) {
	let charTemplates = getPartList(username, 'charTemplates')
	for (let charTemplate of charTemplates) try {
		let template = await LoadCharTemplate(username, charTemplate)
		await template.ImportChar(username, data)
	} catch (err) {
		console.log(err)
	}
}

export async function importCharByText(username, text) {
	let charTemplates = getPartList(username, 'charTemplates')
	for (let charTemplate of charTemplates) try {
		let template = await LoadCharTemplate(username, charTemplate)
		await template.ImportCharByText(username, text)
	} catch (err) {
		console.log(err)
	}
}
