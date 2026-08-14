/**
 * Steam shortcuts.vdf 二进制 KV：解析/写出，以及非 Steam 游戏的 CRC32 appid。
 */
import { Buffer } from 'node:buffer'
import { crc32 } from 'node:zlib'

const TYPE_OBJECT = 0
const TYPE_STRING = 1
const TYPE_INT = 2
const TYPE_END = 8

/**
 * 非 Steam 快捷方式 appid：crc32(Exe 字段 + AppName) 且最高位置 1。
 * 库封面/英雄图文件名必须用这个值，随机 id Steam 对不上图。
 * @param {string} exe shortcuts.vdf 里的 Exe（含引号）
 * @param {string} appName AppName
 * @returns {number} uint32 appid
 */
export function steamShortcutAppId(exe, appName) {
	return (crc32(exe + appName) | 0x80000000) >>> 0
}

/**
 * 该 appid 在 grid 目录里的文件名。
 * @param {number} appId CRC32 appid
 * @returns {{ landscape: string, portrait: string, hero: string, logo: string, icon: string, bigPicture: string }} 文件名
 */
export function steamGridFilenames(appId) {
	const id = String(appId >>> 0)
	const bigPicture = (BigInt(appId >>> 0) << 32n | 0x02000000n).toString()
	return {
		landscape: `${id}.png`,
		portrait: `${id}p.png`,
		hero: `${id}_hero.png`,
		logo: `${id}_logo.png`,
		icon: `${id}_icon.png`,
		bigPicture: `${bigPicture}.png`,
	}
}

/**
 * 是否为该 appid 的 grid 图。
 * @param {string} file 文件名
 * @param {number} appId appid
 * @returns {boolean} 是则 true
 */
export function isSteamGridFile(file, appId) {
	const id = String(appId >>> 0)
	const bigPicture = (BigInt(appId >>> 0) << 32n | 0x02000000n).toString()
	return file.startsWith(`${id}.`) || file.startsWith(`${id}p.`) || file.startsWith(`${id}_`) || file.startsWith(`${bigPicture}.`)
}

/**
 * 解析二进制 VDF。
 * @param {Uint8Array} buf 文件内容；空则 `{ shortcuts: {} }`
 * @returns {object} 根对象
 */
export function parseBinaryVdf(buf) {
	if (!buf.length) return { shortcuts: {} }
	let offset = 0
	/**
	 * @returns {string} 以 NUL 结尾的字符串
	 */
	function readString() {
		const start = offset
		while (offset < buf.length && buf[offset]) offset++
		const text = new TextDecoder().decode(buf.subarray(start, offset))
		offset++
		return text
	}
	/**
	 * @returns {object} 对象
	 */
	function readObject() {
		const object = {}
		while (offset < buf.length) {
			const type = buf[offset++]
			if (type === TYPE_END) return object
			const key = readString()
			if (type === TYPE_OBJECT) object[key] = readObject()
			else if (type === TYPE_STRING) object[key] = readString()
			else if (type === TYPE_INT) {
				object[key] = (buf[offset] | buf[offset + 1] << 8 | buf[offset + 2] << 16 | buf[offset + 3] << 24) >>> 0
				offset += 4
			}
			else throw new Error(`shortcuts.vdf: unknown type ${type} at ${offset - 1}`)
		}
		return object
	}
	return readObject()
}

/**
 * 写出二进制 VDF。
 * @param {object} root 根对象
 * @returns {Buffer} 文件内容
 */
export function writeBinaryVdf(root) {
	const chunks = []
	/**
	 * @param {string} text 字符串
	 * @returns {void}
	 */
	function writeString(text) {
		chunks.push(Buffer.from(String(text), 'utf8'), Buffer.from([0]))
	}
	/**
	 * @param {object} object 对象
	 * @returns {void}
	 */
	function writeObject(object) {
		for (const [key, value] of Object.entries(object)) 
			if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
				chunks.push(Buffer.from([TYPE_OBJECT]))
				writeString(key)
				writeObject(value)
			}
			else if (typeof value === 'number' || typeof value === 'boolean') {
				chunks.push(Buffer.from([TYPE_INT]))
				writeString(key)
				const number = Buffer.alloc(4)
				number.writeUInt32LE(Number(value) >>> 0)
				chunks.push(number)
			}
			else {
				chunks.push(Buffer.from([TYPE_STRING]))
				writeString(key)
				writeString(value ?? '')
			}
		
		chunks.push(Buffer.from([TYPE_END]))
	}
	writeObject(root)
	return Buffer.concat(chunks)
}

/**
 * JS 字段 → Steam VDF 字段（只写传入的键）。
 * @param {object} fields camelCase 字段
 * @returns {object} Steam 字段
 */
export function entryToSteam(fields) {
	const steam = {}
	if ('appId' in fields) steam.appid = fields.appId >>> 0
	if ('appName' in fields) steam.AppName = fields.appName
	if ('exe' in fields) steam.Exe = fields.exe
	if ('startDir' in fields) steam.StartDir = fields.startDir
	if ('icon' in fields) steam.icon = fields.icon
	if ('shortcutPath' in fields) steam.ShortcutPath = fields.shortcutPath
	if ('launchOptions' in fields) steam.LaunchOptions = fields.launchOptions
	if ('isHidden' in fields) steam.IsHidden = fields.isHidden ? 1 : 0
	if ('allowDesktopConfig' in fields) steam.AllowDesktopConfig = fields.allowDesktopConfig ? 1 : 0
	if ('allowOverlay' in fields) steam.AllowOverlay = fields.allowOverlay ? 1 : 0
	if ('openVr' in fields) steam.OpenVR = fields.openVr ? 1 : 0
	if ('devkit' in fields) steam.Devkit = fields.devkit ? 1 : 0
	if ('devkitGameId' in fields) steam.DevkitGameID = fields.devkitGameId
	if ('devkitOverrideAppId' in fields) steam.DevkitOverrideAppID = fields.devkitOverrideAppId >>> 0
	if ('lastPlayTime' in fields) steam.LastPlayTime = fields.lastPlayTime >>> 0
	if ('flatpakAppId' in fields) steam.FlatpakAppID = fields.flatpakAppId
	if ('tags' in fields)
		steam.tags = Object.fromEntries((fields.tags || []).map((tag, index) => [String(index), tag]))
	return steam
}

/**
 * Steam VDF 条目 → JS 字段。
 * @param {object} raw Steam 条目
 * @returns {object} camelCase 条目
 */
export function steamToEntry(raw) {
	return {
		appId: (raw.appid || 0) >>> 0,
		appName: raw.AppName || '',
		exe: raw.Exe || '',
		startDir: raw.StartDir || '',
		icon: raw.icon || '',
	}
}

/**
 * 空白非 Steam 条目。
 * @returns {object} Steam 字段
 */
function blankSteamEntry() {
	return {
		appid: 0,
		AppName: '',
		Exe: '',
		StartDir: '',
		icon: '',
		ShortcutPath: '',
		LaunchOptions: '',
		IsHidden: 0,
		AllowDesktopConfig: 1,
		AllowOverlay: 1,
		OpenVR: 0,
		Devkit: 0,
		DevkitGameID: '',
		DevkitOverrideAppID: 0,
		LastPlayTime: 0,
		FlatpakAppID: '',
		tags: {},
	}
}

/**
 * shortcuts.vdf 的增删改。
 */
export class ShortcutsFile {
	/**
	 * @param {object} [root] 根对象
	 * @param {string} [path] 保存路径
	 */
	constructor(root = { shortcuts: {} }, path = '') {
		this.root = root
		if (!this.root.shortcuts || typeof this.root.shortcuts !== 'object')
			this.root.shortcuts = {}
		this.path = path
	}

	/**
	 * @param {Uint8Array} buf 文件
	 * @param {string} [path] 路径
	 * @returns {ShortcutsFile} shortcuts
	 */
	static fromBuffer(buf, path = '') {
		return new ShortcutsFile(parseBinaryVdf(buf), path)
	}

	/** @returns {object[]} camelCase 条目 */
	get entries() {
		return Object.values(this.root.shortcuts).map(steamToEntry)
	}

	/**
	 * @returns {string} 下一个数字键
	 */
	#nextKey() {
		const keys = Object.keys(this.root.shortcuts).map(Number)
		return String(keys.length ? Math.max(...keys) + 1 : 0)
	}

	/**
	 * @param {object} fields camelCase 字段
	 * @returns {object} 新条目
	 */
	addEntry(fields) {
		const steam = {
			...blankSteamEntry(),
			...entryToSteam(fields),
		}
		if (!('appId' in fields) && steam.Exe && steam.AppName)
			steam.appid = steamShortcutAppId(steam.Exe, steam.AppName)
		this.root.shortcuts[this.#nextKey()] = steam
		return steamToEntry(steam)
	}

	/**
	 * 删掉所有该 appid 的条目。
	 * @param {number} appId appid
	 * @returns {void}
	 */
	deleteEntry(appId) {
		for (const [key, raw] of Object.entries(this.root.shortcuts))
			if ((raw.appid >>> 0) === (appId >>> 0))
				delete this.root.shortcuts[key]
	}

	/**
	 * @param {number} appId appid
	 * @param {object} fields 补丁
	 * @returns {void}
	 */
	editEntry(appId, fields) {
		const patch = entryToSteam(fields)
		for (const raw of Object.values(this.root.shortcuts))
			if ((raw.appid >>> 0) === (appId >>> 0))
				Object.assign(raw, patch)
	}

	/**
	 * 按谓词留下第一条并打补丁，其余删掉；没有则新增。
	 * @param {(entry: object) => boolean} match 匹配
	 * @param {object} fields 字段（含 appId）
	 * @returns {{ appId: number, action: 'added' | 'updated', oldAppIds: number[] }} 结果
	 */
	upsert(match, fields) {
		const keys = Object.entries(this.root.shortcuts)
			.filter(([, raw]) => match(steamToEntry(raw)))
			.map(([key]) => key)
		const patch = entryToSteam(fields)
		if (!keys.length) {
			this.addEntry(fields)
			return { appId: patch.appid >>> 0, action: 'added', oldAppIds: [] }
		}
		const oldAppIds = keys.map(key => this.root.shortcuts[key].appid >>> 0)
		const [keep, ...extras] = keys
		for (const key of extras) delete this.root.shortcuts[key]
		Object.assign(this.root.shortcuts[keep], patch)
		return {
			appId: this.root.shortcuts[keep].appid >>> 0,
			action: 'updated',
			oldAppIds: oldAppIds.filter(id => id !== (patch.appid >>> 0)),
		}
	}

	/**
	 * @param {string} [path] 路径
	 * @returns {Buffer} 写出的缓冲
	 */
	toBuffer() {
		this.root.shortcuts = Object.fromEntries(
			Object.values(this.root.shortcuts).map((entry, index) => [String(index), entry])
		)
		return writeBinaryVdf(this.root)
	}
}
