//! JSON-backed clip store. Small enough to be auditable, durable enough for a
//! single creator's workflow.

use pulsecut_core::edl::EditDecisionList;
use pulsecut_core::error::{PulseError, Result};
use pulsecut_core::model::{ClipPackage, ClipStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Default, Serialize, Deserialize)]
struct DiskState {
    clips: HashMap<String, ClipPackage>,
    edls: HashMap<String, EditDecisionList>,
}

#[derive(Debug)]
pub struct Store {
    pub dir: PathBuf,
    state: DiskState,
}

impl Store {
    pub fn open(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("editor-state.json");
        let state = if path.exists() {
            let text = std::fs::read_to_string(&path)?;
            serde_json::from_str(&text).unwrap_or_default()
        } else {
            DiskState::default()
        };
        Ok(Self { dir, state })
    }

    fn flush(&self) -> Result<()> {
        let text = serde_json::to_string_pretty(&self.state)?;
        let tmp = self.dir.join("editor-state.json.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, self.dir.join("editor-state.json"))?;
        Ok(())
    }

    pub fn upsert(&mut self, clip: ClipPackage) -> Result<()> {
        self.state.clips.insert(clip.id.clone(), clip);
        self.flush()
    }

    pub fn get(&self, id: &str) -> Option<&ClipPackage> { self.state.clips.get(id) }

    pub fn list(&self) -> Vec<&ClipPackage> {
        let mut v: Vec<_> = self.state.clips.values().collect();
        v.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        v
    }

    pub fn edl(&self, id: &str) -> EditDecisionList {
        self.state.edls.get(id).cloned().unwrap_or_else(|| EditDecisionList::new(id))
    }

    pub fn append_edits(&mut self, id: &str, ops: Vec<pulsecut_core::edl::EditOp>) -> Result<EditDecisionList> {
        if !self.state.clips.contains_key(id) {
            return Err(PulseError::Editor(format!("clip {id} not found")));
        }
        let edl = self.state.edls.entry(id.to_string()).or_insert_with(|| EditDecisionList::new(id));
        for op in ops {
            edl.push(op);
        }
        let out = edl.clone();
        self.flush()?;
        Ok(out)
    }

    pub fn set_status(&mut self, id: &str, status: ClipStatus) -> Result<()> {
        let clip = self.state.clips.get_mut(id)
            .ok_or_else(|| PulseError::Editor(format!("clip {id} not found")))?;
        clip.status = status;
        self.flush()
    }

    pub fn approve(&mut self, id: &str) -> Result<()> { self.set_status(id, ClipStatus::Approved) }
    pub fn reject(&mut self, id: &str) -> Result<()> { self.set_status(id, ClipStatus::Rejected) }

    pub fn delete(&mut self, id: &str) -> Result<bool> {
        let removed = self.state.clips.remove(id).is_some();
        self.state.edls.remove(id);
        if removed {
            self.flush()?;
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pulsecut_core::model::{ClipWindow, Platform};

    fn pkg(id: &str) -> ClipPackage {
        ClipPackage {
            id: id.into(), channel: "c".into(), platform: Platform::Kick,
            source_window: ClipWindow { start_ms: 0, end_ms: 30_000, snap_reason: "x".into() },
            video_path: "v.mp4".into(), raw_video_path: "raw.mp4".into(), words: vec![], title: "t".into(), description: "d".into(),
            hashtags: vec![], caption_style: "karaoke".into(), template: "default".into(),
            profiles: vec![], status: ClipStatus::Ready, created_at_ms: 1, confidence: 0.8,
        }
    }

    #[test]
    fn persists_across_reopen() {
        let dir = std::env::temp_dir().join(format!("pulsecut-editor-{}", uuid::Uuid::new_v4()));
        {
            let mut s = Store::open(&dir).unwrap();
            s.upsert(pkg("a")).unwrap();
            s.append_edits("a", vec![pulsecut_core::edl::EditOp::Hook { text: "hi".into(), duration_ms: 1000 }]).unwrap();
        }
        let s = Store::open(&dir).unwrap();
        assert!(s.get("a").is_some());
        assert_eq!(s.edl("a").ops.len(), 1);
        let mut s = s;
        assert!(s.delete("a").unwrap());
        assert!(s.get("a").is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
