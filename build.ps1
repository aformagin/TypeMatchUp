<#
.SYNOPSIS
Build and verify the portable Windows application, including its SQLite catalog.
.DESCRIPTION
Installs locked npm dependencies, regenerates the catalog from SOURCE.json's pinned
revision, validates data and JavaScript, runs isolated integration checks, packages
the app, and verifies the packaged resources. Stops on any failed step.
Requires Node.js/npm, Python 3.9+ (with sqlite3), and network access.
.EXAMPLE
.\build.ps1
.EXAMPLE
.\build.ps1 -SkipInstall
Reuse node_modules; native Electron dependencies are still rebuilt.
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Handle native exit codes consistently in Windows PowerShell 5.1 and PowerShell 7.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Invoke-BuildCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Executable,
        [string[]]$CommandArguments = @()
    )
    Write-Host "`n$Label" -ForegroundColor Cyan
    & $Executable @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed (exit code $LASTEXITCODE)."
    }
}

$projectRoot = $PSScriptRoot
$locationPushed = $false
try {
    if ($env:OS -ne 'Windows_NT') { throw 'This build script targets Windows.' }
    Push-Location -LiteralPath $projectRoot
    $locationPushed = $true
    $buildStarted = [DateTime]::UtcNow

    foreach ($file in @('package.json', 'package-lock.json', 'src/data/SOURCE.json',
        'scripts/build-encounter-catalog.py', 'scripts/verify-encounter-catalog.py',
        'scripts/run-verification.cjs', 'scripts/verify-app.cjs')) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Required build input is missing: $file"
        }
    }
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    # Use npm.cmd to avoid npm.ps1 execution-policy and argument-forwarding issues.
    $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $python = $null
    $pythonPrefix = @()
    foreach ($candidate in @('py.exe', 'python.exe', 'python3.exe')) {
        $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $command) { continue }
        $prefix = @()
        if ($candidate -eq 'py.exe') { $prefix = @('-3') }
        & $command.Source @prefix -c 'import sys, sqlite3; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>$null
        if ($LASTEXITCODE -eq 0) {
            $python = $command.Source
            $pythonPrefix = $prefix
            break
        }
    }
    if ($null -eq $python) { throw 'Install Python 3.9 or newer with sqlite3, available through py -3 or python.' }

    $package = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    $source = Get-Content -LiteralPath 'src/data/SOURCE.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    $revision = [string]$source.revision
    if ($revision -notmatch '^[0-9a-fA-F]{40}$') {
        throw 'src/data/SOURCE.json must contain a pinned 40-character commit SHA.'
    }
    Write-Host "Building Type Match Up $($package.version) from $projectRoot"
    Write-Host "Encounter data revision: $revision"
    Invoke-BuildCommand -Label 'Checking Node.js' -Executable $node -CommandArguments @('--version')
    Invoke-BuildCommand -Label 'Checking npm' -Executable $npm -CommandArguments @('--version')

    if ($SkipInstall) {
        foreach ($dependency in @('node_modules/electron/package.json', 'node_modules/better-sqlite3/package.json',
            'node_modules/electron-builder/package.json')) {
            if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) {
                throw 'Dependencies are missing. Run .\build.ps1 without -SkipInstall first.'
            }
        }
        Invoke-BuildCommand -Label 'Rebuilding native Electron dependencies' -Executable $npm -CommandArguments @('run', 'rebuild:native')
    } else {
        # npm ci uses package-lock.json; postinstall rebuilds better-sqlite3 for Electron.
        Invoke-BuildCommand -Label 'Installing locked dependencies and rebuilding native modules' -Executable $npm -CommandArguments @('ci', '--include=dev')
    }

    Invoke-BuildCommand -Label 'Regenerating the mandatory offline SQLite catalog' -Executable $python `
        -CommandArguments ($pythonPrefix + @('scripts/build-encounter-catalog.py', $revision))
    Invoke-BuildCommand -Label 'Validating catalog integrity, references, rates, and revision' -Executable $python `
        -CommandArguments ($pythonPrefix + @('scripts/verify-encounter-catalog.py', $revision))

    foreach ($javascript in @('src/main.js', 'src/preload.js', 'src/renderer/renderer.js',
        'scripts/run-verification.cjs', 'scripts/verify-app.cjs')) {
        Invoke-BuildCommand -Label "Checking JavaScript syntax: $javascript" -Executable $node -CommandArguments @('--check', $javascript)
    }
    Invoke-BuildCommand -Label 'Running isolated Electron integration checks' -Executable $node -CommandArguments @('scripts/run-verification.cjs')
    Invoke-BuildCommand -Label 'Building the portable Windows executable' -Executable $npm -CommandArguments @('run', 'package:win')
    Invoke-BuildCommand -Label 'Verifying packaged application resources' -Executable $node `
        -CommandArguments @('scripts/run-verification.cjs', '--packaged-resources=portable-dist/win-unpacked/resources')

    $artifactPath = Join-Path $projectRoot "portable-dist/$($package.build.productName) $($package.version).exe"
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Build output is missing: $artifactPath" }
    $artifact = Get-Item -LiteralPath $artifactPath
    if ($artifact.Length -eq 0 -or $artifact.LastWriteTimeUtc -lt $buildStarted.AddSeconds(-2)) {
        throw "The build did not produce a fresh executable: $artifactPath"
    }
    Write-Host "`nBuild and verification succeeded." -ForegroundColor Green
    Write-Host ("Portable app: {0} ({1:N1} MB)" -f $artifact.FullName, ($artifact.Length / 1MB))
} catch {
    Write-Error -Message "Build failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
} finally {
    if ($locationPushed) { Pop-Location }
}
