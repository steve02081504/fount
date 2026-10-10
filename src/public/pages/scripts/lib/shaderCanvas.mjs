/**
 * 全屏片元着色器画布：WebGL2 单 pass 渲染、自动 uniform 设置、尺寸/像素比、隐藏暂停、减弱动效与上下文丢失恢复。
 * 适合把整页或局部背景交给一段 GLSL 画（装饰性画布记得加 `aria-hidden="true"`）。
 */

/**
 * 每段片元着色器前自动拼接的前言：版本、精度、内置 uniform、输出变量与 `fragPoint()`。
 * `fragPoint()` 返回以 CSS 像素计、左上角为原点的坐标，与 DOM 的 `clientX/clientY` 同一坐标系。
 */
const PRELUDE = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPixelScale;
out vec4 fragColor;
vec2 fragPoint() { return vec2(gl_FragCoord.x, uResolution.y * uPixelScale - gl_FragCoord.y) / uPixelScale; }
`

/**
 * 可拼进片元着色器的常用噪声：`hash21` / `noise`（值噪声）/ `fbm`（5 层，带旋转）/ `ridge`（脊状噪声，适合血管与裂纹）。
 */
export const GLSL_NOISE = `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
	float value = 0.0, amplitude = 0.5;
	mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
	for (int i = 0; i < 5; i++) { value += amplitude * noise(p); p = rotation * p * 2.03 + 17.0; amplitude *= 0.5; }
	return value;
}
float ridge(vec2 p, float sharpness) { return pow(1.0 - abs(noise(p) * 2.0 - 1.0), sharpness); }
`

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

/**
 * 编译单个着色器；失败时抛出带日志的错误。
 * @param {WebGL2RenderingContext} gl 上下文。
 * @param {number} type 着色器类型。
 * @param {string} source GLSL 源码。
 * @returns {WebGLShader} 着色器。
 */
function compile(gl, type, source) {
	const shader = gl.createShader(type)
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost())
		throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`)
	return shader
}

/**
 * 编译并链接一对完整的着色器源码（自行写 `#version 300 es`）；失败时抛出带日志的错误。
 * 自绘网格（如触手管体）时与 `uniformSetters` 搭配使用。
 * @param {WebGL2RenderingContext} gl 上下文。
 * @param {string} vertexSource 顶点着色器。
 * @param {string} fragmentSource 片元着色器。
 * @returns {WebGLProgram} 已链接的程序。
 */
export function createProgram(gl, vertexSource, fragmentSource) {
	const program = gl.createProgram()
	gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource))
	gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
	gl.linkProgram(program)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost())
		throw new Error(`shader link failed: ${gl.getProgramInfoLog(program)}`)
	return program
}

/**
 * 根据 `getActiveUniform` 报告的类型生成 setter，调用方只需传数字或数组。
 * @param {WebGL2RenderingContext} gl 上下文。
 * @param {WebGLProgram} program 程序。
 * @returns {Map<string, (value: number | ArrayLike<number>) => void>} uniform 名（数组去掉 `[0]`）到 setter。
 */
export function uniformSetters(gl, program) {
	const methods = {
		[gl.FLOAT]: ['uniform1f', 'uniform1fv'],
		[gl.FLOAT_VEC2]: ['uniform2fv', 'uniform2fv'],
		[gl.FLOAT_VEC3]: ['uniform3fv', 'uniform3fv'],
		[gl.FLOAT_VEC4]: ['uniform4fv', 'uniform4fv'],
		[gl.INT]: ['uniform1i', 'uniform1iv'],
		[gl.BOOL]: ['uniform1i', 'uniform1iv'],
	}
	const setters = new Map()
	const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
	for (let index = 0; index < count; index++) {
		const info = gl.getActiveUniform(program, index)
		const method = methods[info.type]?.[info.size > 1 ? 1 : 0]
		if (!method) continue
		const location = gl.getUniformLocation(program, info.name)
		setters.set(info.name.replace(/\[0\]$/u, ''), value => gl[method](location, typeof value === 'boolean' ? Number(value) : value))
	}
	return setters
}

/**
 * 在画布上跑一段全屏片元着色器。
 * @param {HTMLCanvasElement} canvas 目标画布（尺寸由 CSS 决定，内部像素随之自动调整）。
 * @param {object} options 选项。
 * @param {string} options.fragment 片元着色器主体（不含前言；可拼接 `GLSL_NOISE`）。写 `fragColor`。
 * @param {number} [options.scale=1] 相对 CSS 像素的渲染比例；重着色器用 0.5~0.75 换帧率，CSS 拉伸即可。
 * @param {number} [options.maxPixelRatio=1.5] 设备像素比上限。
 * @param {number} [options.reducedMotionFps=6] `prefers-reduced-motion` 时的帧率上限。
 * @param {(state: { time: number, delta: number, width: number, height: number }) => Record<string, number | ArrayLike<number>> | void} [options.onFrame] 每帧回调，返回要设置的 uniform。
 * @returns {{ supported: boolean, start: () => void, stop: () => void, destroy: () => void }} 控制句柄；`supported` 为 false 时（无 WebGL2）其余方法为空操作。
 */
export function createShaderCanvas(canvas, { fragment, scale = 1, maxPixelRatio = 1.5, reducedMotionFps = 6, onFrame }) {
	const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
	/** 无 WebGL2 时的空操作。 */
	const noop = () => { }
	if (!gl) return { supported: false, start: noop, stop: noop, destroy: noop }

	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
	let setters, frame = 0, running = false, startedAt, lastTime = 0, lastDrawAt = 0
	let width = 1, height = 1, pixelScale = 1

	/** 创建程序与全屏三角形；上下文恢复时也走这里。 */
	function build() {
		const program = createProgram(gl, VERTEX, PRELUDE + fragment)
		gl.useProgram(program)
		const buffer = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
		const location = gl.getAttribLocation(program, 'position')
		gl.enableVertexAttribArray(location)
		gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
		setters = uniformSetters(gl, program)
	}

	/** 按 CSS 尺寸、像素比与渲染比例同步画布内部像素。 */
	function resize() {
		width = Math.max(1, canvas.clientWidth)
		height = Math.max(1, canvas.clientHeight)
		pixelScale = Math.min(devicePixelRatio || 1, maxPixelRatio) * scale
		const pixelWidth = Math.max(1, Math.round(width * pixelScale))
		const pixelHeight = Math.max(1, Math.round(height * pixelScale))
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			canvas.width = pixelWidth
			canvas.height = pixelHeight
		}
		gl.viewport(0, 0, pixelWidth, pixelHeight)
	}

	/**
	 * 渲染一帧。
	 * @param {number} now `requestAnimationFrame` 时间戳。
	 */
	function draw(now) {
		frame = running ? requestAnimationFrame(draw) : 0
		if (reducedMotion.matches && now - lastDrawAt < 1000 / reducedMotionFps) return
		lastDrawAt = now
		if (gl.isContextLost()) return
		resize()
		const time = (now - startedAt) / 1000
		const delta = Math.min(0.1, Math.max(0, time - lastTime))
		lastTime = time
		const uniforms = onFrame?.({ time, delta, width, height }) ?? {}
		setters.get('uResolution')?.([width, height])
		setters.get('uTime')?.(time)
		setters.get('uPixelScale')?.(pixelScale)
		for (const [name, value] of Object.entries(uniforms)) setters.get(name)?.(value)
		gl.drawArrays(gl.TRIANGLES, 0, 3)
	}

	/** 开始（或恢复）渲染循环。 */
	function start() {
		if (running) return
		running = true
		frame = requestAnimationFrame(draw)
	}

	/** 暂停渲染循环。 */
	function stop() {
		running = false
		cancelAnimationFrame(frame)
	}

	/** 页面隐藏时暂停，回来时继续。 */
	function onVisibility() {
		if (document.hidden) stop()
		else start()
	}

	/**
	 * 上下文丢失：阻止默认行为以便恢复。
	 * @param {Event} event 事件。
	 */
	function onLost(event) {
		event.preventDefault()
		stop()
	}

	/** 上下文恢复：重建程序并继续。 */
	function onRestored() {
		build()
		start()
	}

	build()
	document.addEventListener('visibilitychange', onVisibility)
	canvas.addEventListener('webglcontextlost', onLost)
	canvas.addEventListener('webglcontextrestored', onRestored)
	startedAt = performance.now()

	return {
		supported: true,
		start,
		stop,
		/** 停止并解绑全部监听。 */
		destroy() {
			stop()
			document.removeEventListener('visibilitychange', onVisibility)
			canvas.removeEventListener('webglcontextlost', onLost)
			canvas.removeEventListener('webglcontextrestored', onRestored)
		},
	}
}
