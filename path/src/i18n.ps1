# --- 国际化函数 ---
# 获取系统区域设置
function Get-SystemLocales {
	$locales = New-Object System.Collections.Generic.List[string]
	$locales.Add((Get-Culture).Name)
	if ($env:LANG) { $locales.Add($env:LANG.Split('.')[0].Replace('_', '-')) }
	if ($env:LANGUAGE) { $locales.Add($env:LANGUAGE.Split('.')[0].Replace('_', '-')) }
	if ($env:LC_ALL) { $locales.Add($env:LC_ALL.Split('.')[0].Replace('_', '-')) }
	$locales.Add('en-UK') # 备用
	return $locales | Select-Object -Unique
}

# 从 src/public/locales/list.csv 获取可用区域设置
function Get-AvailableLocales {
	$localeListFile = Join-Path $FOUNT_DIR 'src/public/locales/list.csv'
	if (Test-Path $localeListFile) {
		try {
			return Import-Csv $localeListFile | Select-Object -ExpandProperty lang
		}
		catch {
			return @('en-UK') # 备用
		}
	}
	else {
		return @('en-UK') # 备用
	}
}

# 寻找最合适的区域设置
function Get-BestLocale {
	param(
		[string[]]$preferredLocales,
		[string[]]$availableLocales
	)

	foreach ($preferred in $preferredLocales) {
		if ($availableLocales -contains $preferred) {
			return $preferred
		}
	}

	foreach ($preferred in $preferredLocales) {
		$prefix = $preferred.Split('-')[0]
		foreach ($available in $availableLocales) {
			if ($available.StartsWith($prefix)) {
				return $available
			}
		}
	}

	return 'en-UK' # 默认
}

# 加载本地化数据
function Import-LocaleData {
	if (-not $env:FOUNT_LOCALE) {
		$systemLocales = Get-SystemLocales
		$availableLocales = Get-AvailableLocales
		$env:FOUNT_LOCALE = Get-BestLocale -preferredLocales $systemLocales -availableLocales $availableLocales
	}
	$localeFile = Join-Path $FOUNT_DIR "src/public/locales/$($env:FOUNT_LOCALE).json"
	if (-not (Test-Path $localeFile)) {
		$env:FOUNT_LOCALE = 'en-UK'
		$localeFile = Join-Path $FOUNT_DIR "src/public/locales/en-UK.json"
	}

	try {
		Get-Content $localeFile -Raw -Encoding UTF8 | ConvertFrom-Json
	} catch { $null }
}

# 获取翻译后的字符串
$Script:FountLocaleData = $null
$Script:I18nSupportsAnsi = $Host.UI.SupportsVirtualTerminal -and -not [System.Console]::IsOutputRedirected
$Script:I18nParamAnsiColors = @{
	path   = 36
	ref    = 34
	branch = 33
}

function Format-I18nParamValue {
	param(
		[string]$Name,
		[string]$Value
	)
	if (-not $Script:I18nSupportsAnsi) { return $Value }
	if (-not $Script:I18nParamAnsiColors.ContainsKey($Name)) { return $Value }
	$esc = [char]27
	$c = $Script:I18nParamAnsiColors[$Name]
	return "${esc}[${c}m$Value${esc}[0m"
}

function Format-I18nBacktickInner {
	param([string]$Inner)
	if (-not $Script:I18nSupportsAnsi) { return $Inner }
	$esc = [char]27
	$M = "${esc}[35m"; $B = "${esc}[34m"; $Y = "${esc}[33m"; $C = "${esc}[36m"; $R = "${esc}[0m"
	switch -Regex ($Inner) {
		'://' { return "$B$Inner$R" }
		'^(origin|upstream)(/.*)?$' { return "$B$Inner$R" }
		'^(master|main|HEAD|develop)$' { return "$Y$Inner$R" }
		'^\.' { return "$C$Inner$R" }
		'^[A-Z][A-Z0-9_]+$' { return "$C$Inner$R" }
		'^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$' { return "$C$Inner$R" }
		'^(git|fount|deno|winget|pwsh|patchelf|osacompile|lsregister|chmod) (.+)$' { return "$M$($Matches[1])$R $Y$($Matches[2])$R" }
		default { return "$M$Inner$R" }
	}
}

function Format-I18nText {
	param([string]$Text)
	if ($Script:I18nSupportsAnsi) {
		return [regex]::Replace($Text, '`([^`]*)`', {
				param($m)
				Format-I18nBacktickInner $m.Groups[1].Value
			})
	}
	return [regex]::Replace($Text, '`([^`]*)`', '$1')
}

function Get-I18n {
	param(
		[string]$key,
		[hashtable]$params = @{}
	)

	if ($null -eq $Script:FountLocaleData) {
		$Script:FountLocaleData = Import-LocaleData
	}

	$keys = $key.Split('.')
	$translation = $Script:FountLocaleData.fountConsole.path
	foreach ($k in $keys) {
		if ($null -ne $translation -and $translation.PSObject.Properties[$k]) {
			$translation = $translation.$k
		}
		else {
			$translation = $null
			break
		}
	}

	if ($null -eq $translation) {
		$translation = $key # 降级为键本身
	}

	$text = [string]$translation
	foreach ($paramName in $params.Keys) {
		$formatted = Format-I18nParamValue -Name $paramName -Value ([string]$params[$paramName])
		$text = $text.Replace('`${' + $paramName + '}`', $formatted)
		$text = $text.Replace('${' + $paramName + '}', $formatted)
	}
	return Format-I18nText $text
}
