@echo off
SETLOCAL EnableDelayedExpansion
TITLE Unity Image Optimizer - Laboratory Launcher

:: UI Colors (Standard CMD colors)
:: 0 = Black, 1 = Blue, 2 = Green, 3 = Aqua, 4 = Red, 5 = Purple, 6 = Yellow, 7 = White, 8 = Gray, 9 = Light Blue
:: A = Light Green, B = Light Aqua, C = Light Red, D = Light Purple, E = Light Yellow, F = Bright White

cls
color 0B
echo.
echo  =======================================================
echo     TESTING LABORATORY: UNITY IMAGE OPTIMIZER
echo  =======================================================
echo.
echo  [SYSTEM] Initializing deployment sequence...

:: 1. Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [ERROR] Node.js is NOT installed on this system.
    echo.
    echo  The "Laboratory" requires Node.js to function. 
    echo  Please download and install it from here:
    echo  --^> https://nodejs.org/
    echo.
    echo  Once installed, please restart this launcher.
    echo  =======================================================
    pause
    exit
)

:: 2. Check for dependencies (node_modules)
if not exist node_modules (
    color 0E
    echo  [STATUS] Dependencies are missing (node_modules).
    set /p choice="  [QUERY] Would you like to install them now? (Y/N): "
    if /I "!choice!"=="Y" (
        echo  [ACTION] Installing tools... this may take a moment...
        call npm install
        if !ERRORLEVEL! neq 0 (
            color 0C
            echo.
            echo  [CRITICAL] Installation failed. Please check your internet.
            pause
            exit
        )
        echo  [SUCCESS] All tools are ready!
    ) else (
        echo  [WARNING] Cannot proceed without dependencies.
        pause
        exit
    )
)

:: 3. Launching
color 0A
echo  [STATUS] All systems nominal.
echo  [ACTION] Launching Experimental Engine...
echo.
echo  =======================================================
echo  Tip: The app will open in your default browser.
echo  =======================================================
echo.

:: Start the dev server
:: Note: npm run dev usually opens the browser if configured in vite, 
:: but we can force it if needed.
npm run dev

pause
