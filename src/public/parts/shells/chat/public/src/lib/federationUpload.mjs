/**
 * 【文件】public/src/lib/federationUpload.mjs
 * 【职责】联邦文件分块上传辅助：单块上限常量与 ArrayBuffer→Base64。
 * 【原理】FEDERATION_CHUNK_MAX_BYTES=512KiB（§10.2）；arrayBufferToBase64 供分块 POST body。
 * 【数据结构】Uint8Array/ArrayBuffer、base64 字符串。
 * 【关联】ui/groupFileUpload.mjs、groupFileBlob.mjs。
 */
export { arrayBufferToBase64 } from '/scripts/lib/base64.mjs'

/**
 *
 */
export const FEDERATION_CHUNK_MAX_BYTES = 512 * 1024
