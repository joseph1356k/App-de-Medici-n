<#
  Quita el Medidor de ESTE PC. Los datos ya subidos al servidor no se tocan.

  EL ORDEN IMPORTA: primero la tarea programada «Medidor-Vigilante» —si no, relanza el medidor a
  mitad de la desinstalación—, luego el proceso, la clave Run y por último las carpetas.
#>
$ErrorActionPreference = "SilentlyContinue"

cmd /c 'schtasks /Delete /TN "Medidor-Vigilante" /F >nul 2>&1'

Get-Process -Name Medidor | Stop-Process -Force
Start-Sleep -Milliseconds 800

Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Medidor"

Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA "Programs\Medidor")
Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA "Medidor")   # spool, logs, latido, relanzos, vigilante.xml
Remove-Item -Recurse -Force (Join-Path $env:APPDATA "Medidor")        # config, identidad y secreto

Write-Host "Medidor desinstalado." -ForegroundColor Green
