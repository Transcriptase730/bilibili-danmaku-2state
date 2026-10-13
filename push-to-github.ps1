# 推送到 GitHub 辅助脚本
#
# 用法（在 VS Code 终端里，先 cd 到本目录）：
#   pwsh -File .\push-to-github.ps1 -RepoUrl https://github.com/<你的ID>/bilibili-danmaku-2state.git
#
# 作用：初始化仓库 -> 首次提交 -> 关联远端 -> 推送到 main
# 需要先把仓库在 GitHub 上建好（空仓库，不要勾选 README/LICENSE，否则会冲突）

param(
  [Parameter(Mandatory = $true)][string]$RepoUrl,
  [string]$Branch = "main",
  [string]$Message = "feat: 干掉 B 站弹幕开关的精简弹幕中间态",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Run([string]$cmd) {
  Write-Host "> $cmd" -ForegroundColor Cyan
  Invoke-Expression $cmd
  if ($LASTEXITCODE -ne 0) { throw "命令失败：$cmd" }
}

if (-not (Test-Path ".git")) {
  Run "git init -b $Branch"
} else {
  Write-Host "已存在 .git，跳过 init" -ForegroundColor Yellow
}

Run "git add -A"

# 首次提交：没有 HEAD 时才提交
git rev-parse --verify HEAD *> $null
if ($LASTEXITCODE -ne 0) {
  Run "git commit -m `"$Message`""
} else {
  Write-Host "已有提交历史，按需自行 git commit" -ForegroundColor Yellow
}

$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existing)) {
  Run "git remote add origin $RepoUrl"
} else {
  Write-Host "origin 已存在：$existing，改为更新地址" -ForegroundColor Yellow
  Run "git remote set-url origin $RepoUrl"
}

$pushArgs = ""
if ($Force) { $pushArgs = " --force-with-lease" }
Run "git push -u origin $Branch$pushArgs"

Write-Host ""
Write-Host "完成。仓库地址：$RepoUrl" -ForegroundColor Green
Write-Host "VS Code 里再改动力码后：源代码管理面板输入信息 -> 提交 -> 同步即可。" -ForegroundColor Green
