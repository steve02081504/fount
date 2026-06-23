# 单节点 live 探针共用断言与汇总。

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
