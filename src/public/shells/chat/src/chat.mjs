import { charAPI_t } from "../../../../decl/charAPI"
import { UserAPI_t } from "../../../../decl/UserAPI"
import { WorldAPI_t } from "../../../../decl/worldAPI"

let chatMetadatas = {}
export class timeSlice_t {
	/** @type {charAPI_t[]} */
	chars = []
	/** @type {string} */
	summary
	/** @type {WorldAPI_t} */
	world
	/** @type {UserAPI_t} */
	player
}
export class chatLogEntry_t {
	charName
	avatar
	timeStamp
	role
	content
	extension = {
		timeSlice: new timeSlice_t()
	}
}
function newMetadata(chatid, username) {
	chatMetadatas[chatid] = {
		username: username,
		chatLog: [],
		timeLines: []
	}
}

function setUser(chatid, username) {
	chatMetadatas[chatid].username = username
}
