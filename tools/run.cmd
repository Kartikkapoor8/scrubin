@echo off
rem run.cmd -- run a tools\*.ps1 script without changing PowerShell's execution policy.
rem
rem Usage (from C:\dev\scrubin, in PowerShell or Command Prompt):
rem   tools\run doctor
rem   tools\run ship
rem   tools\run hotspot on -FiveGHz
rem   tools\run record start
rem Windows blocks .ps1 scripts by default on this laptop; this passes -ExecutionPolicy Bypass for that one run only.

if "%~1"=="" (
  echo Usage: tools\run ^<script^> [arguments]    e.g.  tools\run doctor
  echo Scripts:
  for %%F in ("%~dp0*.ps1") do if /I not "%%~nF"=="_common" echo   %%~nF
  exit /b 1
)
set "SCRIPT=%~dp0%~1.ps1"
if not exist "%SCRIPT%" (
  echo No such script: %~1.ps1 in %~dp0
  exit /b 1
)
set "ARGS="
:collect
shift
if "%~1"=="" goto run
set ARGS=%ARGS% %1
goto collect
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"%ARGS%
exit /b %ERRORLEVEL%
