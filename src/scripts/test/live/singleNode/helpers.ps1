# 单节点 live 探针共用断言与汇总。

function Initialize-SingleNodeChatApi {
	param(
		[string]$Base,
		[string]$Key
	)
	$script:SingleNodeApiBase = $Base.Trim().TrimEnd('/')
	$script:SingleNodeApiKey = $Key.Trim()
}

function Invoke-ChatApi {
	param(
		[string]$Method,
		[string]$Path,
		$Body,
		[int]$TimeoutSec = 60
	)
	if (-not $script:SingleNodeApiBase) { throw 'Initialize-SingleNodeChatApi must be called first' }
	$uri = "$script:SingleNodeApiBase/api/parts/shells:chat$Path"
	if ($uri -match '\?') { $uri += "&fount-apikey=$script:SingleNodeApiKey" } else { $uri += "?fount-apikey=$script:SingleNodeApiKey" }
	$p = @{ Method = $Method; Uri = $uri; UseBasicParsing = $true; TimeoutSec = $TimeoutSec; SkipHttpErrorCheck = $true }
	if ($null -ne $Body) { $p.ContentType = 'application/json'; $p.Body = ($Body | ConvertTo-Json -Depth 16 -Compress) }
	$r = Invoke-WebRequest @p
	$json = $null
	if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch { $json = $r.Content } }
	return [pscustomobject]@{ status = [int]$r.StatusCode; json = $json; raw = $r.Content }
}

function Invoke-ChatApiJson {
	param(
		[string]$Method,
		[string]$Path,
		$Body,
		[int]$TimeoutSec = 90
	)
	$r = Invoke-ChatApi -Method $Method -Path $Path -Body $Body -TimeoutSec $TimeoutSec
	if ($r.status -lt 200 -or $r.status -ge 300) {
		if ($r.raw) { throw "HTTP $($r.status): $($r.raw)" }
		throw "HTTP $($r.status) $Method $Path"
	}
	return $r.json
}

$script:pass = 0; $script:fail = 0; $script:skip = 0
$script:failures = @()

function Test-Case($name, $block) {
	try {
		$ok = & $block
		if ($ok -eq $false) { $script:fail++; $script:failures += $name; Write-Host "  FAIL  $name" -ForegroundColor Red }
		else { $script:pass++; Write-Host "  ok    $name" -ForegroundColor Green }
	}
	catch {
		$script:fail++; $script:failures += "$name :: $($_.Exception.Message)"
		Write-Host "  FAIL  $name :: $($_.Exception.Message)" -ForegroundColor Red
	}
}

function Skip-Case($name, $why) { $script:skip++; Write-Host "  skip  $name ($why)" -ForegroundColor DarkGray }

# 噪声豁免窗口标记须与 src/scripts/test/core/output_filter.mjs 中 token 一致。
$script:NoiseAllowBegin = '@@FOUNT_NOISE_ALLOW_BEGIN@@'
$script:NoiseAllowEnd = '@@FOUNT_NOISE_ALLOW_END@@'

# 关窗前等待跨进程 node stderr 异步到达（与 allowNoise.mjs NOISE_ALLOW_STDERR_DRAIN_MS 一致）。
$script:NoiseAllowStderrDrainMs = 300

function Invoke-WithAllowedNoise {
	param(
		[Parameter(Mandatory)][string[]]$Patterns,
		[Parameter(Mandatory)][scriptblock]$Script,
		[int]$DrainMs = $script:NoiseAllowStderrDrainMs
	)
	foreach ($p in $Patterns) {
		[Console]::Error.WriteLine("$script:NoiseAllowBegin`t$p")
	}
	try {
		return & $Script
	}
	finally {
		if ($DrainMs -gt 0) { Start-Sleep -Milliseconds $DrainMs }
		for ($i = $Patterns.Count - 1; $i -ge 0; $i--) {
			[Console]::Error.WriteLine($script:NoiseAllowEnd)
		}
	}
}

function Write-LiveSection($title) { Write-Host "`n=== $title ===" -ForegroundColor Cyan }

function Write-LiveSummary($tag) {
	Write-Host "`n========================================" -ForegroundColor Cyan
	Write-Host "$tag  PASS=$script:pass  FAIL=$script:fail  SKIP=$script:skip" -ForegroundColor Cyan
	if ($script:failures.Count) {
		Write-Host "FAILURES:" -ForegroundColor Red
		$script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
	}
	Write-Host "========================================" -ForegroundColor Cyan
}

function Complete-LiveScript {
	if ($script:fail -gt 0) { exit 1 }
}
