import { escapeRegExp } from '../../../../../scripts/regex.mjs'

/**
 * @class MarkovGenerator
 * @classdesc 使用马尔可夫链生成文本的类。支持多次追加训练。
 */
export class MarkovGenerator {
	/**
	 * 构造函数。
	 * @param {object} root0 - 构造函数选项。
	 * @param {number} [root0.order=null] - 马尔可夫链的阶数。
	 * @param {string[]} [root0.specialTokens=[]] - 特殊令牌。
	 * @param {string} [root0.endToken=null] - 结束令牌。
	 */
	constructor({
		order = null,
		specialTokens = [],
		endToken = null,
	} = {
		order: null,
		specialTokens: [],
		endToken: null,
	}) {
		/**
		 * @member {number | null} order - 马尔可夫链的阶数。首次训练时设定，后续训练必须使用相同阶数。初始为 null。
		 */
		this.order = order
		/**
		 * @member {Map<string, string[]>} model - 存储马尔可夫模型的 Map。键是前缀（JSON字符串化的数组），值是可能的后续 token 数组。
		 * @private
		 */
		this.model = new Map()
		/**
		 * @member {Set<string>} prefixes - 训练数据中所有有效前缀（JSON字符串化的数组）的集合，用于随机起始和去重。
		 * @private
		 */
		this.prefixes = new Set()
		/**
		 * @member {number} totalTrainedTokens - 记录总共训练了多少 token，用于状态显示。
		 */
		this.totalTrainedTokens = 0
		/**
		 * @member {string} endToken - 结束 token，用于标记文本生成的结束。
		 */
		this.endToken = endToken
		/**
		 * @member {string[]} specialTokens - 特殊 token 数组，用于标记特定的文本片段。
		 */
		this.specialTokens = [...new Set([...specialTokens, endToken])] // 去重
	}

	/**
	 * 清空模型，重置所有状态。
	 */
	clear() {
		this.model.clear()
		this.prefixes.clear()
		this.totalTrainedTokens = 0
	}

	/**
	 * 分词器
	 * @param {string} text 输入文本
	 * @returns {string[]} token数组
	 * @private
	 */
	tokenize(text) {
		// 保持与原版一致
		const normalizedText = text.toLowerCase()
		const regex = new RegExp(`${this.specialTokens.map(escapeRegExp).join('|')}|\\s+|\\w+(['’]\\w+)*|[.,!?;:"！？。，《》…（）\\(\\)]|\\S`, 'g')
		const rawTokens = normalizedText.match(regex) || []
		return rawTokens.filter(token => token.length)
	}

	/**
	 * 训练模型。可以多次调用以追加数据。
	 * @param {string} inputText 训练文本
	 * @param {number} [order=9] 阶数。首次训练时设定，后续必须一致。
	 * @throws {RangeError} 如果 order 不是正整数 (English message)
	 * @throws {Error} 如果尝试使用与已训练模型不同的 order (English message)
	 * @throws {Error} 如果输入文本 token 不足 (English message)
	 * @returns {number} 本次训练新增的 token 数量。
	 */
	train(inputText, order = this.order || 9) {
		if (!Number.isInteger(order) || order < 1)
			throw new RangeError('Training error: order must be a positive integer.')

		// 如果模型已存在，检查阶数是否一致
		if (this.order !== null && this.order !== order)
			throw new Error(`Training error: Cannot train with order ${order}. Model was previously trained with order ${this.order}. Please reset the model first if you want to change the order.`)

		// 如果是首次训练，设置阶数
		if (this.order === null) this.order = order

		const newTokens = this.tokenize(inputText)
		const numNewTokens = newTokens.length

		if (numNewTokens <= this.order) {
			if (!this.totalTrainedTokens)
				throw new Error(`Training error: Input text has ${numNewTokens} tokens, which is not enough for order ${this.order}. Need at least ${this.order + 1} tokens for initial training.`)
			return 0
		}

		let addedPrefixCount = 0
		for (let i = 0; i <= newTokens.length - this.order; i++) {
			const prefixTokens = newTokens.slice(i, i + this.order)
			const prefixKey = JSON.stringify(prefixTokens)
			const suffix = i + this.order < newTokens.length ? newTokens[i + this.order] : null

			if (suffix !== null) {
				// 只有当后缀存在时，这个前缀才是有意义的训练数据点
				if (!this.prefixes.has(prefixKey)) {
					this.prefixes.add(prefixKey)
					addedPrefixCount++
				}
				if (!this.model.has(prefixKey))
					this.model.set(prefixKey, [])

				this.model.get(prefixKey).push(suffix)
			}
		}

		this.totalTrainedTokens += numNewTokens

		if (!addedPrefixCount && numNewTokens > this.order)
			console.warn('Training warning: No new unique prefixes could be generated from the added input text for the given order. The model might not have significantly improved.')

		return numNewTokens // 返回本次处理的 token 数
	}

	/**
	* 生成文本。
	* @param {object} [options={}] 生成选项
	* @param {number} [options.outputLength=this.endToken ? Infinity : 256] 期望生成的 token 数量。
	* @param {string} [options.prompt=''] 可选的提示文本。
	* @param {string} [options.startPrefix=''] 可选的起始前缀文本。
	* @param {boolean} [options.autoTrainning=true] 是否自动训练模型。
	* @returns {string} 生成的文本。
	* @throws {Error} 模型未训练或无法生成 (English message)。
	* @throws {RangeError} outputLength 无效 (English message)。
	*/
	generate(options = {}) {
		const { outputLength = this.endToken ? Infinity : 256, prompt = '', startPrefix = '', autoTrainning = true } = options

		if (autoTrainning) this.train(prompt + startPrefix)

		// --- 前置检查 ---
		if (!this.model.size)  // 检查模型是否已训练
			throw new Error('Generation error: Model has not been trained or is empty. Call train() first.')

		if (outputLength < 1)
			throw new RangeError('Generation error: outputLength must be a positive.')

		const availablePrefixes = Array.from(this.prefixes) // 从 Set 转为 Array
		if (!availablePrefixes.length)  // 检查是否有可用的起始点
			throw new Error('Generation error: No valid starting prefixes available in the model. Train with more diverse data or adjust order.')

		let currentPrefixTokens = []
		let currentPrefixKey = ''
		let outputTokens = []

		// --- 尝试处理用户指定的起始前缀 ---
		outputTokens = [...this.tokenize(startPrefix)] // 使用用户提供的完整起始内容初始化输出
		// 取最后 order 个 token 作为起始前缀
		currentPrefixTokens = this.tokenize(prompt + startPrefix).slice(-this.order)
		currentPrefixKey = JSON.stringify(currentPrefixTokens)

		while (outputTokens.length < outputLength) {
			const possibleSuffixes = this.model.get(currentPrefixKey)

			if (!possibleSuffixes?.length) {
				currentPrefixKey = availablePrefixes[Math.floor(Math.random() * availablePrefixes.length)]
				currentPrefixTokens = JSON.parse(currentPrefixKey)
				continue
			}

			// 选择下一个 token
			const nextToken = possibleSuffixes[Math.floor(Math.random() * possibleSuffixes.length)]
			if (this.endToken && nextToken === this.endToken) break
			outputTokens.push(nextToken)

			// 更新当前前缀（滑动窗口）
			currentPrefixTokens = currentPrefixTokens.slice(1) // 移除第一个
			currentPrefixTokens.push(nextToken) // 添加新的
			currentPrefixKey = JSON.stringify(currentPrefixTokens)
		}

		// --- 组合输出 ---
		return outputTokens.slice(0, outputLength).join('')
	}
}
