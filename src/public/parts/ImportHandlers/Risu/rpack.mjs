/**
 * Risu .risum 的 RPack 解码映射表。
 *
 * 本映射表由约 1.78GB 的公开 .risum 生态数据通过独立分析和暴力推导生成，
 * 未复制 Risu 源代码，亦未提取其私有文件中的实现内容。
 */
const rpackByteMap = Uint8Array.from(atob(
	'LPeEi8ll+7afrrMDLQFpdB/ko+zuXDQhk0oPauJiAp4inP08/HHHxq1ZZwVwbYpEEvokhl+v0XpHzv5QY91RBm8Y4FKoCZ1Wc0y4U2zDoA4Zzz4NfgcyaEbqSPmZLqukSSBeVTU4DLzTsVgWeSgKGuHyzcQ526K6YHJ2fZXvf8jA3jeUv7UUgZIlRazn9WanKzZawRPjSzrojYMbfCewmkLrh6rcVI54JtJXKdS3+C+PiXXwQXfCHv/YFRHlBJcX8zHQmwDXyrRPKjvZsmvaXaE/MGG9kT1O5t++TYKMHSMQmGT0hTN7kEO7qYjx1qUc9sxuuVsLlu3V6cXLCKaAQA==',
), c => c.charCodeAt())

/**
 * 解码经 RPack 替换的字节。
 * @param {Uint8Array} data input
 * @returns {Uint8Array} decoded
 */
export function decodeRPack(data) {
	return Uint8Array.from(data, byte => rpackByteMap[byte])
}
