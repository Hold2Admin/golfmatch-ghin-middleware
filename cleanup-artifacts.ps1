# Quick cleanup script for GitHub Actions artifacts
# Loads CLEANUP_TOKEN from Key Vault and deletes all artifacts across repos

param(
    [int]$Keep = 0
)

pwsh -NoProfile -ExecutionPolicy Bypass -Command `
    "..\golf-match-local-cache\Admin_Scripts\Get-GitHubCleanupToken.ps1 -UseAzCli; Write-Host 'Token ready. Running cleanup...'; & ..\golf-match-local-cache\Admin_Scripts\Cleanup-AllRepoArtifacts.ps1 -Keep $Keep"
