import { loadPart } from "../parts_loader.mjs"

export function loadWorld(username, worldname) {
	return loadPart(username, 'worlds', worldname)
}
