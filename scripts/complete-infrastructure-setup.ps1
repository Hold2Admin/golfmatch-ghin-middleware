#!/usr/bin/env pwsh
# Complete Infrastructure Setup - GHIN Middleware
# Waits for Redis, configures App Insights, stores secrets, sets up App Service

$rg = "RG_GolfMatch"
$redis = "golfmatch-redis"
$app = "golfmatch-ghin-middleware"
$kv = "golfmatch-secrets"
$insights = "golfmatch-insights"

Write-Host "=== GHIN Middleware Infrastructure Setup ===" -ForegroundColor Cyan
Write-Host ""

# Wait for Redis
Write-Host "[1/5] Waiting for Redis..." -ForegroundColor Yellow
$i = 0
while ($i -lt 30) {
  $status = az redis show -g $rg -n $redis --query "provisioningState" -o tsv 2>$null
  if ($status -eq "Succeeded") {
    Write-Host "OK - Redis ready" -ForegroundColor Green
    break
  }
  Write-Host "  Still creating... ($status)"
  Start-Sleep -Seconds 10
  $i++
}

if ($i -eq 30) {
  Write-Host "ERROR - Redis timeout" -ForegroundColor Red
  exit 1
}

# Get Redis key
$redisKey = az redis list-keys -g $rg -n $redis --query "primaryKey" -o tsv
$redisHost = az redis show -g $rg -n $redis --query "hostName" -o tsv
$redisConn = "$redisHost`:6380?ssl=true&password=$redisKey"

# Store in Key Vault
Write-Host ""
Write-Host "[2/5] Storing secrets in Key Vault..." -ForegroundColor Yellow
az keyvault secret set --vault-name $kv -n "REDIS-CONNECTION-STRING" --value $redisConn 2>&1 | Out-Null
az keyvault secret set --vault-name $kv -n "GHIN-MIDDLEWARE-API-KEY" --value "$((-join ((65..90)+(97..122)+(48..57)|Get-Random -Count 32|%{[char]$_})))" 2>&1 | Out-Null
Write-Host "OK - Secrets stored" -ForegroundColor Green

# Create App Insights
Write-Host ""
Write-Host "[3/5] Creating Application Insights..." -ForegroundColor Yellow
az monitor app-insights component create --app $insights -g $rg --location westus2 --application-type web 2>&1 | Out-Null
$insKey = az monitor app-insights component show --app $insights -g $rg --query "instrumentationKey" -o tsv
az keyvault secret set --vault-name $kv -n "APPINSIGHTS-INSTRUMENTATIONKEY" --value $insKey 2>&1 | Out-Null
Write-Host "OK - App Insights configured" -ForegroundColor Green

# Configure App Service
Write-Host ""
Write-Host "[4/5] Configuring App Service..." -ForegroundColor Yellow
$kvRef1 = "@Microsoft.KeyVault(VaultName=$kv;SecretName=REDIS-CONNECTION-STRING)"
$kvRef2 = "@Microsoft.KeyVault(VaultName=$kv;SecretName=GHIN-MIDDLEWARE-API-KEY)"
$kvRef3 = "@Microsoft.KeyVault(VaultName=$kv;SecretName=APPINSIGHTS-INSTRUMENTATIONKEY)"

az webapp config appsettings set -g $rg -n $app --settings `
  "REDIS_CONNECTION_STRING=$kvRef1" `
  "GHIN_MIDDLEWARE_API_KEY=$kvRef2" `
  "APPINSIGHTS_INSTRUMENTATIONKEY=$kvRef3" `
  "APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=$insKey" `
  "WEBSITE_RUN_FROM_PACKAGE=1" 2>&1 | Out-Null
Write-Host "OK - Settings configured" -ForegroundColor Green

# Enable HTTPS
Write-Host ""
Write-Host "[5/5] Enabling HTTPS-only..." -ForegroundColor Yellow
az webapp update -g $rg -n $app --https-only true 2>&1 | Out-Null
Write-Host "OK - HTTPS enabled" -ForegroundColor Green

Write-Host ""
Write-Host "=== Complete ===" -ForegroundColor Green
Write-Host "Redis, App Insights, and secrets configured."
Write-Host ""
