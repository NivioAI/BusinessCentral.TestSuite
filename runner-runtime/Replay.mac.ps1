#!/usr/bin/env pwsh

[CmdletBinding()]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]
    $Tests,

    [Parameter(Mandatory = $true)]
    [string]
    $StartAddress,

    [Parameter()]
    [switch]
    $Headed,

    [Parameter()]
    [switch]
    $UseServerReplay,

    [Parameter()]
    [string]
    $ResultDir,

    [Parameter()]
    [ValidateSet('Windows', 'AAD', 'UserPassword')]
    [string]
    $Authentication = 'Windows',

    [Parameter()]
    [string]
    $UserNameKey,

    [Parameter()]
    [string]
    $PasswordKey,

    [Parameter()]
    [ValidateSet('None', 'TOTP', 'Certificate')]
    [string]
    $MultiFactorType = 'None',

    [Parameter()]
    [string]
    $MultiFactorSecretKey
)

# Microsoft's pinned Replay.ps1 builds bc_player_testDir with a Windows
# separator. PowerShell accepts that path on macOS, while Node's path.normalize
# does not. Intercept only the two npx calls and normalize the environment value
# immediately before Playwright reads it.
function npx {
    param (
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]
        $NpxArguments
    )

    if ($env:bc_player_testDir) {
        $env:bc_player_testDir = $env:bc_player_testDir.Replace('\', '/')
    }

    if ($NpxArguments.Count -eq 2 -and
        $NpxArguments[0] -eq 'playwright' -and
        $NpxArguments[1] -eq 'install') {
        Write-Host 'Checking the Chromium runtime (one-time download if needed)...'
        $NpxArguments += 'chromium'
    }

    if ($env:BCFT_MANUAL_MFA -eq '1' -and
        $NpxArguments.Count -ge 5 -and
        $NpxArguments[0] -eq 'playwright' -and
        $NpxArguments[1] -eq 'test') {
        $NpxArguments[2] = Join-Path $PSScriptRoot 'manual-mfa.spec.cjs'
        $NpxArguments[4] = Join-Path $PSScriptRoot 'manual-mfa.config.cjs'
    }

    $OutputIndex = [Array]::IndexOf($NpxArguments, '--output')
    if ($OutputIndex -ge 0 -and $env:bc_player_resultDir) {
        $NpxArguments[$OutputIndex + 1] = Join-Path $env:bc_player_resultDir 'test-results'
    }

    if (-not $env:BCFT_NODE_EXECUTABLE) {
        throw 'BCFT_NODE_EXECUTABLE is not configured.'
    }

    $PlaywrightCli = Join-Path $PSScriptRoot 'node_modules/playwright/cli.js'
    if (-not (Test-Path $PlaywrightCli)) {
        throw "Playwright CLI was not found at $PlaywrightCli."
    }

    $PreviousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
    $env:ELECTRON_RUN_AS_NODE = '1'
    try {
        & $env:BCFT_NODE_EXECUTABLE $PlaywrightCli @($NpxArguments | Select-Object -Skip 1)
    }
    finally {
        $env:ELECTRON_RUN_AS_NODE = $PreviousElectronRunAsNode
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Playwright exited with code $LASTEXITCODE."
    }
}

$ReplayScript = Join-Path $PSScriptRoot 'node_modules/@microsoft/bc-replay/Replay.ps1'
if (-not (Test-Path $ReplayScript)) {
    throw "Microsoft bc-replay was not found at $ReplayScript."
}

& $ReplayScript @PSBoundParameters
