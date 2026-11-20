#!/usr/bin/env python3
"""Compatibility shim — the automation controller is now Rust.

The real implementation lives in `crates/agent` (binary `pulsecut-agent`),
a full migration of this file. This shim keeps `python automation/agent.py ...`
working (e.g. for the runbook) by locating and exec-ing the Rust binary.

Build once with:  cargo build --release -p pulsecut-agent
"""
import os, subprocess, sys
from pathlib import Path

def find_binary():
    explicit = os.environ.get("PULSECUT_AGENT_BIN")
    if explicit and Path(explicit).is_file():
        return explicit
    # Search upward from this file for target/{release,debug}/pulsecut-agent[.exe]
    here = Path(__file__).resolve()
    for base in [here.parent, *here.parents]:
        for profile in ("release", "debug"):
            cand = base / "target" / profile / ("pulsecut-agent.exe" if os.name == "nt" else "pulsecut-agent")
            if cand.is_file():
                return str(cand)
    return None

def main():
    binary = find_binary()
    if not binary:
        print("pulsecut-agent binary not found. Build it with:\n"
              "  cargo build --release -p pulsecut-agent", file=sys.stderr)
        return 2
    return subprocess.call([binary, *sys.argv[1:]])

if __name__ == "__main__":
    sys.exit(main())
