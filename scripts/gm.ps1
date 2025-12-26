<#!
Helper functions for quick testing of the GHIN middleware without re-typing the API key.
Usage in PowerShell:
  # One-time per session: load the functions
  . .\scripts\gm.ps1

  # Set API key once (fetch from Key Vault)
  Set-GmKey

  # Call endpoints
  gmx "/api/v1/health" -Pretty
  gmx "/api/v1/players/1234567" -Pretty
  gmx "/api/v1/courses/GHIN-54321" -Pretty

  # Local testing
  gmx-local "/api/v1/health" -Pretty

You can add `. .\scripts\gm.ps1` to your PowerShell profile for auto-load.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Set-GmKey {
  <#
  Fetch API key from Azure Key Vault and store in GHIN_MW_API_KEY env var.
  Requires: az login with access to vault 'golfmatch-secrets'.
  #>
  try {
    $key = az keyvault secret show --vault-name golfmatch-secrets --name GHIN-MIDDLEWARE-API-KEY --query value -o tsv
    if (-not $key) { throw 'KeyVault returned empty key' }
    $env:GHIN_MW_API_KEY = $key
    Write-Host 'GHIN_MW_API_KEY set for this session.'
  }
  catch {
    throw "Failed to retrieve API key from Key Vault: $($_.Exception.Message)"
  }
}

function gmx {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [ValidateSet('GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS')]
    [string]$Method = 'GET',
    [string]$Body,
    [switch]$Pretty,
    [string]$Base = 'https://golfmatch-ghin-middleware.azurewebsites.net'
  )
  if (-not $env:GHIN_MW_API_KEY) {
    Write-Host 'GHIN_MW_API_KEY is not set. Running Set-GmKey to fetch from Key Vault...'
    Set-GmKey
  }

  $uri = if ($Path -like 'http*') { $Path } else { "$Base$Path" }
  $headers = @{ 'X-API-Key' = $env:GHIN_MW_API_KEY }

  try {
    if ($PSBoundParameters.ContainsKey('Body')) {
      $resp = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $Body -ContentType 'application/json'
    } else {
      $resp = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
    }
    if ($Pretty) {
      $resp | ConvertTo-Json -Depth 10
    } else {
      $resp
    }
  }
  catch {
    if ($_.Exception.Response) {
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errBody = $reader.ReadToEnd()
        if ($Pretty) {
          try { ($errBody | ConvertFrom-Json) | ConvertTo-Json -Depth 10 } catch { $errBody }
        } else {
          $errBody
        }
      } catch { Write-Error $_ }
    } else {
      Write-Error $_
    }
  }
}

function gm-local {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [ValidateSet('GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS')]
    [string]$Method = 'GET',
    [string]$Body,
    [switch]$Pretty
  )
  gmx -Path $Path -Method $Method -Body $Body -Pretty:$Pretty -Base 'http://localhost:5001'
}

# ---------------------------------------------
# Mock DB convenience helpers (no args to remember)
# ---------------------------------------------

function GmMock-ShowCourse {
  param(
    [Parameter(Mandatory=$true)][string]$CourseId
  )
  Push-Location $PSScriptRoot\..
  try {
    node scripts/mockdb-helper.js show-course --courseId $CourseId
  } finally {
    Pop-Location
  }
}

function GmMock-UpdateTee {
  param(
    [Parameter(Mandatory=$true)][string]$TeeId,
    [double]$CourseRating,
    [int]$Slope,
    [int]$Par,
    [int]$Yardage
  )
  $argsList = @('scripts/mockdb-helper.js','update-tee','--teeId', $TeeId)
  if ($PSBoundParameters.ContainsKey('CourseRating')) { $argsList += @('--courseRating', $CourseRating) }
  if ($PSBoundParameters.ContainsKey('Slope')) { $argsList += @('--slope', $Slope) }
  if ($PSBoundParameters.ContainsKey('Par')) { $argsList += @('--par', $Par) }
  if ($PSBoundParameters.ContainsKey('Yardage')) { $argsList += @('--yardage', $Yardage) }
  if ($argsList.Count -le 4) { throw 'Provide at least one of: -CourseRating, -Slope, -Par, -Yardage' }
  Push-Location $PSScriptRoot\..
  try {
    node @argsList
  } finally {
    Pop-Location
  }
}

function GmMock-UpdateHole {
  param(
    [Parameter(Mandatory=$true)][string]$TeeId,
    [Parameter(Mandatory=$true)][int]$Hole,
    [int]$Par,
    [int]$Handicap,
    [int]$Yardage
  )
  $argsList = @('scripts/mockdb-helper.js','update-hole','--teeId',$TeeId,'--hole',$Hole)
  if ($PSBoundParameters.ContainsKey('Par')) { $argsList += @('--par',$Par) }
  if ($PSBoundParameters.ContainsKey('Handicap')) { $argsList += @('--handicap',$Handicap) }
  if ($PSBoundParameters.ContainsKey('Yardage')) { $argsList += @('--yardage',$Yardage) }
  if ($argsList.Count -le 6) { throw 'Provide at least one of: -Par, -Handicap, -Yardage' }
  Push-Location $PSScriptRoot\..
  try {
    node @argsList
  } finally {
    Pop-Location
  }
}

function GmMock-AddCourse {
  param(
    [Parameter(Mandatory=$true)][string]$File
  )
  if (-not (Test-Path $File)) { throw "File not found: $File" }
  Push-Location $PSScriptRoot\..
  try {
    node scripts/mockdb-helper.js add-course --file $File
  } finally {
    Pop-Location
  }
}

function GmMock-AddRedRocks {
  <#
  Inserts the Red Rocks test course (GHIN-99999).
  Note: Will fail if GHIN-99999 already exists (primary key).
  #>
  Push-Location $PSScriptRoot\..
  try {
    node scripts/run-ghin-updates.js db-schema/ghin-mock/005_seed_red_rocks.sql
  } finally {
    Pop-Location
  }
}

function GmMock-TestWizard {
  Write-Host '--- GHIN Mock Test Wizard ---'
  Write-Host '1) Show tees for a course'
  Write-Host '2) Update a tee (rating/slope/par/yardage)'
  Write-Host '3) Update a hole baseline'
  Write-Host '4) Bump course timestamp only'
  Write-Host '5) Add course from JSON'
  Write-Host '6) Add Red Rocks test course'
  $choice = Read-Host 'Select (1-6)'
  switch ($choice) {
    '1' {
      $cid = Read-Host 'Enter GHIN courseId (e.g., GHIN-76543)'
      GmMock-ShowCourse -CourseId $cid
    }
    '2' {
      $tid = Read-Host 'Enter GHIN teeId (e.g., GHIN-TEE-3001)'
      $cr = Read-Host 'New CourseRating (blank to skip)'
      $sl = Read-Host 'New Slope (blank to skip)'
      $pr = Read-Host 'New Par (blank to skip)'
      $yd = Read-Host 'New Yardage (blank to skip)'
      $params = @{ TeeId = $tid }
      if ($cr) { $params.CourseRating = [double]$cr }
      if ($sl) { $params.Slope = [int]$sl }
      if ($pr) { $params.Par = [int]$pr }
      if ($yd) { $params.Yardage = [int]$yd }
      GmMock-UpdateTee @params
    }
    '3' {
      $tid = Read-Host 'Enter GHIN teeId'
      $hn = Read-Host 'Hole number (1-18)'
      $pr = Read-Host 'New Par (blank to skip)'
      $hc = Read-Host 'New Handicap (blank to skip)'
      $yd = Read-Host 'New Yardage (blank to skip)'
      $params = @{ TeeId = $tid; Hole = [int]$hn }
      if ($pr) { $params.Par = [int]$pr }
      if ($hc) { $params.Handicap = [int]$hc }
      if ($yd) { $params.Yardage = [int]$yd }
      GmMock-UpdateHole @params
    }
    '4' {
      $cid = Read-Host 'Enter GHIN courseId'
      Push-Location $PSScriptRoot\..
      try { node scripts/mockdb-helper.js bump-course --courseId $cid } finally { Pop-Location }
    }
    '5' {
      $file = Read-Host 'Enter path to course JSON (e.g., .\\JSON\\course-template.json)'
      GmMock-AddCourse -File $file
    }
    '6' {
      GmMock-AddRedRocks
    }
    default { Write-Host 'Cancelled.' }
  }
}
