let groups = []

export async function initGroupList() {
	await loadGroups()
	setupEventListeners()
}

async function loadGroups() {
	try {
		const response = await fetch('/api/parts/shells:chat/group/list', {
			credentials: 'include',
		})

		const data = await response.json()
		if (!response.ok || !data.success)
			throw new Error(data.error || 'Failed to load groups')

		groups = Array.isArray(data.groups) ? data.groups : []
		renderGroups()
	} catch (error) {
		console.error('Load groups error:', error)
		showError(`加载群组失败: ${error.message}`)
	}
}

function renderGroups() {
	const container = document.getElementById('groups-list')
	if (!container) return

	if (groups.length === 0) {
		container.innerHTML = `
			<div class="text-center py-8 opacity-50">
				<p>暂无群组</p>
				<button class="btn btn-primary mt-4" id="create-first-group">创建第一个群组</button>
			</div>
		`
		document.getElementById('create-first-group')?.addEventListener('click', showCreateGroupModal)
		return
	}

	container.innerHTML = groups.map(group => `
		<a href="/parts/shells:chat/group.html#${group.groupId}"
		   class="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer">
			<div class="card-body p-4">
				<div class="flex items-center gap-3">
					<div class="avatar placeholder">
						<div class="bg-neutral text-neutral-content rounded-full w-12">
							<span class="text-xl">${escapeHtml(group.name.charAt(0))}</span>
						</div>
					</div>
					<div class="flex-1 min-w-0">
						<h3 class="font-bold truncate">${escapeHtml(group.name)}</h3>
						<p class="text-sm opacity-70 truncate">${escapeHtml(group.desc || '暂无描述')}</p>
						<p class="text-xs opacity-50">${group.memberCount} 个成员</p>
					</div>
				</div>
			</div>
		</a>
	`).join('')
}

function setupEventListeners() {
	document.getElementById('create-group-btn')?.addEventListener('click', showCreateGroupModal)
	document.getElementById('create-dm-btn')?.addEventListener('click', showCreateDmModal)
	document.getElementById('join-group-btn')?.addEventListener('click', showJoinGroupModal)
}

function showJoinGroupModal() {
	const groupId = prompt('请输入群组ID (例如: group_xxxxx):')
	if (groupId && groupId.trim()) {
		window.location.href = `/parts/shells:chat/group.html#${groupId.trim()}`
	}
}

function showCreateGroupModal() {
	const name = prompt('请输入群组名称:')
	if (name) {
		const description = prompt('请输入群组描述（可选）:')
		createGroup(name, description || '')
	}
}

async function createGroup(name, description) {
	try {
		const response = await fetch('/api/parts/shells:chat/group/new', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ name, description }),
		})

		const data = await response.json()
		if (!response.ok || !data.success)
			throw new Error(data.error || 'Failed to create group')

		window.location.href = `/parts/shells:chat/group.html#${data.groupId}`
	} catch (error) {
		console.error('Create group error:', error)
		showError(`创建群组失败: ${error.message}`)
	}
}

function showCreateDmModal() {
	const targetUsername = prompt('请输入要聊天的用户名:')
	if (targetUsername)
		createDm(targetUsername)
}

async function createDm(targetUsername) {
	try {
		const response = await fetch('/api/parts/shells:chat/group/dm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ targetUsername }),
		})

		const data = await response.json()
		if (!response.ok || !data.success)
			throw new Error(data.error || 'Failed to create DM')

		window.location.href = `/parts/shells:chat/group.html#${data.groupId}`
	} catch (error) {
		console.error('Create DM error:', error)
		showError(`创建私聊失败: ${error.message}`)
	}
}

function showError(message) {
	console.error(message)
	const container = document.getElementById('groups-list')
	if (container)
		container.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`
}

function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

if (window.location.pathname.includes('/list'))
	initGroupList()
