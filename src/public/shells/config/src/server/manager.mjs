import { loadPart } from '../../../../../server/managers/index.mjs'

export async function getPartData(username, parttype, partname) {
	try {
		let part = await loadPart(username, parttype, partname)
		return await part.interfaces.config.GetData()
	} catch (error) {
		throw new Error(`Failed to get data for part ${partname}: ${error.message}\n${error.stack}`)
	}
}

export async function setPartData(username, parttype, partname, data) {
	try {
		let part = await loadPart(username, parttype, partname)
		await part.interfaces.config.SetData(data)
	} catch (error) {
		throw new Error(`Failed to set data for part ${partname}: ${error.message}\n${error.stack}`)
	}
}
