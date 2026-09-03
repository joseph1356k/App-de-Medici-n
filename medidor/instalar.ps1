<#
  Instala el Medidor en ESTE PC, sin permisos de administrador.

  Uso (PowerShell, en la carpeta donde está Medidor.exe):
      .\instalar.ps1 -Servidor "https://TU-PROYECTO.vercel.app" -Clave "LA_CLAVE_DE_LA_API"

  Qué hace:
    1. Copia Medidor.exe a %LOCALAPPDATA%\Programs\Medidor\
    2. Escribe %APPDATA%\Medidor\medidor.json con el servidor y la clave
    3. Lo deja arrancando con la sesión de Windows (clave Run de HKCU)
    4. Lo arranca ahora. El propio Medidor.exe registra la tarea programada «Medidor-Vigilante»
       (al iniciar sesión y cada 5 min) que lo repone si se cierra: este script NO crea la tarea,
       el .exe es la única fuente de su definición. Aquí solo se comprueba que quedó.

  El consultorio del PC se asigna desde el panel (Dispositivos), no aquí.
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

# Si ya está corriendo, se cierra para poder reemplazar el .exe. La tarea vigilante (si existe de una
# instalación anterior) puede relanzarlo en el intervalo: por eso se reintenta la copia.
Get-Process -Name Medidor -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

$copiado = $false
for ($intento = 1; $intento -le 3 -and -not $copiado; $intento++) {
    try {
        Copy-Item $Exe (Join-Path $destino "Medidor.exe") -Force
        $copiado = $true
    } catch {
        Get-Process -Name Medidor -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Milliseconds 800
        if ($intento -eq 3) { throw }
    }
}

@{ servidor = $Servidor.TrimEnd('/'); clave = $Clave } | ConvertTo-Json | Set-Content -Path (Join-Path $config "medidor.json") -Encoding UTF8

$run = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -Path $run -Name "Medidor" -Value ('"' + (Join-Path $destino "Medidor.exe") + '"') -PropertyType String -Force | Out-Null

Start-Process (Join-Path $destino "Medidor.exe") -WorkingDirectory $destino

# El .exe registra la tarea al arrancar; se le dan unos segundos y se confirma. Vía cmd para que el
# stderr de schtasks (cuando la tarea no existe) no se convierta en un error de PowerShell.
Start-Sleep -Seconds 5
cmd /c 'schtasks /Query /TN "Medidor-Vigilante" >nul 2>&1'
$vigilante = ($LASTEXITCODE -eq 0)

Write-Host ""
Write-Host "Medidor instalado en $destino y arrancando con Windows." -ForegroundColor Green
if ($vigilante) {
    Write-Host "Vigilante: la tarea programada Medidor-Vigilante quedo registrada (cada 5 min y al iniciar sesion)." -ForegroundColor Green
} else {
    Write-Host "Aviso: la tarea Medidor-Vigilante aun no aparece. Revisa $env:LOCALAPPDATA\Medidor\logs (linea 'instalador')." -ForegroundColor Yellow
    Write-Host "       El medidor igual arranca con la sesion y se relanza solo si colapsa." -ForegroundColor Yellow
}
Write-Host "Config: $config\medidor.json · Logs: $env:LOCALAPPDATA\Medidor\logs"
Write-Host "Debe aparecer un circulo en la bandeja (junto al reloj): verde = midiendo; ambar = sin consultorio asignado (asignalo en el panel); oscuro = sin conexion (guardando en el PC)."
