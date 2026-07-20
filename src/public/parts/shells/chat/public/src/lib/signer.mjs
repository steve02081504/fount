/**
 * 【文件】public/src/lib/signer.mjs
 * 【职责】浏览器侧 Ed25519 签名/验签薄封装（动态加载 @noble/ed25519）。
 * 【原理】懒加载 signerLib；sign(message, secretKey)、verify(signature, message, publicKey)。
 * 【数据结构】Uint8Array 密钥与消息、hex 签名。
 * 【关联】dmLink.mjs。
 */
let signerLib

/**
 * @returns {Promise<{ sign: Function, verify: Function }>} 动态加载的签名库
 */
async function loadSignerLib() {
	if (!signerLib) signerLib = import('https://esm.sh/@noble/ed25519')
	return signerLib
}

/**
 * @param {Uint8Array} message 待签消息
 * @param {Uint8Array} secretKey 32 字节私钥种子
 * @returns {Promise<Uint8Array>} 64 字节签名
 */
export async function sign(message, secretKey) {
	const lib = await loadSignerLib()
	return lib.sign(message, secretKey)
}

/**
 * @param {Uint8Array} signature 64 字节签名
 * @param {Uint8Array} message 原始消息
 * @param {Uint8Array} publicKey 32 字节公钥
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verify(signature, message, publicKey) {
	const lib = await loadSignerLib()
	return lib.verify(signature, message, publicKey)
}
