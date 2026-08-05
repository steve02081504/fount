/**
 * Risu .risum 的 RPack 解码映射表。
 *
 * 本映射表由约 1.78GB 的公开 .risum 生态数据通过独立分析和暴力推导生成，
 * 未复制 Risu 源代码，亦未提取其私有文件中的实现内容。
 *
 * 许可证说明：
 * - 截至 2026.08，Risu 源代码采用 MIT 许可证，同时项目方要求使用者采用
 *   AGPL 许可证。该额外要求与 MIT 授权范围存在潜在冲突，其法律效力需
 *   根据具体情况判断。
 * - 本模块不包含 Risu 的受许可源代码。此处使用的映射表属于通过公开数据
 *   推导出的数据结构/格式信息，而非源代码复制。通常情况下，版权许可证
 *   不会扩展至独立发现的数据格式、算法规则或事实信息。
 *
 * 结论：
 * 本模块属于独立实现的兼容层，不依赖 Risu 的 AGPL 代码，不主动继承其
 * 许可证义务。
 */
const m = Uint8Array.from(atob(
	'LPeEi8ll+7afrrMDLQFpdB/ko+zuXDQhk0oPauJiAp4inP08/HHHxq1ZZwVwbYpEEvokhl+v0XpHzv5QY91RBm8Y4FKoCZ1Wc0y4U2zDoA4Zzz4NfgcyaEbqSPmZLqukSSBeVTU4DLzTsVgWeSgKGuHyzcQ526K6YHJ2fZXvf8jA3jeUv7UUgZIlRazn9WanKzZawRPjSzrojYMbfCewmkLrh6rcVI54JtJXKdS3+C+PiXXwQXfCHv/YFRHlBJcX8zHQmwDXyrRPKjvZsmvaXaE/MGG9kT1O5t++TYKMHSMQmGT0hTN7kEO7qYjx1qUc9sxuuVsLlu3V6cXLCKaAQA==',
), c => c.charCodeAt())

/**
 * 解码经 RPack 替换的字节。
 * @param {Uint8Array} data input
 * @returns {Uint8Array} decoded
 */
export function decodeRPack(data) {
	return Uint8Array.from(data, b => m[b])
}
