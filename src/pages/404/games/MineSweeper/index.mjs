import { initTranslations, geti18n } from '../../../scripts/i18n.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
applyTheme()
initTranslations('404')

const boardElement = document.getElementById('game-board')
const minesLeftElement = document.getElementById('mines-left')
const timerElement = document.getElementById('timer')
const messageElement = document.getElementById('message')
const restartButton = document.getElementById('restart-button')
const difficultySelect = document.getElementById('difficulty')
const customOptions = document.getElementById('custom-options')
const customRowsInput = document.getElementById('custom-rows')
const customColsInput = document.getElementById('custom-cols')
const customMinesInput = document.getElementById('custom-mines')
const soundToggle = document.getElementById('sound-toggle')
const clickSound = new Audio('/404/games/MineSweeper/sounds/mouse-click.mp3')
const explosionSound = new Audio('/404/games/MineSweeper/sounds/explosion.mp3')

let rows = 9
let cols = 9
let mines = 10
let board = []
let gameStarted = false
let timerInterval
let seconds = 0
let flaggedMines = 0
let isMuted = true
let isGameOver = false // Track game over state
customOptions.classList.toggle('hidden', difficultySelect.value !== 'custom')

// 默认地雷比例
const DEFAULT_MINE_RATIO = 0.15625

function launchConfetti() {
	confetti({
		particleCount: 100,
		spread: 70,
		origin: { y: 0.6 }
	})
}

/**
 * 更新单元格显示状态 (根据单元格数据更新 DOM 样式和内容)
 * @param {number} row 行索引
 * @param {number} col 列索引
 */
function updateCellDisplay(row, col) {
	const cell = board[row][col]
	const td = boardElement.rows[row].cells[col]
	td.classList.remove('clicked', 'flagged', 'question', 'correct-flag', 'wrong-flag', 'mine') // 移除所有状态 class
	td.textContent = '' // 重置文本内容

	if (isGameOver && cell.isFlagged)  // 游戏结束后旗帜的特殊显示
		if (!cell.isMine) {
			td.textContent = '❌'
			td.classList.add('wrong-flag')
		} else {
			td.textContent = '🚩'
			td.classList.add('correct-flag')
		}
	else if (cell.isRevealed) {
		td.classList.add('clicked')
		if (cell.isMine) {
			td.textContent = '💣'
			td.classList.add('mine')
		} else if (cell.adjacentMines > 0) {
			td.textContent = cell.adjacentMines
			td.style.color = ['blue', 'green', 'red', 'purple', 'maroon', 'turquoise', 'black', 'gray'][cell.adjacentMines - 1]
		}
	} else if (cell.isFlagged) {
		td.textContent = '🚩'
		td.classList.add('flagged')
	} else if (cell.isQuestion) {
		td.textContent = '❓'
		td.classList.add('question')
	}
}

/**
 * 初始化游戏参数 (根据难度设置行数、列数、地雷数)
 */
function initGame() {
	const difficulty = difficultySelect.value
	switch (difficulty) {
		case 'easy':
			rows = 9
			cols = 9
			mines = 10
			break
		case 'medium':
			rows = 16
			cols = 16
			mines = 40
			break
		case 'hard':
			rows = 16
			cols = 30
			mines = 99
			break
		default: // custom 难度
			updateCustomSettings() // 更新自定义设置 (合并了 updateRowsCols 和 updateMines)
			break
	}
	flaggedMines = 0
	minesLeftElement.textContent = mines - flaggedMines
	resetTimer()
	gameStarted = false
	isGameOver = false // 重置游戏结束状态
	messageElement.textContent = ''
	setControlsEnabled(true)
}

/**
 * 创建游戏棋盘 (生成 board 数组和 HTML table)
 */
function createBoard() {
	board = []
	boardElement.innerHTML = ''

	for (let i = 0; i < rows; i++) {
		const row = []
		const tr = document.createElement('tr')
		for (let j = 0; j < cols; j++) {
			const cell = {
				isMine: false,
				isRevealed: false,
				isFlagged: false,
				isQuestion: false,
				adjacentMines: 0
			}
			row.push(cell)

			const td = document.createElement('td')
			td.addEventListener('click', () => cellClickHandler(i, j)) // 使用统一的点击处理函数
			td.addEventListener('contextmenu', (event) => cellRightClickHandler(i, j, event)) // 使用统一的右键处理函数
			tr.appendChild(td)
			td.classList.add('w-8', 'h-8', 'p-0') // Tailwind sizing and padding
		}
		board.push(row)
		boardElement.appendChild(tr)
	}
}

/**
 * 放置地雷 (随机放置，并确保第一次点击不是地雷)
 * @param {number} firstClickRow 第一次点击的行索引
 * @param {number} firstClickCol 第一次点击的列索引
 */
function placeMines(firstClickRow, firstClickCol) {
	const cells = []
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++)
			cells.push({ row: i, col: j })

	// Fisher-Yates 洗牌算法
	function shuffle(array) {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]]
		}
	}

	shuffle(cells)

	// Place mines in the first 'mines' cells of the shuffled array
	for (let i = 0; i < Math.min(mines, cells.length); i++) {
		const { row, col } = cells[i]
		board[row][col].isMine = true
	}

	// 确保第一次点击的格子不是地雷，如果是，则移动地雷
	if (board[firstClickRow][firstClickCol].isMine) {
		board[firstClickRow][firstClickCol].isMine = false // 移除第一次点击格子的地雷

		// 找到 shuffled 'cells' 数组中最后一个不是地雷的格子
		for (let i = cells.length - 1; i >= 0; i--) {
			const { row, col } = cells[i]
			if (!board[row][col].isMine) {
				board[row][col].isMine = true // 将地雷放在这里
				break // 移动一个地雷后退出循环
			}
		}
	}

	// 计算相邻地雷数
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++)
			if (!board[i][j].isMine)
				board[i][j].adjacentMines = countAdjacentMines(i, j)
}

/**
 * 计算相邻地雷数
 * @param {number} row 行索引
 * @param {number} col 列索引
 * @returns {number} 相邻地雷数
 */
function countAdjacentMines(row, col) {
	let count = 0
	for (let i = row - 1; i <= row + 1; i++)
		for (let j = col - 1; j <= col + 1; j++)
			if (i >= 0 && i < rows && j >= 0 && j < cols && board[i][j].isMine)
				count++
	return count
}

/**
 * 单元格点击处理函数 (左键)
 * @param {number} row 行索引
 * @param {number} col 列索引
 */
function cellClickHandler(row, col) {
	startGameIfNecessary(row, col) // 启动游戏 (如果尚未启动)

	const cell = board[row][col]
	if (cell.isRevealed || cell.isFlagged || cell.isQuestion)
		return // 已揭开、已标记或问号，不处理


	if (!isMuted) clickSound?.play() // 使用可选链式调用，避免 clickSound 为 null 时报错

	if (cell.isMine) {
		if (!isMuted) explosionSound?.play() // 使用可选链式调用
		endGame(false) // 踩到地雷，游戏结束 (失败)
	} else {
		revealCell(row, col) // 揭开单元格
		if (checkWin())
			endGame(true) // 检查是否胜利
	}
}

/**
 * 单元格右键点击处理函数
 * @param {number} row 行索引
 * @param {number} col 列索引
 * @param {Event} event 事件对象
 */
function cellRightClickHandler(row, col, event) {
	event.preventDefault() // 阻止默认右键菜单
	startGameIfNecessary(row, col) // 启动游戏 (如果尚未启动)

	const cell = board[row][col]
	if (cell.isRevealed)
		return // 已揭开，不处理


	if (!isMuted) clickSound?.play() // 使用可选链式调用

	if (!cell.isFlagged && !cell.isQuestion) {
		cell.isFlagged = true // 标记为旗帜
		flaggedMines++
	} else if (cell.isFlagged) {
		cell.isFlagged = false // 取消旗帜
		cell.isQuestion = true // 标记为问号
		flaggedMines--
	} else
		cell.isQuestion = false // 取消问号


	updateCellDisplay(row, col)
	minesLeftElement.textContent = mines - flaggedMines
}

/**
 * 启动游戏 (如果尚未启动)
 * @param {number} row 第一次点击的行索引
 * @param {number} col 第一次点击的列索引
 */
function startGameIfNecessary(row, col) {
	if (!gameStarted) {
		gameStarted = true
		placeMines(row, col) // 放置地雷
		startTimer() // 启动计时器
		setControlsEnabled(false) // 禁用难度选择等控件
	}
}


/**
 * 揭开单元格 (递归揭开周围空白单元格)
 * @param {number} row 行索引
 * @param {number} col 列索引
 */
function revealCell(row, col) {
	if (row < 0 || row >= rows || col < 0 || col >= cols || board[row][col].isRevealed || board[row][col].isFlagged)
		return // 越界、已揭开或已标记，停止递归

	const cell = board[row][col]
	cell.isRevealed = true
	updateCellDisplay(row, col)

	if (cell.adjacentMines === 0)
		// 递归揭开周围单元格
		for (let i = row - 1; i <= row + 1; i++)
			for (let j = col - 1; j <= col + 1; j++)
				if (!(i === row && j === col))  // 避免重复揭开自身
					revealCell(i, j)
}

/**
 * 检查是否胜利 (所有非地雷单元格都被揭开)
 * @returns {boolean} 是否胜利
 */
function checkWin() {
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++)
			if (!board[i][j].isRevealed && !board[i][j].isMine)
				return false // 还有未揭开的非地雷单元格，未胜利
	return true // 所有非地雷单元格都被揭开，胜利
}

/**
 * 揭示所有地雷 (游戏结束时显示所有地雷)
 */
function revealAllMines() {
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++) {
			const cell = board[i][j]
			cell.isRevealed = true
			updateCellDisplay(i, j)
		}
}

/**
 * 结束游戏
 * @param {boolean} isWin 是否胜利
 */
function endGame(isWin) {
	stopTimer()
	isGameOver = true // 设置游戏结束状态
	revealAllMines() // 显示所有地雷
	messageElement.textContent = geti18n(isWin ? '404.MineSweeper.winMessage' : '404.MineSweeper.loseMessage') // 显示游戏结果消息
	if (isWin) launchConfetti()
	setControlsEnabled(true) // 重新启用控件
	// 禁用所有格子的点击事件
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++)
			boardElement.rows[i].cells[j].style.pointerEvents = 'none'
}

/**
 * 启动计时器
 */
function startTimer() {
	clearInterval(timerInterval)
	seconds = 0
	timerInterval = setInterval(() => {
		seconds++
		timerElement.textContent = seconds
	}, 1000)
}

/**
 * 停止计时器
 */
function stopTimer() {
	clearInterval(timerInterval)
}

/**
 * 重置计时器
 */
function resetTimer() {
	stopTimer()
	seconds = 0
	timerElement.textContent = seconds
}

/**
 * 处理难度选择改变事件
 */
difficultySelect.addEventListener('change', () => {
	customOptions.classList.toggle('hidden', difficultySelect.value !== 'custom') // 切换自定义选项的显示/隐藏
	initGame() // 初始化游戏参数
	startNewGame() // 创建新棋盘
})

/**
 * 设置控件启用状态
 * @param {boolean} enabled 是否启用
 */
function setControlsEnabled(enabled) {
	difficultySelect.disabled = !enabled
	customRowsInput.disabled = !enabled
	customColsInput.disabled = !enabled
	customMinesInput.disabled = !enabled

	const classMethod = enabled ? 'remove' : 'add'
	difficultySelect.classList[classMethod]('disabled')
	customRowsInput.classList[classMethod]('disabled')
	customColsInput.classList[classMethod]('disabled')
	customMinesInput.classList[classMethod]('disabled')
}

/**
 * 处理声音开关点击事件
 */
soundToggle.addEventListener('click', () => {
	isMuted = !isMuted
	soundToggle.textContent = isMuted ? '🔇' : '🔊'
	soundToggle.setAttribute('aria-label', isMuted ? geti18n('404.MineSweeper.soundOff') : geti18n('404.MineSweeper.soundOn')) // Accessibility
})
soundToggle.setAttribute('aria-label', geti18n('404.MineSweeper.soundOff')) // Default accessibility label

/**
 * 更新自定义设置 (行数、列数、地雷数) - 合并了 updateRowsCols 和 updateMines 的逻辑
 */
function updateCustomSettings() {
	if (difficultySelect.value !== 'custom') return

	rows = parseInt(customRowsInput.value, 10) || rows
	cols = parseInt(customColsInput.value, 10) || cols

	customRowsInput.value = rows
	customColsInput.value = cols

	let newMines = parseInt(customMinesInput.value, 10)
	const maxMines = rows * cols - 1

	if (isNaN(newMines) || newMines < 1)
		newMines = Math.floor(rows * cols * DEFAULT_MINE_RATIO)

	newMines = Math.max(1, Math.min(maxMines, newMines))

	customMinesInput.value = newMines
	mines = newMines
	minesLeftElement.textContent = mines - flaggedMines
}


customRowsInput.addEventListener('input', () => {
	updateCustomSettings() // 更新自定义设置
	startNewGame() // 创建新棋盘
})

customColsInput.addEventListener('input', () => {
	updateCustomSettings() // 更新自定义设置
	startNewGame() // 创建新棋盘
})

customMinesInput.addEventListener('input', () => {
	updateCustomSettings() // 更新自定义设置
	startNewGame() // 创建新棋盘
})

/**
 * 处理重新开始按钮点击事件
 */
restartButton.addEventListener('click', () => {
	initGame()  // 初始化游戏设置
	startNewGame() // 开始新游戏（创建棋盘等）
})

/**
 * 开始新游戏 (重置游戏状态并创建新棋盘)
 */
function startNewGame() {
	flaggedMines = 0
	minesLeftElement.textContent = mines - flaggedMines
	resetTimer()
	createBoard()
	gameStarted = false
	isGameOver = false // 重置游戏结束状态
	messageElement.textContent = ''
	setControlsEnabled(true)

	// 重新启用所有格子的点击事件 (游戏结束后需要重新启用)
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++)
			if (boardElement.rows[i] && boardElement.rows[i].cells[j])
				boardElement.rows[i].cells[j].style.pointerEvents = '' // Or 'auto'
}

// 页面加载完成时初始化游戏
initGame()
startNewGame()
