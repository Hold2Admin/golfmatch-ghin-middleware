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
