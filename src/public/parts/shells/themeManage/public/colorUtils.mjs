// 简单的十六进制转 oklch 估算 (用于 UI 显示，实际上 DaisyUI 可以直接接受 Hex)
// 这里我们为了简单，主要处理从图片提取颜色

/**
 * 从给定图像中提取主要颜色。
 * @param {string} imageSrc - 图像的URL。
 * @param {number} [colorCount=4] - 要提取的主色数量。
 * @returns {Promise<string[]>} - 包含提取出的颜色的十六进制字符串数组的Promise。
 */
export async function extractColorsFromImage(imageSrc, colorCount = 4) {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.crossOrigin = 'Anonymous'
		/**
		 * 图像加载完成时的回调函数。
		 * @returns {void}
		 */
		img.onload = () => {
			const canvas = document.createElement('canvas')
			const ctx = canvas.getContext('2d')
			canvas.width = 100 // 缩小以提高性能
			canvas.height = 100 * (img.height / img.width)
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

			const imageData =
				ctx.getImageData(0, 0, canvas.width, canvas.height).data
			const colorMap = {}

			// 简单的量化算法
			for (let i = 0; i < imageData.length; i += 4) {
				const r = Math.round(imageData[i] / 24) * 24
				const g = Math.round(imageData[i + 1] / 24) * 24
				const b = Math.round(imageData[i + 2] / 24) * 24
				// 忽略透明或过暗/过亮
				if (imageData[i + 3] < 128) continue
				if (r + g + b < 50 || r + g + b > 700) continue

				const key = `rgb(${r},${g},${b})`
				colorMap[key] = (colorMap[key] || 0) + 1
			}

			// 排序并取前 N 个
			const sorted = Object.entries(colorMap)
				.sort((a, b) => b[1] - a[1])
				.slice(0, colorCount)
				.map((entry) => {
					// RGB 转 Hex
					const rgb = entry[0].match(/\d+/g).map(Number)
					return '#' +
						((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16)
							.slice(1)
				})
			resolve(sorted)
		}
		img.onerror = reject
		img.src = imageSrc
	})
}
