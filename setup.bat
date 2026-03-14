@echo off
REM BioMiND — one-time local setup
REM Creates an isolated Python venv, installs deps, and compiles CSS.

echo === BioMiND Setup ===

REM Create venv if it doesn't exist
if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
)

echo Installing Python dependencies...
.venv\Scripts\pip install -q -r requirements.txt

REM Install Node deps for Tailwind CSS compilation
if not exist "node_modules\.bin\tailwindcss" (
    echo Installing Tailwind CSS...
    npm install -D tailwindcss@3 >nul 2>&1
)

echo Compiling CSS...
node_modules\.bin\tailwindcss -i frontend/assets/input.css -o frontend/assets/style.css --minify

REM Copy .env if it doesn't exist
if not exist ".env" (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo.
    echo  IMPORTANT: Edit .env and set your API keys before starting.
    echo  Generate a JWT_SECRET with:
    echo    .venv\Scripts\python -c "import secrets; print(secrets.token_hex(32))"
)

echo.
echo Setup complete. Run start.bat to launch BioMiND.
