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
    def test_shim_returns_exit_2_when_binary_missing(self):
        orig_env = os.environ.get("PULSECUT_AGENT_BIN")
        orig_find = agent.find_binary
        try:
            os.environ.pop("PULSECUT_AGENT_BIN", None)
            agent.find_binary = lambda: None
            self.assertEqual(agent.main(), 2)
        finally:
            agent.find_binary = orig_find
            if orig_env is not None:
                os.environ["PULSECUT_AGENT_BIN"] = orig_env

    def test_shim_finds_explicit_binary_env_override(self):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            fake_bin = tf.name
        orig_env = os.environ.get("PULSECUT_AGENT_BIN")
        try:
            os.environ["PULSECUT_AGENT_BIN"] = fake_bin
            self.assertEqual(agent.find_binary(), fake_bin)
        finally:
            if orig_env is not None:
                os.environ["PULSECUT_AGENT_BIN"] = orig_env
            else:
                os.environ.pop("PULSECUT_AGENT_BIN", None)
            if os.path.exists(fake_bin):
                os.unlink(fake_bin)


if __name__ == "__main__":
    unittest.main()
