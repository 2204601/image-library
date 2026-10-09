//! Office documents to PDF on Windows, by Office itself when it is installed
//! (Word, Excel, PowerPoint through COM automation). Windows has nothing
//! else that draws them: its shell thumbnails only read the picture some
//! documents keep inside.
//!
//! Office is driven from a short PowerShell script rather than from Rust:
//! late-bound COM calls are one line each there. One document at a time
//! (preview.rs), each in a fresh, hidden instance where Office allows it:
//!
//! - nothing is saved: documents open read-only, macros disabled, alerts
//!   off; a document asking for a password fails instead of asking
//! - Office is only quit when it has nothing else open (PowerPoint has a
//!   single instance, which may be the user's)
//! - a document that makes Office hang is given up after `TIMEOUT`, and the
//!   Office processes started for automation in the meantime are ended

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Office documents (`files::EXTS`) this can convert.
pub const EXTS: &[&str] = &["doc", "docx", "xls", "xlsx", "ppt", "pptx"];

const TIMEOUT: Duration = Duration::from_secs(90);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug)]
pub enum Error {
    /// The Office app for this type isn't installed, or PowerShell can't
    /// use COM here (restricted language mode). Not worth retrying.
    Unavailable,
    Failed(String),
}

/// Apps found unavailable this session (by `app` name in the script).
static UNAVAILABLE: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());

fn app_of(ext: &str) -> Option<&'static str> {
    match ext {
        "doc" | "docx" => Some("word"),
        "xls" | "xlsx" => Some("excel"),
        "ppt" | "pptx" => Some("powerpoint"),
        _ => None,
    }
}

/// Whether converting `ext` may work (its Office app wasn't found missing).
pub fn may_convert(ext: &str) -> bool {
    app_of(ext).is_some_and(|app| !UNAVAILABLE.lock().unwrap().contains(&app))
}

// Paths come in environment variables, so nothing needs quoting.
// Exit codes: 0 done, 3 the app isn't installed, 4 COM not allowed, 2 failed.
const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { exit 4 }
$kind = $env:IL_APP; $src = $env:IL_SRC; $out = $env:IL_OUT
$progId = @{ word = 'Word.Application'; excel = 'Excel.Application'; powerpoint = 'PowerPoint.Application' }[$kind]
if (-not [type]::GetTypeFromProgID($progId)) { exit 3 }
$wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
$app = $null; $doc = $null; $code = 0
try {
  $app = New-Object -ComObject $progId
  $alerts = $app.DisplayAlerts; $security = $app.AutomationSecurity
  $app.AutomationSecurity = 3
  $m = [Type]::Missing
  switch ($kind) {
    'word' {
      $app.DisplayAlerts = 0
      # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument)
      $doc = $app.Documents.Open($src, $false, $true, $false, 'x')
      $doc.ExportAsFixedFormat($out, 17)
      $doc.Close(0)
    }
    'excel' {
      $app.DisplayAlerts = $false
      # Open(Filename, UpdateLinks, ReadOnly, Format, Password)
      $doc = $app.Workbooks.Open($src, 0, $true, $m, 'x')
      $doc.ExportAsFixedFormat(0, $out)
      $doc.Close($false)
    }
    'powerpoint' {
      $app.DisplayAlerts = 1
      # Open(FileName, ReadOnly, Untitled, WithWindow)
      $doc = $app.Presentations.Open($src, -1, 0, 0)
      $doc.SaveAs($out, 32)
      $doc.Close()
    }
  }
  $doc = $null
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  $code = 2
  if ($doc) { try { $doc.Close(0) } catch {} }
} finally {
  if ($app) {
    try { $app.DisplayAlerts = $alerts; $app.AutomationSecurity = $security } catch {}
    $open = switch ($kind) { 'word' { $app.Documents.Count } 'excel' { $app.Workbooks.Count } 'powerpoint' { $app.Presentations.Count } }
    if ($open -eq 0 -and ($kind -ne 'powerpoint' -or -not $wasRunning)) { try { $app.Quit() } catch {} }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  }
}
exit $code
"#;

// Office started for automation has /Automation -Embedding on its command line.
const CLEANUP: &str = r#"
$since = (Get-Date).AddSeconds(-[int]$env:IL_SECONDS)
Get-CimInstance Win32_Process -Filter "Name='WINWORD.EXE' OR Name='EXCEL.EXE' OR Name='POWERPNT.EXE'" |
  Where-Object { $_.CommandLine -match '[/-](Automation|Embedding)' -and $_.CreationDate -ge $since } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"#;

fn powershell(script: &str) -> Command {
    use base64::Engine;
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"])
        .arg(base64::engine::general_purpose::STANDARD.encode(utf16))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Writes the document at `src` (an Office type) as a PDF to `out`.
pub fn to_pdf(src: &Path, ext: &str, out: &Path) -> Result<(), Error> {
    let app = app_of(ext).ok_or(Error::Unavailable)?;
    if !may_convert(ext) {
        return Err(Error::Unavailable);
    }
    // Office writes next to the result; only a complete PDF gets its name.
    let part = out.with_extension("part.pdf");
    let _ = std::fs::remove_file(&part);
    let start = Instant::now();
    let mut child = powershell(SCRIPT)
        .env("IL_APP", app)
        .env("IL_SRC", src)
        .env("IL_OUT", &part)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::Failed(e.to_string()))?;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < TIMEOUT => std::thread::sleep(Duration::from_millis(100)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                end_hung_office(start.elapsed());
                let _ = std::fs::remove_file(&part);
                return Err(Error::Failed("Office が応答しませんでした".into()));
            }
            Err(e) => return Err(Error::Failed(e.to_string())),
        }
    };
    match status.code() {
        Some(0) if part.is_file() => std::fs::rename(&part, out).map_err(|e| Error::Failed(e.to_string())),
        Some(3) | Some(4) => {
            UNAVAILABLE.lock().unwrap().push(app);
            Err(Error::Unavailable)
        }
        _ => {
            let _ = std::fs::remove_file(&part);
            let mut msg = String::new();
            if let Some(mut e) = child.stderr.take() {
                let mut buf = Vec::new();
                let _ = std::io::Read::read_to_end(&mut e, &mut buf);
                msg = String::from_utf8_lossy(&buf).trim().to_string();
            }
            Err(Error::Failed(msg))
        }
    }
}

/// Ends the Office processes started for automation within `within`.
fn end_hung_office(within: Duration) {
    let _ = powershell(CLEANUP)
        .env("IL_SECONDS", (within.as_secs() + 5).to_string())
        .stderr(Stdio::null())
        .status();
}
