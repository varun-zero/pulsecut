//! FFmpeg / streamlink binary discovery and process helpers.
//!
//! Windows installs are messy: ffmpeg can come from PATH, a scoop/choco
//! install, imageio-ffmpeg (Python), or a manually extracted zip. We try all
//! of them so a fresh user does not have to edit a config file.

use pulsecut_core::error::{PulseError, Result};
use std::path::PathBuf;
use std::process::Stdio;

/// Find an executable. `explicit` wins, then `env_var`, then PATH, then known
/// per-OS locations. Returns None if nothing usable is found.
pub fn resolve_binary(explicit: &str, env_var: &str, names: &[&str]) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if !explicit.is_empty() {
        candidates.push(PathBuf::from(explicit));
    }
    if let Ok(v) = std::env::var(env_var) {
        if !v.is_empty() {
            candidates.push(PathBuf::from(v));
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in names {
                let mut p = dir.join(name);
                if cfg!(windows) && p.extension().is_none() {
                    p.set_extension("exe");
                }
                candidates.push(p);
            }
        }
    }
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            for rel in [
                "Programs/imageio-ffmpeg/ffmpeg.exe",
                "imageio/ffmpeg/ffmpeg.exe",
                "Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg/bin/ffmpeg.exe",
            ] {
                candidates.push(local.join(rel));
            }
        }
        if let Some(prog) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(prog).join("ffmpeg/bin/ffmpeg.exe"));
        }
    } else {
        candidates.push(PathBuf::from("/usr/bin/ffmpeg"));
        candidates.push(PathBuf::from("/usr/local/bin/ffmpeg"));
    }

    candidates.into_iter().find(|p| p.is_file())
}

pub fn ffmpeg(explicit: &str) -> Result<PathBuf> {
    resolve_binary(explicit, "PULSECUT_FFMPEG", &["ffmpeg"]).ok_or_else(|| {
        PulseError::Process(
            "ffmpeg not found. Install it or set PULSECUT_FFMPEG to the full path. \
             Quick fix on Windows: winget install Gyan.FFmpeg"
                .into(),
        )
    })
}

pub fn streamlink(explicit: &str) -> Option<PathBuf> {
    resolve_binary(explicit, "PULSECUT_STREAMLINK", &["streamlink"])
}

/// Run a command to completion, capturing stdout/stderr for error messages.
pub async fn run(mut cmd: tokio::process::Command, label: &str) -> Result<String> {
    let output = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| PulseError::Process(format!("failed to start {label}: {e}")))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(PulseError::Process(format!("{label} exited {}: {}", output.status, err.trim())))
    }
}

/// Ask streamlink for the direct HLS URL of a live stream. This avoids piping
/// two processes together and lets ffmpeg seek/cut segments independently.
pub async fn resolve_stream_url(link: &str, streamlink_path: &str) -> Result<String> {
    let bin = streamlink(streamlink_path).ok_or_else(|| {
        PulseError::Process("streamlink not found; pass a direct HLS URL or install streamlink".into())
    })?;
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(["--stream-url", link, "best"]);
    let out = run(cmd, "streamlink --stream-url").await?;
    let url = out.lines().last().unwrap_or("").trim().to_string();
    if !url.starts_with("http") {
        return Err(PulseError::Process(format!("streamlink returned no HTTP stream URL for {link}")));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_respects_explicit_path() {
        let here = std::env::current_dir().unwrap().join("Cargo.toml");
        let found = resolve_binary(here.to_string_lossy().as_ref(), "PULSECUT_TEST_NEVER_SET", &[]);
        assert_eq!(found, Some(here));
    }
}
