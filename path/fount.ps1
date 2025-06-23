# 定义常量和路径
$FOUNT_DIR = Split-Path -Parent $PSScriptRoot

# 记录脚本开始时的错误数量，用于最终判断脚本是否成功执行
$ErrorCount = $Error.Count

# 检测是否为 Windows PowerShell (Desktop Edition)
if ($PSEdition -eq "Desktop") {
	try { $IsWindows = $true } catch {}
}

# Docker 环境检测
$IN_DOCKER = $false # 此处可以根据实际情况（如环境变量）进行更复杂的检测，但当前脚本逻辑中已包含

# 定义安装器数据目录和自动安装标记文件
$INSTALLER_DATA_DIR = Join-Path $FOUNT_DIR "data/installer"
$AUTO_INSTALLED_PWSH_MODULES_FILE = Join-Path $INSTALLER_DATA_DIR "auto_installed_pwsh_modules"
$AUTO_INSTALLED_WINGET_FLAG = Join-Path $INSTALLER_DATA_DIR "auto_installed_winget"
$AUTO_INSTALLED_GIT_FLAG = Join-Path $INSTALLER_DATA_DIR "auto_installed_git"
$AUTO_INSTALLED_BUN_FLAG = Join-Path $INSTALLER_DATA_DIR "auto_installed_bun" # 最终使用 Bun

# 初始化已安装的 PowerShell 模块列表
$auto_installed_pwsh_modules = Get-Content $AUTO_INSTALLED_PWSH_MODULES_FILE -Raw -ErrorAction Ignore
if (!$auto_installed_pwsh_modules) { $auto_installed_pwsh_modules = '' }
$auto_installed_pwsh_modules = $auto_installed_pwsh_modules.Split(';') | Where-Object { $_ }

# 函数: 检查并安装 PowerShell 模块，并记录自动安装的模块
function Test-PWSHModule([string]$ModuleName) {
	if (!(Get-Module $ModuleName -ListAvailable)) {
		$auto_installed_pwsh_modules += $ModuleName
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_pwsh_modules" $($auto_installed_pwsh_modules -join ';')
		Get-PackageProvider -Name "NuGet" -Force | Out-Null
		Install-Module -Name $ModuleName -Scope CurrentUser -Force
	}
	return $true
}


# -- 参数处理逻辑 --

# 处理 'open' 参数：等待服务启动后打开网页
if ($args.Count -gt 0 -and $args[0] -eq 'open') {
	# [合并] 如果在 Docker 容器中，直接执行 fount 并退出，不进行桌面集成操作
	if ($IN_DOCKER) {
		$runargs = $args[1..$args.Count]
		fount @runargs
		exit
	}
	Start-Process 'https://steve02081504.github.io/fount/wait'
	$runargs = $args[1..$args.Count]
	fount @runargs
	exit
}
# 处理 'background' 参数：在后台启动 fount 进程
elseif ($args.Count -gt 0 -and $args[0] -eq 'background') {
	# [合并] 如果在 Docker 容器中，直接执行 fount 并退出
	if ($IN_DOCKER) {
		$runargs = $args[1..$args.Count]
		fount @runargs
		exit
	}
	# 确保 ps12exe 模块已安装，用于将 PowerShell 脚本编译为可执行文件
	Test-PWSHModule ps12exe | Out-Null

	$TempDir = [System.IO.Path]::GetTempPath()
	$exepath = Join-Path $TempDir "fount-background.exe"

	# 如果后台可执行文件不存在，则编译
	if (!(Test-Path $exepath)) {
		Write-Host "Compiling background runner executable..."
		ps12exe -inputFile "$FOUNT_DIR/src/runner/background.ps1" -outputFile $exepath
	}

	# 在后台启动编译后的可执行文件
	$runargs = $args[1..$args.Count]
	Write-Host "Starting fount in background..."
	Start-Process -FilePath $exepath -ArgumentList $runargs -WindowStyle Hidden # 隐藏窗口
	exit
}
# 处理 'protocolhandle' 参数：处理 fount:// 协议链接
elseif ($args.Count -gt 0 -and $args[0] -eq 'protocolhandle') {
	# [合并] 如果在 Docker 容器中，直接执行 fount 并退出
	if ($IN_DOCKER) {
		$runargs = $args[1..$args.Count]
		fount @runargs
		exit
	}
	$protocolUrl = $args[1]
	if (-not $protocolUrl) {
		Write-Error "Error: No URL provided for protocolhandle."
		exit 1
	}

	# 确保 fount-pwsh 模块已安装
	Test-PWSHModule fount-pwsh | Out-Null

	# 编码 URL 参数，防止特殊字符问题，确保传入的 URL 能正确作为查询参数
	$encodedUrl = [uri]::EscapeDataString($protocolUrl)
	$targetUrl = "https://steve02081504.github.io/fount/protocol/?url=$encodedUrl"

	# 启动一个后台 Job，它将等待 fount 服务运行，然后打开目标 URL
	Start-Job -ScriptBlock {
		param ($targetUrl)
		# 内部函数定义，确保在 Job 进程中可用
		function Test-FountRunningInternal {
			try {
				$socket = New-Object System.Net.Sockets.TcpClient
				$socket.Connect("localhost", 16698)
				$stream = $socket.GetStream()
				$writer = New-Object System.IO.StreamWriter($stream)
				$reader = New-Object System.IO.StreamReader($stream)

				$writer.WriteLine('{"type":"ping","data":{}}')
				$writer.Flush()

				$response = $reader.ReadLine()
				$jsonResponse = $response | ConvertFrom-Json
				return ($jsonResponse.status -eq "ok")
			}
			catch {
				return $false
			}
			finally {
				if ($stream) { $stream.Dispose() }
				if ($socket) { $socket.Dispose() }
			}
		}

		$timeout_seconds = 60 # 等待超时时间
		$elapsed_seconds = 0
		$ping_interval = 1    # 每次 ping 间隔

		Write-Host "Fount server not running for protocol handle, waiting... ($elapsed_seconds/$timeout_seconds seconds)"
		while (-not (Test-FountRunningInternal)) {
			Start-Sleep -Seconds $ping_interval
			$elapsed_seconds += $ping_interval
			if ($elapsed_seconds -ge $timeout_seconds) {
				Write-Error "Error: Fount server did not start in time for protocol handle. Aborting."
				exit 1
			}
		}
		Write-Host "Fount server is running for protocol handle."

		Write-Host "Opening fount protocol URL: $targetUrl"
		Start-Process $targetUrl
	} -ArgumentList $targetUrl | Out-Null

	# 将剩余参数传递给 fount 运行
	$runargs = $args[2..$args.Count]
	fount @runargs
	exit
}

# 新建一个背景 job 用于后台更新所需的 PowerShell 模块
Start-Job -ScriptBlock {
	param($FOUNT_DIR_JOB, $INSTALLER_DATA_DIR_JOB, $AUTO_INSTALLED_PWSH_MODULES_FILE_JOB)

	@('ps12exe', 'fount-pwsh') | ForEach-Object {
		# 先获取本地模块的版本号，若是0.0.0则跳过更新（开发版本）
		$localVersion = [System.Version]::new(0, 0, 0)
		Get-Module $_ -ListAvailable | ForEach-Object { if ($_.Version -gt $localVersion) { $localVersion = $_.Version } }
		if ("$localVersion" -eq '0.0.0') { return }
		$latestVersion = (Find-Module $_).Version
		if ("$latestVersion" -ne "$localVersion") {
			# 确保安装器数据目录存在
			New-Item -Path $INSTALLER_DATA_DIR_JOB -ItemType Directory -Force | Out-Null
			# 尝试安装模块
			try {
				Get-PackageProvider -Name "NuGet" -Force | Out-Null
				Install-Module -Name $_ -Scope CurrentUser -Force -ErrorAction Stop
				# 如果安装成功，添加到跟踪列表并保存
				$auto_installed_pwsh_modules_job = Get-Content $AUTO_INSTALLED_PWSH_MODULES_FILE_JOB -Raw -ErrorAction Ignore
				if (!$auto_installed_pwsh_modules_job) { $auto_installed_pwsh_modules_job = '' }
				$auto_installed_pwsh_modules_job = $auto_installed_pwsh_modules_job.Split(';') | Where-Object { $_ }
				if ($auto_installed_pwsh_modules_job -notcontains $_) {
					$auto_installed_pwsh_modules_job += $_
					Set-Content $AUTO_INSTALLED_PWSH_MODULES_FILE_JOB ($auto_installed_pwsh_modules_job -join ';')
				}
			}
			catch {
				Write-Warning "Failed to update PowerShell module '$_': $($_.Exception.Message)"
			}
		}
	}
} -ArgumentList $FOUNT_DIR, $INSTALLER_DATA_DIR, $AUTO_INSTALLED_PWSH_MODULES_FILE | Out-Null # 将所需变量传递给 Job

# 向用户的 $Profile 中注册导入 fount-pwsh 模块
if ($Profile -and (Test-Path $Profile) -and (Get-Module fount-pwsh -ListAvailable)) {
	$ProfileContent = Get-Content $Profile -Raw -ErrorAction Ignore
	$OriginalProfileContent = $ProfileContent
	# 移除旧的导入语句，防止重复
	$ProfileContent = $ProfileContent -replace "(?m)^\s*Import-Module fount-pwsh\s*`r?`n?", ""
	# 添加新的导入语句
	$ProfileContent += "`nImport-Module fount-pwsh`n"

	# 如果内容有变化，则写入文件
	if ($ProfileContent -ne $OriginalProfileContent) {
		Set-Content -Path $Profile -Value $ProfileContent
	}
}


if (!$IsWindows) {
	function install_package {
		param(
			[string]$CommandName,
			[string[]]$PackageNames
		)
		if ((Get-Command -Name $CommandName -ErrorAction Ignore)) { return $true }

		$hasSudo = (Get-Command -Name "sudo" -ErrorAction Ignore)

		foreach ($package in $PackageNames) {
			if (Get-Command -Name "apt-get" -ErrorAction Ignore) {
				if ($hasSudo) { sudo apt-get update -y > $null; sudo apt-get install -y $package }
				else { apt-get update -y > $null; apt-get install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "pacman" -ErrorAction Ignore) {
				if ($hasSudo) { sudo pacman -Syy --noconfirm > $null; sudo pacman -S --needed --noconfirm $package }
				else { pacman -Syy --noconfirm > $null; pacman -S --needed --noconfirm $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "dnf" -ErrorAction Ignore) {
				if ($hasSudo) { sudo dnf install -y $package } else { dnf install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "yum" -ErrorAction Ignore) {
				if ($hasSudo) { sudo yum install -y $package } else { yum install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "zypper" -ErrorAction Ignore) {
				if ($hasSudo) { sudo zypper install -y --no-confirm $package } else { zypper install -y --no-confirm $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "apk" -ErrorAction Ignore) {
				if ($hasSudo) { sudo apk add --update $package } else { apk add --update $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "brew" -ErrorAction Ignore) {
				if (-not (brew list --formula $package -ErrorAction Ignore)) {
					brew install $package
				}
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "pkg" -ErrorAction Ignore) {
				if ($hasSudo) { sudo pkg install -y $package } else { pkg install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "snap" -ErrorAction Ignore) {
				if ($hasSudo) { sudo snap install $package } else { snap install $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
		}

		if (Get-Command -Name $CommandName -ErrorAction Ignore) {
			$currentPackages = $env:FOUNT_AUTO_INSTALLED_PACKAGES -split ';' | Where-Object { $_ }
			if ($package -notin $currentPackages) {
				$env:FOUNT_AUTO_INSTALLED_PACKAGES = ($currentPackages + $package) -join ';'
			}
			return $true
		}
		else {
			Write-Error "Error: $package installation failed."
			return $false
		}
	}
	install_package "bash" @("bash", "gnu-bash")
	bash $FOUNT_DIR/path/fount.sh @args
	exit $LastExitCode
}

# Git 安装和更新
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
	Write-Host "Git is not installed, attempting to install..."
	# 尝试安装 winget (Windows Package Manager)
	if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
		Write-Host "Winget not found, attempting to install..."
		try {
			Import-Module Appx
			Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe -ErrorAction Stop
			New-Item -Path $INSTALLER_DATA_DIR -ItemType Directory -Force | Out-Null
			Set-Content $AUTO_INSTALLED_WINGET_FLAG '1' # 标记为自动安装
			Write-Host "Winget installed."
		}
		catch {
			Write-Warning "Failed to install Winget: $($_.Exception.Message)"
		}
	}
    # [合并] 刷新PATH环境变量，以确保刚安装的winget可以被找到
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

	# 如果 winget 可用，则使用它安装 Git
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		Write-Host "Installing Git via Winget..."
		try {
			winget install --id Git.Git -e --source winget -ErrorAction Stop
			New-Item -Path $INSTALLER_DATA_DIR -ItemType Directory -Force | Out-Null
			Set-Content $AUTO_INSTALLED_GIT_FLAG '1' # 标记为自动安装
			Write-Host "Git installed via Winget."
		}
		catch {
			Write-Warning "Failed to install Git via Winget: $($_.Exception.Message)"
		}
	}
    # [合并] 添加winget安装失败时的错误提示
	else {
		Write-Host "Failed to install Git because Winget is failed to install, please install it manually."
	}

	# 刷新 PATH 环境变量，确保新安装的 Git 可用
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

	# 最终检查 Git 是否安装成功
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host "Failed to install Git, please install it manually."
	}
}

# 函数: 升级 fount 仓库
function fount_upgrade {
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host "Git is not installed, skipping fount update."
		return
	}

	# 如果 .git 目录不存在，则克隆仓库
	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Write-Host "Fount repository not found, cloning..."
		Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force -ErrorAction SilentlyContinue
		New-Item -ItemType Directory -Path "$FOUNT_DIR/.git-clone" | Out-Null
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1 --single-branch
		if ($LastExitCode) {
			Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force
			Write-Host "Failed to clone fount repository, skipping update"
			return
		}
		Move-Item -Path "$FOUNT_DIR/.git-clone/.git" -Destination "$FOUNT_DIR/.git"
		Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" clean -fd
		git -C "$FOUNT_DIR" reset --hard "origin/master"
		git -C "$FOUNT_DIR" checkout master
	}
	else {
		# 仓库存在：更新逻辑
		if (!(Test-Path -Path "$FOUNT_DIR/.git")) { # 再次检查仓库是否存在
			Write-Host "Repository not found at $FOUNT_DIR/.git, skipping git pull."
		}
		else {
			# 获取最新更改
			git -C "$FOUNT_DIR" fetch origin

			# 获取当前分支名称
			$currentBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD

			# 处理分离的 HEAD (与 PowerShell 脚本类似)
			if ($currentBranch -eq 'HEAD') {
				Write-Host "Not on a branch, switching to 'master'..."
				git -C "$FOUNT_DIR" clean -fd
				git -C "$FOUNT_DIR" reset --hard "origin/master"
				git -C "$FOUNT_DIR" checkout master
				$currentBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD # 重新读取
			}

			# 获取上游分支 (如果有)
			$remoteBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
			# 如果没有上游分支，则设置为 origin/master
			if (-not $remoteBranch) {
				Write-Warning "No upstream branch configured for '$currentBranch'. Setting upstream to 'origin/master'."
				git -C "$FOUNT_DIR" branch --set-upstream-to origin/master "$currentBranch"
				$remoteBranch = "origin/master" # 设置以保持一致性
			}

			# 检查是否有未提交的更改
			$status = git -C "$FOUNT_DIR" status --porcelain
			if ($status) {
				Write-Warning "Working directory is not clean. Stash or commit your changes before updating."
			}

			# 获取合并基础、本地提交和远程提交
			$mergeBase = git -C "$FOUNT_DIR" merge-base $currentBranch $remoteBranch
			$localCommit = git -C "$FOUNT_DIR" rev-parse $currentBranch
			$remoteCommit = git -C "$FOUNT_DIR" rev-parse $remoteBranch

			# 比较提交并相应地更新
			if ($localCommit -ne $remoteCommit) {
				if ($mergeBase -eq $localCommit) {
					Write-Host "Updating from remote repository (fast-forward)..."
					git -C "$FOUNT_DIR" fetch origin
					git -C "$FOUNT_DIR" reset --hard $remoteBranch
				}
				elseif ($mergeBase -eq $remoteCommit) {
					Write-Host "Local branch is ahead of remote. No update needed."
				}
				else {
					Write-Host "Local and remote branches have diverged. Force updating..."
					git -C "$FOUNT_DIR" fetch origin
					git -C "$FOUNT_DIR" reset --hard $remoteBranch
				}
			}
			else {
				Write-Host "Already up to date."
			}
		}
	}
}

# 检查 .noupdate 文件，若存在则跳过 fount 更新
if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
	Write-Host "Skipping fount update due to .noupdate file."
}
else {
	fount_upgrade
}

# [合并] Bun 安装逻辑 (来自 HEAD 分支)
function install_bun() {
	# 若没有 bun 命令但存在 $HOME/.bun/env，则尝试加载该环境文件
	if (!(Get-Command bun -ErrorAction SilentlyContinue) -and (Test-Path "$HOME/.bun/env")) {
		. "$HOME/.bun/env"
	}

	# 如果 bun 命令仍然不存在，则开始安装
	if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
		Write-Host "Bun missing, attempting to install..."
		# 尝试通过官方脚本安装
		try {
			Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression -ErrorAction Stop
			New-Item -Path $INSTALLER_DATA_DIR -ItemType Directory -Force | Out-Null
			Set-Content $AUTO_INSTALLED_BUN_FLAG '1' # 标记为自动安装
			Write-Host "Bun installed via official script."
		}
		catch {
			Write-Warning "Bun installation via official script failed: $($_.Exception.Message). Attempting manual installation to fount's path folder..."
			# 官方脚本安装失败，尝试手动下载并解压到 fount 的 path 目录
			# 检测操作系统和架构来确定下载链接
			$url = "https://github.com/oven-sh/bun/releases/latest/download/bun-" + $(if ($IsWindows) {
				"windows-x64-baseline.zip"
			} elseif ($IsMacOS) {
				if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
					"darwin-aarch64.zip"
				}
				else {
					"darwin-x64.zip"
				}
			} else { # Linux
				if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
					"linux-aarch64.zip"
				}
				else {
					"linux-x64-baseline.zip"
				}
			})

			try {
				Invoke-WebRequest -Uri $url -OutFile "$env:TEMP/bun.zip" -ErrorAction Stop
				Expand-Archive -Path "$env:TEMP/bun.zip" -DestinationPath "$FOUNT_DIR/path" -Force -ErrorAction Stop
				Remove-Item -Path "$env:TEMP/bun.zip" -Force -ErrorAction SilentlyContinue
				New-Item -Path $INSTALLER_DATA_DIR -ItemType Directory -Force | Out-Null
				Set-Content $AUTO_INSTALLED_BUN_FLAG '1' # 标记为自动安装
				Write-Host "Bun manually installed to $FOUNT_DIR/path."
			}
			catch {
				Write-Error "Bun manual installation failed: $($_.Exception.Message)"
			}
		}

		# 刷新 PATH 环境变量，确保新安装的 Bun 可用
		$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

		# 最终检查 Bun 是否安装成功
		if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
			Write-Error "Bun missing, you cannot run fount without bun."
			exit 1
		}
	}
}
install_bun

# 函数: 升级 Bun
function bun_upgrade() {
	$bun_ver = bun --revision
	if (!$bun_ver) {
		Write-Host "Could not determine current Bun version, attempting upgrade anyway..."
		bun upgrade
		$bun_ver = bun --revision
	}

	if (!$bun_ver) {
		Write-Error "For some reason Bun doesn't work, you may need to join https://discord.com/invite/CXdq2DP29u to get support." -ErrorAction Ignore
		return # 无法确定版本或升级失败，直接返回
	}

	$bun_update_channel = ""
	if ($bun_ver.Contains("+")) {
		$bun_update_channel = "--canary"
	}

	Write-Host "Upgrading Bun (current version: $bun_ver)..."
	bun upgrade $bun_update_channel
	$upgrade_exit_code = $LASTEXITCODE

	$bun_version_after = bun --revision

	if ($upgrade_exit_code -ne 0 -or ($bun_version_after -eq $bun_ver)) {
		Write-Warning "Bun upgrade may have failed or no new version was found. Current version: $bun_version_after"
	} else {
		Write-Host "Bun upgraded successfully to version: $bun_version_after"
	}
}

# 如果不在 Docker 环境，则升级 Bun
if ($IN_DOCKER) {
	Write-Host "Skipping Bun upgrade in Docker environment."
}
else {
	bun_upgrade
}

# 输出 Bun 版本信息
"Bun " + (bun --revision)

# 函数: 判断当前用户是否为 Root/Administrator
function isRoot {
	if ($IsWindows) {
		([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
	}
	else {
		# 对于非 Windows 系统，检查 UID 是否为 0
		$UID -eq 0
	}
}

# 函数: 运行 fount 应用程序
function run {
	if ($IsWindows) {
		Get-Process tray_windows_release -ErrorAction Ignore | Where-Object { $_.CPU -gt 0.5 } | Stop-Process
	}
	if (isRoot) {
		Write-Warning "Not Recommended: Running fount as root grants full system access for all fount parts."
		Write-Warning "Unless you know what you are doing, it is recommended to run fount as a common user."
	}

	# 根据参数判断是否以调试模式运行
	if ($args.Count -gt 0 -and $args[0] -eq 'debug') {
		$newargs = $args[1..$args.Count]
		bun run --inspect-brk --config="$FOUNT_DIR/bunfig.toml" --install=force --prefer-latest "$FOUNT_DIR/src/server/index.mjs" @newargs
	}
	else {
		bun run --config="$FOUNT_DIR/bunfig.toml" --install=force --prefer-latest "$FOUNT_DIR/src/server/index.mjs" @args
	}
}

# 安装 fount 依赖 (首次运行或使用 'init' 参数时)
if (!(Test-Path -Path "$FOUNT_DIR/data") -or ($args.Count -gt 0 -and $args[0] -eq 'init')) {
	Write-Host "Installing Fount dependencies..."

	run shutdown

	Write-Host "======================================================" -ForegroundColor Green
	Write-Warning "DO NOT install any untrusted fount parts on your system, they can do ANYTHING."
	Write-Host "======================================================" -ForegroundColor Green
	# 生成 桌面快捷方式 和 Start Menu 快捷方式
	$shell = New-Object -ComObject WScript.Shell

	$shortcutTargetPath = "powershell.exe"
	$shortcutArguments = "-noprofile -nologo -ExecutionPolicy Bypass -File `"$FOUNT_DIR\path\fount.ps1`" open keepalive"
	# 如果 Windows Terminal 存在，则优先使用它
	if (Test-Path "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe") {
		$shortcutTargetPath = "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe"
		$shortcutArguments = "-p fount powershell.exe $shortcutArguments" # 在已有参数前添加 -p fount
	}
	$shortcutIconLocation = "$FOUNT_DIR\src\public\favicon.ico"

	# 创建桌面快捷方式
	$desktopPath = [Environment]::GetFolderPath("Desktop")
	$desktopShortcut = $shell.CreateShortcut("$desktopPath\fount.lnk")
	$desktopShortcut.TargetPath = $shortcutTargetPath
	$desktopShortcut.Arguments = $shortcutArguments
	$desktopShortcut.IconLocation = $shortcutIconLocation
	$desktopShortcut.Save()
	Write-Host "Desktop shortcut created at $desktopPath\fount.lnk"

	# 创建开始菜单快捷方式
	$startMenuPath = [Environment]::GetFolderPath("StartMenu")
	$startMenuShortcut = $shell.CreateShortcut("$startMenuPath\fount.lnk")
	$startMenuShortcut.TargetPath = $shortcutTargetPath
	$startMenuShortcut.Arguments = $shortcutArguments
	$startMenuShortcut.IconLocation = $shortcutIconLocation
	$startMenuShortcut.Save()
	Write-Host "Start Menu shortcut created at $startMenuPath\fount.lnk"

	# fount 协议注册
	$protocolName = "fount"
	$protocolDescription = "URL:fount Protocol"
	# 使用 fount.bat 作为协议处理程序，因为它是Windows上的主入口点
	$command = "`"$FOUNT_DIR\path\fount.bat`" protocolhandle `"%1`""
	try {
		# 创建注册表项
		New-Item -Path "HKCU:\Software\Classes\$protocolName" -Force | Out-Null
		# 设置协议根键
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "(Default)" -Value $protocolDescription -ErrorAction Stop
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "URL Protocol" -Value "" -ErrorAction Stop
		# 创建 shell\open\command 子键
		New-Item -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Force | Out-Null
		# 设置协议处理命令
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Name "(Default)" -Value $command -ErrorAction Stop
	}
	catch {
		Write-Warning "Failed to register fount:// protocol handler: $($_.Exception.Message)"
	}

	# fount Terminal配置文件注册
	$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
	if (!(Test-Path $WTjsonDirPath)) {
		New-Item -ItemType Directory -Force -Path $WTjsonDirPath | Out-Null
	}
	$WTjsonPath = "$WTjsonDirPath/fount.json"
	$jsonContent = [ordered]@{
		'$help'   = "https://aka.ms/terminal-documentation"
		'$schema' = "https://aka.ms/terminal-profiles-schema"
		profiles  = @(
			[ordered]@{
				name              = "fount"
				commandline       = "fount.bat keepalive"
				startingDirectory = $FOUNT_DIR
				icon              = Join-Path $FOUNT_DIR src/public/favicon.ico
			}
		)
	} | ConvertTo-Json -Depth 100 -Compress
	if ($jsonContent -ne (Get-Content $WTjsonPath -Raw -ErrorAction Ignore)) {
		Set-Content -Path $WTjsonPath -Value $jsonContent
	}
}

# 主要参数处理逻辑
if ($args.Count -gt 0) {
	switch ($args[0]) {
		'geneexe' {
			$exepath = $args[1]
			if (!$exepath) { $exepath = "fount.exe" }

			# 确保 ps12exe 模块已安装
			Test-PWSHModule ps12exe | Out-Null

			Write-Host "Generating executable at $exepath..."
			ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $exepath
			exit $LASTEXITCODE
		}
		'init' {
			# 'init' 参数已在上面的依赖安装部分处理，这里直接退出即可
			exit 0
		}
		'keepalive' {
			$runargs = $args[1..$args.Count]
			run @runargs
			# 如果 fount 退出码不为 0 (表示出错或需要重启)，则循环
			while ($LASTEXITCODE -ne 0) {
				Write-Host "Fount exited with an error, attempting to upgrade and restart..."
				bun_upgrade
				fount_upgrade
				run @runargs
			}
		}
		# [合并] 使用 HEAD 分支更完整的卸载逻辑
		'remove' {
			Write-Host "Initiating fount uninstallation..."
			run shutdown # 尝试关闭 fount 进程

			# 1. 移除 fount PATH 条目
			Write-Host "Removing fount PATH entries from environment variables..."
			$fountPathEntry = "$FOUNT_DIR\path"
			$bunPathEntry = "$HOME\.bun\bin" # Bun 的默认安装路径

			# 从当前会话的 PATH 中移除
			$currentPath = $env:PATH -split ';'
			$currentPath = $currentPath | Where-Object { $_ -ne $fountPathEntry -and $_ -notmatch [regex]::Escape($bunPathEntry) }
			$env:Path = $currentPath -join ';'

			# 从用户环境变量的 PATH 中移除
			$userPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
			$userPathArray = $userPath -split ';'
			$userPathArray = $userPathArray | Where-Object { $_ -ne $fountPathEntry -and $_ -notmatch [regex]::Escape($bunPathEntry) }
			[System.Environment]::SetEnvironmentVariable('PATH', ($userPathArray -join ';'), [System.EnvironmentVariableTarget]::User)
			Write-Host "Fount and Bun paths removed from PATH."

			# 2. 移除 fount-pwsh 模块的 PowerShell Profile 导入
			Write-Host "Removing fount-pwsh from PowerShell Profile..."
			if (Test-Path $Profile) {
				$ProfileContent = Get-Content $Profile -Raw -ErrorAction Ignore
				# 使用正则表达式匹配并移除导入语句，包括可能的换行符
				$ProfileContent = $ProfileContent -replace "`n?Import-Module fount-pwsh`n?", "`n"
				# 移除可能产生的多余空行
				$ProfileContent = $ProfileContent -replace "`n{2,}", "`n"
				# 确保文件以换行符结尾
				if ($ProfileContent -notmatch "`n$") { $ProfileContent += "`n" }

				Set-Content -Path $Profile -Value $ProfileContent
				Write-Host "fount-pwsh removed from PowerShell Profile."
			}
			else {
				Write-Host "PowerShell Profile not found, skipping fount-pwsh removal from profile."
			}

			# 3. 卸载 fount-pwsh 模块
			Write-Host "Uninstalling fount-pwsh PowerShell module..."
			try { Uninstall-Module -Name fount-pwsh -Scope CurrentUser -Force -ErrorAction Stop } catch { Write-Warning "Failed to uninstall fount-pwsh: $($_.Exception.Message)" }

			# 4. 移除 fount 协议处理程序 (Windows Registry)
			if (-not $IN_DOCKER) {
				Write-Host "Removing fount:// protocol handler from registry..."
				try {
					Remove-Item -Path "HKCU:\Software\Classes\fount" -Recurse -Force -ErrorAction SilentlyContinue
					Write-Host "fount:// protocol handler removed."
				}
				catch {
					Write-Warning "Failed to remove fount:// protocol handler: $($_.Exception.Message)"
				}
			}

			# 5. 移除 Windows Terminal Profile
			Write-Host "Removing Windows Terminal Profile..."
			$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
			if (Test-Path $WTjsonDirPath -PathType Container) {
				Remove-Item -Path $WTjsonDirPath -Force -Recurse -ErrorAction SilentlyContinue
				Write-Host "Windows Terminal Profile directory removed."
			}
			else {
				Write-Host "Windows Terminal Profile directory not found."
			}

			# 6. 移除桌面快捷方式和开始菜单快捷方式
			Write-Host "Removing Desktop and Start Menu Shortcuts..."
			$desktopShortcutPath = [Environment]::GetFolderPath("Desktop") + "\fount.lnk"
			if (Test-Path $desktopShortcutPath) {
				Remove-Item -Path $desktopShortcutPath -Force -ErrorAction SilentlyContinue
				Write-Host "Desktop Shortcut removed."
			}
			else {
				Write-Host "Desktop Shortcut not found."
			}
			$startMenuShortcutPath = [Environment]::GetFolderPath("StartMenu") + "\fount.lnk"
			if (Test-Path $startMenuShortcutPath) {
				Remove-Item -Path $startMenuShortcutPath -Force -ErrorAction SilentlyContinue
				Write-Host "Start Menu Shortcut removed."
			}
			else {
				Write-Host "Start Menu Shortcut not found."
			}

			# 7. 卸载自动安装的 PowerShell 模块
			Write-Host "Uninstalling automatically installed PowerShell modules..."
			# 重新加载列表以确保最新状态
			$auto_installed_pwsh_modules = Get-Content $AUTO_INSTALLED_PWSH_MODULES_FILE -Raw -ErrorAction Ignore
			if (!$auto_installed_pwsh_modules) { $auto_installed_pwsh_modules = '' }
			$auto_installed_pwsh_modules = $auto_installed_pwsh_modules.Split(';') | Where-Object { $_ }

			$auto_installed_pwsh_modules | ForEach-Object {
				try {
					if (Get-Module $_ -ListAvailable) {
						Uninstall-Module -Name $_ -Scope CurrentUser -Force -ErrorAction Stop
						Write-Host "$_ removed."
					}
				}
				catch {
					Write-Warning "Failed to remove PowerShell module '$_': $($_.Exception.Message)"
				}
			}
			Remove-Item $AUTO_INSTALLED_PWSH_MODULES_FILE -ErrorAction SilentlyContinue

			# 8. 卸载 Git (如果自动安装)
			if (Test-Path $AUTO_INSTALLED_GIT_FLAG) {
				Write-Host "Uninstalling Git (if auto-installed)..."
				if (Get-Command winget -ErrorAction SilentlyContinue) {
					try {
						winget uninstall --id Git.Git -e --source winget -ErrorAction Stop
						Write-Host "Git uninstalled via Winget."
					}
					catch {
						Write-Warning "Failed to uninstall Git via Winget: $($_.Exception.Message)"
					}
				} else {
					Write-Warning "Winget not found, cannot automatically uninstall Git."
				}
				Remove-Item $AUTO_INSTALLED_GIT_FLAG -ErrorAction SilentlyContinue
			}

			# 9. 卸载 Winget (如果自动安装)
			if (Test-Path $AUTO_INSTALLED_WINGET_FLAG) {
				Write-Host "Uninstalling Winget (if auto-installed)..."
				try {
					Import-Module Appx -ErrorAction SilentlyContinue
					Get-AppxPackage -Name Microsoft.DesktopAppInstaller | Remove-AppxPackage -ErrorAction Stop
					Write-Host "Winget uninstalled."
				}
				catch {
					Write-Warning "Failed to uninstall Winget: $($_.Exception.Message)"
				}
				Remove-Item $AUTO_INSTALLED_WINGET_FLAG -ErrorAction SilentlyContinue
			}

			# 10. 卸载 Bun (如果自动安装)
			if (Test-Path $AUTO_INSTALLED_BUN_FLAG) {
				Write-Host "Uninstalling Bun (if auto-installed)..."
				# 移除 Bun 的安装目录
				if (Test-Path "$HOME/.bun" -PathType Container) {
					Remove-Item "$HOME/.bun" -Recurse -Force -ErrorAction SilentlyContinue
					Write-Host "Bun installation directory $HOME/.bun removed."
				}
				# 移除 fount/path 下的 Bun 可执行文件 (如果手动安装到那里)
				if (Test-Path "$FOUNT_DIR/path/bun.exe") {
					Remove-Item "$FOUNT_DIR/path/bun.exe" -Force -ErrorAction SilentlyContinue
					Write-Host "Bun executable removed from $FOUNT_DIR/path."
				}
				Remove-Item $AUTO_INSTALLED_BUN_FLAG -ErrorAction SilentlyContinue
			}

			# Remove background runner
			$TempDir = [System.IO.Path]::GetTempPath()
			$exepath = Join-Path $TempDir "fount-background.exe"
			if (Test-Path $exepath) {
				Write-Host "Removing background runner..."
				try { Remove-Item $exepath -Force -ErrorAction Stop } catch {}
			}

			# 11. 移除 fount 安装目录
			Write-Host "Removing fount installation directory: $FOUNT_DIR"
			Remove-Item -Path $FOUNT_DIR -Recurse -Force -ErrorAction
			# 只要父目录为空，继续删他妈的
			$parent = Split-Path -Parent $FOUNT_DIR
			while ((Get-ChildItem $parent -ErrorAction Ignore | Measure-Object).Count -eq 0) {
				Remove-Item -Path $parent -Recurse -Force -ErrorAction SilentlyContinue
			}
			Write-Host "Fount installation directory removed."

			Write-Host "Fount uninstallation complete."
			exit 0
		}
		default {
			# 默认运行 fount
			run @args
		}
	}
}
else {
	# 没有参数时默认运行 fount
	run @args
}

# 检查脚本执行过程中是否有新的错误产生
if ($ErrorCount -ne $Error.Count) { exit 1 }
exit $LASTEXITCODE
