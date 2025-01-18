import { loadPart } from '../../../../../server/managers/index.mjs'

export async function getPartData(username, parttype, partname) {
	let part = await loadPart(username, parttype, partname)
	return await part.interfaces.config.GetData()
}

export async function setPartData(username, parttype, partname, data) {
	let part = await loadPart(username, parttype, partname)
	await part.interfaces.config.SetData(data)
}
