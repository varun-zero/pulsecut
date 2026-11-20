#!/usr/bin/env python3
"""Unit & integration tests for PulseCut's automation controller and verifier."""
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agent  # noqa: E402
import verify_clip  # noqa: E402


class VerifyClipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.mkdtemp(prefix="pulsecut-auto-test-")
        cls.has_ffmpeg = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmpdir, ignore_errors=True)

    def test_faststart_and_100_point_rubric_on_real_mp4(self):
        if not self.has_ffmpeg:
            self.skipTest("ffmpeg/ffprobe not available")
        good = os.path.join(self.tmpdir, "good_short.mp4")
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=10",
                "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.25:duration=10",
                "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "3000k", "-minrate", "2500k",
                "-pix_fmt", "yuv420p",
                "-ac", "2", "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart",
                "-shortest", good,
            ],
            check=True,
        )
        frames = os.path.join(self.tmpdir, "frames_good")
        res = verify_clip.verify_file(good, frames_dir=frames)
        self.assertTrue(res["ok"], f"Expected passing short, got: {res}")
        self.assertEqual(res["vitality_score"], 100)
        self.assertTrue(res["metrics"]["faststart"])
        self.assertGreater(res["metrics"]["mean_volume_db"], -50.0)
        self.assertEqual(len(res["sample_frames"]), 3)

    def test_detects_missing_faststart_and_silent_audio(self):
        if not self.has_ffmpeg:
            self.skipTest("ffmpeg/ffprobe not available")
        bad = os.path.join(self.tmpdir, "bad_short.mp4")
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=5",
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-t", "5",
                "-c:v", "libx264", "-preset", "ultrafast",
                "-c:a", "aac", "-b:a", "96k",
                "-shortest", bad,
            ],
            check=True,
        )
        res = verify_clip.verify_file(bad)
        self.assertFalse(res["ok"])
        self.assertFalse(res["metrics"]["faststart"])
        self.assertLess(res["vitality_score"], 75)
        joined = " | ".join(res["reasons"])
        self.assertIn("faststart", joined)
        self.assertIn("silent", joined)


class AgentControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="pulsecut-agent-test-")
        self.orig_ledger = agent.LEDGER
        self.orig_base = agent.BASE
        agent.LEDGER = os.path.join(self.tmpdir, "ledger.json")

        self.state = {
            "clip": {
                "id": "clip-1",
                "status": "ready",
                "platform": "youtube",
                "channel": "creator",
                "template": "default",
                "title": "Draft",
                "description": "",
                "hashtags": [],
                "confidence": 0.91,
                "video_path": "out/final/clip-1.mp4",
                "source_window": {"start_ms": 0, "end_ms": 22000, "snap_reason": "viral hook"},
                "words": [
                    {"text": "No", "start_ms": 0, "end_ms": 200},
                    {"text": "way", "start_ms": 210, "end_ms": 450},
                    {"text": "that", "start_ms": 460, "end_ms": 700},
                    {"text": "worked!", "start_ms": 710, "end_ms": 1100},
                ],
            },
            "publish_calls": 0,
        }
        state = self.state

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def _send(self, code, obj):
                raw = json.dumps(obj).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                if self.path == "/health":
                    self._send(200, {"ok": True, "clips": 1})
                elif self.path == "/api/clips":
                    self._send(200, {"clips": [state["clip"]]})
                elif self.path == "/api/clips/clip-1":
                    self._send(200, {"clip": state["clip"], "edl": {"ops": []}})
                elif self.path == "/api/jobs":
                    self._send(200, {"jobs": []})
                else:
                    self._send(404, {"error": "not found"})

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                if self.path == "/api/clips/clip-1/verify":
                    self._send(200, {
                        "clip_id": "clip-1",
                        "status": state["clip"]["status"],
                        "ok": True,
                        "vitality_score": 100,
                        "viral_score": 0.91,
                        "viral_reason": "viral hook",
                        "has_transcript": True,
                        "word_count": 4,
                        "reasons": [],
                        "sample_frames": ["/api/qa/clip-1/start.jpg"],
                    })
                elif self.path == "/api/clips/clip-1/metadata":
                    state["clip"]["title"] = body.get("title", state["clip"]["title"])
                    state["clip"]["description"] = body.get("description", "")
                    state["clip"]["hashtags"] = body.get("hashtags", [])
                    self._send(200, {"ok": True, "clip": state["clip"]})
                elif self.path == "/api/clips/clip-1/approve":
                    state["clip"]["status"] = "approved"
                    self._send(200, {"ok": True})
                elif self.path == "/api/clips/clip-1/publish":
                    if state["clip"]["status"] == "published" and not body.get("force"):
                        self._send(409, {"ok": False, "error": "clip is already published"})
                        return
                    if state["clip"]["status"] != "approved" and not body.get("force"):
                        self._send(412, {"ok": False, "error": "clip must be approved"})
                        return
                    state["publish_calls"] += 1
                    state["clip"]["status"] = "published"
                    self._send(200, {
                        "ok": True,
                        "publisher": "woopsocial",
                        "receipts": [{"target": "youtube_shorts", "platform_id": "post-123", "ok": True}],
                    })
                else:
                    self._send(404, {"error": "not found"})

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = self.server.server_address[1]
        agent.BASE = f"http://127.0.0.1:{port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        agent.LEDGER = self.orig_ledger
        agent.BASE = self.orig_base
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_bom_tolerant_ledger_load_and_atomic_save(self):
        with open(agent.LEDGER, "wb") as f:
            f.write(b'\xef\xbb\xbf{"runs": [{"id": "old"}], "verifications": {}, "captions": {}, "publishes": {}}')
        loaded = agent.load_ledger()
        self.assertEqual(len(loaded["runs"]), 1)
        agent.save_ledger(loaded)
        with open(agent.LEDGER, "rb") as f:
            raw = f.read()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), "saved ledger must be BOM-free")

    def test_full_gating_workflow_verify_caption_approve_publish_no_double_post(self):
        # Publish before approval must fail with 412 -> exit code 1.
        self.assertEqual(agent.main(["publish", "clip-1", "--targets", "youtube_shorts"]), 1)
        self.assertEqual(self.state["publish_calls"], 0)

        # Inspect transcript succeeds.
        self.assertEqual(agent.main(["inspect", "clip-1"]), 0)

        # Caption with emoji succeeds.
        self.assertEqual(agent.main([
            "caption", "clip-1",
            "--title", "No way that worked 🔥",
            "--description", "Insane clutch",
            "--hashtags", "shorts,viral",
        ]), 0)
        self.assertEqual(self.state["clip"]["title"], "No way that worked 🔥")

        # Approve then publish succeeds.
        self.assertEqual(agent.main(["approve", "clip-1"]), 0)
        self.assertEqual(agent.main(["publish", "clip-1", "--targets", "youtube_shorts"]), 0)
        self.assertEqual(self.state["publish_calls"], 1)

        # Second publish without --force is blocked with 409 -> exit code 1.
        self.assertEqual(agent.main(["publish", "clip-1", "--targets", "youtube_shorts"]), 1)
        self.assertEqual(self.state["publish_calls"], 1)


if __name__ == "__main__":
    unittest.main()
