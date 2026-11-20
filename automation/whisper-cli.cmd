@echo off
REM whisper.cpp-compatible shim backed by faster-whisper.
if defined PULSECUT_PYTHON (
    "%PULSECUT_PYTHON%" "%~dp0whisper_cli.py" %*
    exit /b %ERRORLEVEL%
)
where python >nul 2>nul
if %ERRORLEVEL%==0 (
    python "%~dp0whisper_cli.py" %*
    exit /b %ERRORLEVEL%
)
where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py -3 "%~dp0whisper_cli.py" %*
    exit /b %ERRORLEVEL%
)
if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "%~dp0whisper_cli.py" %*
    exit /b %ERRORLEVEL%
)
echo whisper-cli.cmd: Python 3 not found. Set PULSECUT_PYTHON or add python to PATH. 1>&2
exit /b 127
