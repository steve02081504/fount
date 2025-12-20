import init from 'https://cdn.jsdelivr.net/gh/kwaroran/RisuAI@main/src/ts/rpack/rpack_bg.wasm?init'
let wasm

let cachedUint8ArrayMemory0 = null

/**
 * 获取 Uint8 数组内存
 * @returns {Uint8Array} Uint8 数组内存
 */
function getUint8ArrayMemory0() {
	if (!cachedUint8ArrayMemory0?.byteLength)
		cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer)

	return cachedUint8ArrayMemory0
}

/**
 * 初始化 Wasm
 * @returns {Promise<null>} 初始化完成后解析的 Promise
 */
async function initWasm() {
	if (wasm) return null

	const instance = await init()
	wasm = instance.exports
	return
}

let WASM_VECTOR_LEN = 0

/**
 * 将 8 位数组传递给 Wasm
 * @param {any} arg 参数
 * @param {any} malloc 分配器
 * @returns {number} 指针
 */
function passArray8ToWasm0(arg, malloc) {
	const ptr = malloc(arg.length * 1, 1) >>> 0
	getUint8ArrayMemory0().set(arg, ptr / 1)
	WASM_VECTOR_LEN = arg.length
	return ptr
}

let cachedDataViewMemory0 = null

/**
 * 获取数据视图内存
 * @returns {DataView} 数据视图内存
 */
function getDataViewMemory0() {
	if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer))
		cachedDataViewMemory0 = new DataView(wasm.memory.buffer)

	return cachedDataViewMemory0
}

/**
 * 从 Wasm 获取 U8 数组
 * @param {any} ptr 指针
 * @param {any} len 长度
 * @returns {Uint8Array} U8 数组
 */
function getArrayU8FromWasm0(ptr, len) {
	ptr = ptr >>> 0
	return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len)
}
/**
* 编码 RPack 数据。
* @param {Uint8Array} datas - 要编码的数据。
* @returns {Promise<Uint8Array>} - 编码后的数据。
*/
export async function encodeRPack(datas) {
	await initWasm()
	try {
		const retptr = wasm.__wbindgen_add_to_stack_pointer(-16)
		const ptr0 = passArray8ToWasm0(datas, wasm.__wbindgen_malloc)
		const len0 = WASM_VECTOR_LEN
		wasm.encode(retptr, ptr0, len0)
		const r0 = getDataViewMemory0().getInt32(retptr, true)
		const r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true)
		const v2 = getArrayU8FromWasm0(r0, r1).slice()
		wasm.__wbindgen_free(r0, r1 * 1, 1)
		return v2
	}
	finally {
		wasm.__wbindgen_add_to_stack_pointer(16)
	}
}

/**
* 解码 RPack 数据。
* @param {Uint8Array} datas - 要解码的数据。
* @returns {Promise<Uint8Array>} - 解码后的数据。
*/
export async function decodeRPack(datas) {
	await initWasm()
	try {
		const retptr = wasm.__wbindgen_add_to_stack_pointer(-16)
		const ptr0 = passArray8ToWasm0(datas, wasm.__wbindgen_malloc)
		const len0 = WASM_VECTOR_LEN
		wasm.decode(retptr, ptr0, len0)
		const r0 = getDataViewMemory0().getInt32(retptr, true)
		const r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true)
		const v2 = getArrayU8FromWasm0(r0, r1).slice()
		wasm.__wbindgen_free(r0, r1 * 1, 1)
		return v2
	}
	finally {
		wasm.__wbindgen_add_to_stack_pointer(16)
	}
}
