import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadJsonFile } from '../../../../../scripts/json_loader.mjs'

const zhPath = join(dirname(fileURLToPath(import.meta.url)), '../../../../locales/zh-CN.json')

/** @type {Record<string, unknown> | null} */
let _zh = null

function zh() {
	if (!_zh) _zh = loadJsonFile(zhPath)
	return _zh
}

/**
 * 服务端默认群/频道文案（与 zh-CN.json `chat.group.defaults` 对齐）
 * @param {string} key
 */
export function groupDefaultString(key) {
	const o = zh().chat?.group?.defaults
	const v = o?.[key]
	return typeof v === 'string' ? v : String(key)
}
