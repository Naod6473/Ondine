# Vérifie l'île d'Ondine une fois installée et lancée (workflow « installation »).
#
# Cherche la fenêtre de l'île (titre exact « Ondine », appartenant au processus
# ondine.exe) avec l'API Win32, et vérifie que sa taille n'est PAS restée la
# bande de réveil de 240 × 6 px alors que l'île doit être affichée (réglage
# island.alwaysMini = true : l'île reste en mini, la fenêtre fait la taille du
# panneau, 720 × 320 px logiques). C'était le bug de la 1.0.0-beta.1.
#
# Fait aussi une capture d'écran (dossier $ShotDir), gardée comme artefact.
#
# Code de sortie : 0 = tout va bien, 1 = problème (le message dit lequel).

param(
  [int]$TimeoutSecs = 60,
  [int]$StableSecs = 6,
  [string]$ShotDir = "captures"
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class OndineWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  /// Les fenêtres de premier niveau dont le titre est exactement `title`,
  /// appartenant à l'un des processus `pids`.
  public static IntPtr[] Find(string title, uint[] pids) {
    var found = new List<IntPtr>();
    var wanted = new HashSet<uint>(pids);
    EnumWindows((hwnd, l) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (!wanted.Contains(pid)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(hwnd, sb, sb.Capacity);
      if (sb.ToString() == title) found.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
}
"@

# Coordonnées en vrais pixels, même si l'écran est agrandi (DPI).
[void][OndineWin]::SetProcessDPIAware()

function Get-Island {
  $procs = @(Get-Process -Name ondine -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { return $null }
  $pids = [uint32[]]@($procs | ForEach-Object { [uint32]$_.Id })
  foreach ($h in [OndineWin]::Find("Ondine", $pids)) {
    $r = New-Object OndineWin+RECT
    [void][OndineWin]::GetWindowRect($h, [ref]$r)
    return [pscustomobject]@{
      Handle  = $h
      Visible = [OndineWin]::IsWindowVisible($h)
      X       = $r.Left
      Y       = $r.Top
      Width   = $r.Right - $r.Left
      Height  = $r.Bottom - $r.Top
    }
  }
  return $null
}

function Format-Island($w) {
  if ($null -eq $w) { return "aucune fenêtre « Ondine »" }
  return "{0}×{1} px en ({2}, {3}), visible : {4}" -f $w.Width, $w.Height, $w.X, $w.Y, $w.Visible
}

# La bande de réveil fait 6 px logiques (12 px à 200 %). Le panneau fait 320 px
# logiques de haut : au-delà de 40 px, ce n'est plus la bande.
function Test-IslandOpen($w) {
  return ($null -ne $w) -and $w.Visible -and ($w.Height -ge 40) -and ($w.Width -ge 100)
}

function Save-Shot([string]$name) {
  try {
    Add-Type -AssemblyName System.Drawing, System.Windows.Forms
    New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    # CaptureBlt : sans lui, les fenêtres transparentes (l'île) n'apparaissent pas.
    $op = [System.Drawing.CopyPixelOperation]::SourceCopy -bor [System.Drawing.CopyPixelOperation]::CaptureBlt
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size, $op)
    $file = Join-Path $ShotDir "$name.png"
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "Capture : $file"
  } catch {
    Write-Warning "Capture d'écran impossible : $_"
  }
}

$screen = $null
try {
  Add-Type -AssemblyName System.Windows.Forms
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  Write-Host ("Écran principal : {0}×{1}" -f $screen.Width, $screen.Height)
} catch { }

# 1. Attendre que la fenêtre de l'île existe et soit ouverte (WebView2 met
#    quelques secondes à démarrer la première fois).
$deadline = (Get-Date).AddSeconds($TimeoutSecs)
$w = $null
$last = ""
while ((Get-Date) -lt $deadline) {
  $w = Get-Island
  $now = Format-Island $w
  if ($now -ne $last) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $now); $last = $now }
  if (Test-IslandOpen $w) { break }
  Start-Sleep -Milliseconds 500
}

Save-Shot "1-apres-lancement"

if ($null -eq $w) {
  Write-Host "::error::La fenêtre « Ondine » de l'île n'existe pas après $TimeoutSecs s (Ondine a-t-il démarré ?)."
  exit 1
}
if (-not (Test-IslandOpen $w)) {
  Write-Host "::error::La fenêtre de l'île est restée à $(Format-Island $w) : avec « Toujours en mini », elle devrait faire la taille du panneau (bug de la beta.1 : bande de 240×6)."
  exit 1
}

# 2. Avec « Toujours en mini », l'île ne doit pas se replier ensuite.
Start-Sleep -Seconds $StableSecs
$w2 = Get-Island
Write-Host ("[{0:HH:mm:ss}] après {1} s : {2}" -f (Get-Date), $StableSecs, (Format-Island $w2))
Save-Shot "2-quelques-secondes-apres"
if (-not (Test-IslandOpen $w2)) {
  Write-Host "::error::La fenêtre de l'île s'est refermée en bande ($(Format-Island $w2)) alors que « Toujours en mini » est activé."
  exit 1
}

# 3. Et elle doit être sur l'écran (pas envoyée hors champ).
if ($null -ne $screen) {
  $inside = ($w2.X -lt $screen.Right) -and ($w2.X + $w2.Width -gt $screen.Left) -and ($w2.Y -lt $screen.Bottom) -and ($w2.Y + $w2.Height -gt $screen.Top)
  if (-not $inside) {
    Write-Host "::error::La fenêtre de l'île est hors de l'écran : $(Format-Island $w2)."
    exit 1
  }
}

Write-Host "OK : l'île est ouverte en mini ($(Format-Island $w2))."
exit 0
