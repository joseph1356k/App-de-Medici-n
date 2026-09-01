<#
  Instala el Medidor en ESTE PC, sin permisos de administrador.

  Uso (PowerShell, en la carpeta donde está Medidor.exe):
      .\instalar.ps1 -Servidor "https://TU-PROYECTO.vercel.app" -Clave "LA_CLAVE_DE_LA_API"

  Qué hace:
    1. Copia Medidor.exe a %LOCALAPPDATA%\Programs\Medidor\
    2. Escribe %APPDATA%\Medidor\medidor.json con el servidor y la clave
    3. Lo deja arrancando con la sesión de Windows (clave Run de HKCU)
    4. Lo arranca ahora

  Para quitarlo: .\desinstalar.ps1
#>
param(
    [Parameter(Mandatory = $true)] [string] $Servidor,
    [Parameter(Mandatory = $true)] [string] $Clave,
    [string] $Exe = (Join-Path $PSScriptRoot "Medidor.exe")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Exe)) { throw "No encuentro Medidor.exe en $Exe. Pásalo con -Exe o ponlo junto a este script." }
if ($Servidor -notmatch '^https?://') { throw "El servidor debe ser una URL, p. ej. https://medicion.vercel.app" }

$destino = Join-Path $env:LOCALAPPDATA "Programs\Medidor"
$config  = Join-Path $env:APPDATA "Medidor"
New-Item -ItemType Directory -Force -Path $destino, $config | Out-Null

# Si ya está corriendo, se cierra para poder reemplazar el .exe
Get-Process -Name Medidor -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

Copy-Item $Exe (Join-Path $destino "Medidor.exe") -Force

@{ servidor = $Servidor.TrimEnd('/'); clave = $Clave } | ConvertTo-Json | Set-Content -Path (Join-Path $config "medidor.json") -Encoding UTF8

$run = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -Path $run -Name "Medidor" -Value ('"' + (Join-Path $destino "Medidor.exe") + '"') -PropertyType String -Force | Out-Null

Start-Process (Join-Path $destino "Medidor.exe")

Write-Host ""
Write-Host "Medidor instalado en $destino y arrancando con Windows." -ForegroundColor Green
Write-Host "Config: $config\medidor.json · Logs: $env:LOCALAPPDATA\Medidor\logs"
Write-Host "Debe aparecer un circulo en la bandeja (junto al reloj). Ambar = elige tu nombre; verde = midiendo."
