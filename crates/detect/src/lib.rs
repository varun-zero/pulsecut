//! Hype detection from live chat.
//!
//! The naive "messages > baseline * 2.5" rule produces garbage on both quiet
//! and fast chats. `HypeDetector` instead fuses four independent, normalized
//! chat signals plus optional audio energy, gates them with robust statistics,
//! and emits at most one candidate per cooldown window.

pub mod detector;
pub mod stats;

pub use detector::{ChannelState, HypeDetector, SignalSample};
