//! Non-destructive after-clip editor.
//!
//! The editor stores clips and edit decision lists as JSON. It never rewrites
//! an exported MP4 in place: every change is an appended operation that the
//! render crate re-evaluates. This makes undo trivial and keeps the original
//! capture available forever.

pub mod job;
pub mod store;

pub use job::{Job, JobStatus, JobStore};
pub use store::Store;
