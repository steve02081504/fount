/**
 * 恒等分词器（无本地 tokenizer 时用字符长度近似）。
 */
export const identityTokenizer = {
	/**
	 * 释放分词器。
	 * @returns {number} 0
	 */
	free: () => 0,
	/**
	 * 编码提示。
	 * @param {string} prompt - 文本。
	 * @returns {string} 原文。
	 */
	encode: prompt => prompt,
	/**
	 * 解码令牌。
	 * @param {string} tokens - 令牌。
	 * @returns {string} 原文。
	 */
	decode: tokens => tokens,
	/**
	 * 解码单个令牌。
	 * @param {string} token - 令牌。
	 * @returns {string} 原文。
	 */
	decode_single: token => token,
	/**
	 * 用字符长度近似 token 数。
	 * @param {string} prompt - 文本。
	 * @returns {number} 字符长度。
	 */
	get_token_count: prompt => prompt.length,
}
