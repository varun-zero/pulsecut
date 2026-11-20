@echo off
REM whisper.cpp-compatible shim backed by faster-whisper.
python "%~dp0whisper_cli.py" %*
