# 包管理器共享函数：状态目录、归属检测、按管理器文件锁、数据库刷新节流、管理器安装/升级。

function script:Get-FountPkgStateDir {
	if ($env:FOUNT_PKG_STATE_DIR) { return $env:FOUNT_PKG_STATE_DIR }
	$base = if ($env:TMPDIR) { $env:TMPDIR } elseif ($env:TEMP) { $env:TEMP } else { '/tmp' }
	return (Join-Path $base (Join-Path 'fount' 'package'))
}

function script:Get-FountPkgRefreshInterval {
	if ($env:FOUNT_PKG_REFRESH_INTERVAL) { return [long]$env:FOUNT_PKG_REFRESH_INTERVAL }
	return 600
}

# 解析符号链接得到真实路径（无 Get-Item 失败时原样返回）。
function script:Resolve-FountRealPath([string]$Path) {
	if (-not $Path) { return $null }
	$item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
	if (-not $item) { return $Path }
	try {
		$target = $item.ResolveLinkTarget($true)
		if ($target) { return $target.FullName }
	}
	catch {}
	return $item.FullName
}

# 检测可执行文件路径归属哪个包管理器。返回 @{Manager;Package} 或 $null。
function script:Get-FountPkgOwner([string]$Path) {
	if (-not $Path) { return $null }
	if (Get-Command dpkg -ErrorAction SilentlyContinue) {
		$out = (& dpkg -S $Path 2>$null | Out-String).Trim()
		if ($LASTEXITCODE -eq 0 -and $out) {
			return [pscustomobject]@{ Manager = 'apt-get'; Package = ($out -split ':')[0].Trim() }
		}
	}
	if (Get-Command pacman -ErrorAction SilentlyContinue) {
		$pkg = (& pacman -Qqo -- $Path 2>$null | Out-String).Trim()
		if ($LASTEXITCODE -eq 0 -and $pkg) {
			return [pscustomobject]@{ Manager = 'pacman'; Package = $pkg }
		}
	}
	if (Get-Command rpm -ErrorAction SilentlyContinue) {
		$pkg = ((& rpm -qf $Path 2>$null | Out-String) -split '\r?\n')[0].Trim()
		if ($LASTEXITCODE -eq 0 -and $pkg) {
			$manager = @('dnf', 'yum', 'zypper') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
			if ($manager) { return [pscustomobject]@{ Manager = $manager; Package = $pkg } }
		}
	}
	if (Get-Command apk -ErrorAction SilentlyContinue) {
		$out = (& apk info -W $Path 2>$null | Out-String).Trim()
		if ($LASTEXITCODE -eq 0 -and $out -match 'owned by\s+(.+)$') {
			return [pscustomobject]@{ Manager = 'apk'; Package = $Matches[1].Trim() }
		}
	}
	if (Get-Command brew -ErrorAction SilentlyContinue) {
		$prefix = (& brew --prefix 2>$null | Out-String).Trim().TrimEnd('\', '/')
		if (-not $prefix) { $prefix = '/usr/local' }
		$cellar = "$prefix/Cellar"
		if ($Path.StartsWith("$cellar/", [StringComparison]::Ordinal)) {
			$pkg = $Path.Substring($cellar.Length + 1).Split('/')[0]
			return [pscustomobject]@{ Manager = 'brew'; Package = $pkg }
		}
	}
	if (Get-Command pkg -ErrorAction SilentlyContinue) {
		$out = (& pkg which -q -- $Path 2>$null | Out-String).Trim()
		if ($LASTEXITCODE -eq 0 -and $out) {
			return [pscustomobject]@{ Manager = 'pkg'; Package = $out }
		}
	}
	if (Get-Command snap -ErrorAction SilentlyContinue) {
		foreach ($base in @('/snap/', '/var/lib/snapd/snap/')) {
			if ($Path.StartsWith($base, [StringComparison]::Ordinal)) {
				$pkg = $Path.Substring($base.Length).Split('/')[0]
				return [pscustomobject]@{ Manager = 'snap'; Package = $pkg }
			}
		}
	}
	return $null
}

# 当前进程是否需要 sudo 前缀。
function script:Test-FountNeedSudo {
	if (-not (Get-Command sudo -ErrorAction SilentlyContinue)) { return $false }
	if ($IsWindows) { return $false }
	$uid = (& id -u 2>$null | Out-String).Trim()
	return ($uid -ne '0')
}

# 按包管理器名加锁：同一时刻只有一个同名包管理器在运行。返回布尔。
function script:Enter-FountPkgLock([string]$Manager) {
	$stateDir = Get-FountPkgStateDir
	New-Item -Path $stateDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
	$lockDir = Join-Path $stateDir "$Manager.lock"
	$pidFile = Join-Path $lockDir 'pid'
	$timeoutMs = if ($env:FOUNT_PKG_LOCK_TIMEOUT) { [int]$env:FOUNT_PKG_LOCK_TIMEOUT * 1000 } else { 300000 }
	$sw = [System.Diagnostics.Stopwatch]::StartNew()
	while ($true) {
		try {
			New-Item -Path $lockDir -ItemType Directory -ErrorAction Stop | Out-Null
			Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii
			$script:FountPkgLockDir = $lockDir
			return $true
		}
		catch {
			if (Test-Path -LiteralPath $pidFile) {
				$heldPid = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
				if ($heldPid -and -not (Get-Process -Id $heldPid -ErrorAction SilentlyContinue)) {
					Remove-Item -LiteralPath $lockDir -Force -Recurse -ErrorAction SilentlyContinue
					continue
				}
			}
			if ($sw.ElapsedMilliseconds -ge $timeoutMs) { return $false }
			Start-Sleep -Milliseconds 100
		}
	}
}

function script:Exit-FountPkgLock {
	if ($script:FountPkgLockDir) {
		Remove-Item -LiteralPath $script:FountPkgLockDir -Force -Recurse -ErrorAction SilentlyContinue
		$script:FountPkgLockDir = $null
	}
}

# 数据库刷新节流：>10min 或从未刷新才返回 $true。
function script:Test-FountPkgRefreshNeeded([string]$Manager) {
	$file = Join-Path (Get-FountPkgStateDir) "$Manager.refresh"
	if (-not (Test-Path -LiteralPath $file)) { return $true }
	$last = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
	$last = if ($last) { try { [long]$last.Trim() } catch { 0 } } else { 0 }
	return (([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $last) -ge (Get-FountPkgRefreshInterval))
}

function script:Set-FountPkgRefresh([string]$Manager) {
	$stateDir = Get-FountPkgStateDir
	New-Item -Path $stateDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
	Set-Content -LiteralPath (Join-Path $stateDir "$Manager.refresh") -Value ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Encoding ascii
}

# 按管理器安装包；刷新受节流控制，整段在锁内。返回 $LASTEXITCODE。
function script:Invoke-FountManagerInstall([string]$ManagerCmd, [string]$Package) {
	$argsTable = @{
		'apt-get' = @{ Update = @('update', '-y'); Run = @('install', '-y') }
		'pacman'  = @{ Update = @('-Syy', '--noconfirm'); Run = @('-S', '--needed', '--noconfirm') }
		'dnf'     = @{ Update = @('makecache'); Run = @('install', '-y') }
		'yum'     = @{ Update = @('makecache', 'fast'); Run = @('install', '-y') }
		'zypper'  = @{ Update = @('refresh'); Run = @('install', '-y', '--no-confirm') }
		'pkg'     = @{ Update = @('update', '-y'); Run = @('install', '-y') }
		'apk'     = @{ Run = @('add', '--update') }
		'brew'    = @{ Run = @('install') }
		'snap'    = @{ Run = @('install') }
	}[$ManagerCmd]
	return (Invoke-FountManagerCommand $ManagerCmd $argsTable $Package)
}

# 按管理器升级包；刷新受节流控制，整段在锁内。返回 $LASTEXITCODE。
function script:Invoke-FountManagerUpgrade([string]$ManagerCmd, [string]$Package) {
	$argsTable = @{
		'apt-get' = @{ Update = @('update', '-y'); Run = @('install', '--only-upgrade', '-y') }
		'pacman'  = @{ Update = @('-Sy', '--noconfirm'); Run = @('-S', '--noconfirm') }
		'dnf'     = @{ Update = @('makecache'); Run = @('update', '-y') }
		'yum'     = @{ Update = @('makecache', 'fast'); Run = @('update', '-y') }
		'zypper'  = @{ Update = @('refresh'); Run = @('update', '-y', '--no-confirm') }
		'pkg'     = @{ Update = @('update', '-y'); Run = @('upgrade', '-y') }
		'apk'     = @{ Update = @('update'); Run = @('upgrade') }
		'brew'    = @{ Run = @('upgrade') }
		'snap'    = @{ Run = @('refresh') }
	}[$ManagerCmd]
	return (Invoke-FountManagerCommand $ManagerCmd $argsTable $Package)
}

function script:Invoke-FountManagerCommand([string]$ManagerCmd, $ArgsTable, [string]$Package) {
	if (-not $ArgsTable) { return 1 }
	if (-not (Get-Command -Name $ManagerCmd -ErrorAction SilentlyContinue)) { return 1 }
	$needsSudo = (Test-FountNeedSudo) -and $ManagerCmd -ne 'brew'
	if ($ManagerCmd -eq 'snap' -and -not (Get-Command sudo -ErrorAction SilentlyContinue)) { return 1 }
	if (-not (Enter-FountPkgLock $ManagerCmd)) { return 1 }
	try {
		if ($ArgsTable.ContainsKey('Update') -and (Test-FountPkgRefreshNeeded $ManagerCmd)) {
			if ($needsSudo) { & sudo $ManagerCmd @($ArgsTable.Update) 2>$null | Out-Null } else { & $ManagerCmd @($ArgsTable.Update) 2>$null | Out-Null }
			if ($LASTEXITCODE -eq 0) { Set-FountPkgRefresh $ManagerCmd }
		}
		if ($needsSudo) { & sudo $ManagerCmd @($ArgsTable.Run) $Package 2>$null | Out-Null } else { & $ManagerCmd @($ArgsTable.Run) $Package 2>$null | Out-Null }
		return $LASTEXITCODE
	}
	finally {
		Exit-FountPkgLock
	}
}
