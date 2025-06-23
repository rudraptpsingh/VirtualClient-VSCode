@echo off
REM Virtual Client Docker Runner

echo Virtual Client VS Code Extension - Docker
echo ==========================================

if "%1"=="build" goto :build
if "%1"=="run" goto :run
if "%1"=="run-with-package" goto :run_with_package
if "%1"=="stop" goto :stop
if "%1"=="logs" goto :logs
if "%1"=="shell" goto :shell
goto :help

:help
echo Usage: %0 [command]
echo.
echo Commands:
echo   build                      Build the container
echo   run                        Run the container
echo   run-with-package ^<path^>    Run with Virtual Client package mounted
echo   stop                       Stop the container
echo   logs                       Show container logs
echo   shell                      Access container shell
echo.
echo Examples:
echo   %0 run-with-package "C:\tools\virtualclient.zip"
echo   %0 run-with-package "D:\packages\vc-package.zip"
echo.
echo After running:
echo   VS Code Web UI: http://localhost:8080
echo   Password: virtualclient123
echo.
exit /b 0

:run_with_package
if "%~2"=="" (
    echo Error: Please specify a package path
    echo Usage: %0 run-with-package "path\to\package.zip"
    echo Example: %0 run-with-package "C:\tools\virtualclient.zip"
    exit /b 1
)

set "package_path=%~2"
if not exist "%package_path%" (
    echo Error: Package file does not exist: "%package_path%"
    exit /b 1
)

echo Starting Virtual Client container with package...
docker stop virtual-client 2>nul
docker rm virtual-client 2>nul

for %%f in ("%package_path%") do set "package_name=%%~nxf"
set "container_package_path=/home/coder/virtual-client-packages/%package_name%"

echo Mounting package: "%package_path%" to "%container_package_path%"

docker run -d -p 8080:8080 --name virtual-client ^
    -v "%package_path%":%container_package_path%:ro ^
    -e VC_PACKAGE_PATH=%container_package_path% ^
    virtual-client

if %ERRORLEVEL% EQU 0 (
    echo Container started successfully with mounted package!
    echo.
    echo VS Code Web UI: http://localhost:8080
    echo Password: virtualclient123
    echo Package Path: %container_package_path%
    echo.
    echo The container includes:
    echo   * VS Code in your browser
    echo   * Virtual Client extension pre-installed
    echo   * Your package mounted at: %container_package_path%
    echo   * Ready to add remote machines and run Virtual Client
    echo.
    echo Use this path in the extension: %container_package_path%
    echo.
    echo Commands:
    echo   View logs: %0 logs
    echo   Access shell: %0 shell
    echo   Stop container: %0 stop
) else (
    echo Failed to start container!
)
exit /b 0

:build
echo Building Virtual Client container...
docker build -t virtual-client .
if %ERRORLEVEL% EQU 0 (
    echo Build successful!
    echo Run with: %0 run
) else (
    echo Build failed!
)
exit /b 0

:run
echo Starting Virtual Client container...
docker stop virtual-client 2>nul
docker rm virtual-client 2>nul

docker run -d -p 8080:8080 --name virtual-client virtual-client

if %ERRORLEVEL% EQU 0 (
    echo Container started successfully!
    echo.
    echo VS Code Web UI: http://localhost:8080
    echo Password: virtualclient123
    echo.
    echo The container includes:
    echo   * VS Code in your browser
    echo   * Virtual Client extension pre-installed
    echo   * Ready to add remote machines and run Virtual Client
    echo.
    echo Commands:
    echo   View logs: %0 logs
    echo   Access shell: %0 shell
    echo   Stop container: %0 stop
) else (
    echo Failed to start container!
)
exit /b 0

:stop
echo Stopping Virtual Client container...
docker stop virtual-client 2>nul
docker rm virtual-client 2>nul
echo Container stopped
exit /b 0

:logs
echo Showing container logs (Ctrl+C to exit)...
docker logs -f virtual-client
exit /b 0

:shell
echo Opening shell in container...
docker exec -it virtual-client /bin/bash
exit /b 0
