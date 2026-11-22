#!/usr/bin/env python3
"""
PulseCut Model Context Protocol (MCP) Server.
Enables any MCP-compliant AI agent (Claude Desktop, Cursor, Antigravity, Windsurf)
to inspect clips, query zero-overlap templates, and trigger headless renders over stdio.
"""
import os
import sys
import json
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLI_PATH = os.path.join(ROOT, "scripts", "pulsecut_cli.py")

TOOLS = [
    {
        "name": "pulsecut_health",
        "description": "Check PulseCut engine health, FFmpeg binary availability, footage directory, and registered template count.",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "pulsecut_list_clips",
        "description": "List all video and photo footage assets available in the current project with file size and format.",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "pulsecut_list_templates",
        "description": "List all registered 13 ClipShip 9:16 templates with their exact mathematical cutouts and text zones.",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "pulsecut_render",
        "description": "Execute a headless render of a specified clip using PulseCut's verified FFmpeg pipeline.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "clip": {
                    "type": "string",
                    "description": "Name or identifier of the clip to render (e.g. '01_stapleton-vocal-drop_T03')",
                },
                "template": {
                    "type": "string",
                    "description": "Template folder name (e.g. '03_Tweet_Plus_Reply')",
                },
                "aspect": {
                    "type": "string",
                    "enum": ["9:16", "1:1", "16:9"],
                    "description": "Target aspect ratio (default '9:16')",
                },
            },
        },
    },
]

def run_cli_json(cmd_args):
    """Run pulsecut_cli.py with --json and return parsed dict."""
    cmd = [sys.executable, CLI_PATH] + cmd_args + ["--json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode == 0:
        try:
            return json.loads(proc.stdout)
        except Exception:
            return {"raw_output": proc.stdout}
    return {"error": proc.stderr or f"Command failed with code {proc.returncode}"}

def handle_request(req):
    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                },
                "serverInfo": {
                    "name": "pulsecut-mcp",
                    "version": "0.1.0",
                },
            },
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": TOOLS,
            },
        }

    elif method == "tools/call":
        tool_name = params.get("name")
        args = params.get("arguments", {})

        if tool_name == "pulsecut_health":
            data = run_cli_json(["health"])
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(data, indent=2)}],
                },
            }

        elif tool_name == "pulsecut_list_clips":
            data = run_cli_json(["list-clips"])
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(data, indent=2)}],
                },
            }

        elif tool_name == "pulsecut_list_templates":
            data = run_cli_json(["list-templates"])
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(data, indent=2)}],
                },
            }

        elif tool_name == "pulsecut_render":
            cli_args = ["render"]
            if "clip" in args:
                cli_args += ["--clip", str(args["clip"])]
            if "template" in args:
                cli_args += ["--template", str(args["template"])]
            data = run_cli_json(cli_args)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(data, indent=2)}],
                },
            }

        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {tool_name}"},
            }

    elif method == "notifications/initialized":
        return None

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Unsupported method: {method}"},
        }

def main():
    """Stdio JSON-RPC loop."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            res = handle_request(req)
            if res is not None:
                sys.stdout.write(json.dumps(res) + "\n")
                sys.stdout.flush()
        except Exception as e:
            err_res = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {str(e)}"},
            }
            sys.stdout.write(json.dumps(err_res) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
