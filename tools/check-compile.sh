#!/usr/bin/env bash
# Type-checks the project's C# the way Unity 2019.4 would (C# 7.3, .NET Standard 2.0), without Unity.
# For agents working on a machine that has no Unity editor. It catches compile errors and C# > 7.3 syntax;
# it cannot catch shader errors or anything that only shows up at runtime.
#
#   SCRUBIN_UNITY_REFS=/path/to/dir/with/UnityEngine*.dll  tools/check-compile.sh
#
# SCRUBIN_UNITY_REFS   folder holding Unity 2019.4's UnityEngine.dll and UnityEngine.*Module.dll
#                      (from an editor install: Editor/Data/Managed/UnityEngine, or the UnityEngine.Modules
#                      2019.4.x NuGet package from nuget.bepinex.dev, lib/netstandard2.0).
# SCRUBIN_EDITOR_REFS  optional: folder holding UnityEditor.dll. With it, Assets/**/Editor scripts are checked too.
# SCRUBIN_EXTRA_REFS   optional: folder of extra reference DLLs (for example a real Unity.TextMeshPro.dll).
#                      Without a real TMP assembly, tools/compile-check/TMPStubs.cs stands in.
# DOTNET               optional: path to the dotnet CLI (default: dotnet on PATH, then ~/.dotnet/dotnet).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
REFS="${SCRUBIN_UNITY_REFS:-}"
EDITOR_REFS="${SCRUBIN_EDITOR_REFS:-}"
EXTRA_REFS="${SCRUBIN_EXTRA_REFS:-}"
DOTNET="${DOTNET:-$(command -v dotnet || true)}"
[ -n "$DOTNET" ] || DOTNET="$HOME/.dotnet/dotnet"

if [ -z "$REFS" ] || [ ! -f "$REFS/UnityEngine.CoreModule.dll" ]; then
  echo "Set SCRUBIN_UNITY_REFS to a folder containing Unity 2019.4's UnityEngine.CoreModule.dll (see the header of this script)." >&2
  exit 2
fi
if [ ! -x "$DOTNET" ]; then
  echo "dotnet CLI not found. Install the .NET SDK or set DOTNET=/path/to/dotnet." >&2
  exit 2
fi

WORK="${TMPDIR:-/tmp}/scrubin-compile-check"
mkdir -p "$WORK"

USE_TMP_STUBS=true
if [ -n "$EXTRA_REFS" ] && [ -f "$EXTRA_REFS/Unity.TextMeshPro.dll" ]; then USE_TMP_STUBS=false; fi

# One project per configuration; sources are globbed from the repo, nothing is written into it.
write_project() {  # name, defines, include_editor(true|false)
  local name="$1" defines="$2" editor="$3"
  mkdir -p "$WORK/$name"
  cat > "$WORK/$name/$name.csproj" <<PROJ
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
    <LangVersion>7.3</LangVersion>
    <Nullable>disable</Nullable>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <DefineConstants>$defines</DefineConstants>
    <NoWarn>\$(NoWarn);CS1591;NU1701;MSB3277;CS0436;CS1701;CS1702</NoWarn>
    <AssemblyName>ScrubInCheck_$name</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="$REPO/Assets/**/*.cs" Exclude="$REPO/Assets/**/Editor/**/*.cs" />
    $( [ "$editor" = true ] && echo "<Compile Include=\"$REPO/Assets/**/Editor/**/*.cs\" />" )
    $( [ "$USE_TMP_STUBS" = true ] && echo "<Compile Include=\"$REPO/tools/compile-check/TMPStubs.cs\" />" )
    <Reference Include="$REFS/*.dll"><Private>false</Private></Reference>
    $( [ "$editor" = true ] && echo "<Reference Include=\"$EDITOR_REFS/UnityEditor*.dll\"><Private>false</Private></Reference>" )
    $( [ -n "$EXTRA_REFS" ] && echo "<Reference Include=\"$EXTRA_REFS/*.dll\"><Private>false</Private></Reference>" )
  </ItemGroup>
</Project>
PROJ
}

COMMON="UNITY_2019;UNITY_2019_4;UNITY_2019_1_OR_NEWER;UNITY_2019_2_OR_NEWER;UNITY_2019_3_OR_NEWER;UNITY_2019_4_OR_NEWER;UNITY_2018_4_OR_NEWER;UNITY_2017_1_OR_NEWER;UNITY_5_3_OR_NEWER;NET_STANDARD_2_0;CSHARP_7_3_OR_NEWER"

write_project player-uwp       "$COMMON;UNITY_WSA;UNITY_WSA_10_0;ENABLE_IL2CPP" false
write_project editor-nouwp     "$COMMON;UNITY_EDITOR;UNITY_EDITOR_OSX;UNITY_STANDALONE" false
CONFIGS="player-uwp editor-nouwp"
if [ -n "$EDITOR_REFS" ] && [ -f "$EDITOR_REFS/UnityEditor.dll" ]; then
  write_project editor-uwp     "$COMMON;UNITY_EDITOR;UNITY_EDITOR_WIN;UNITY_WSA;UNITY_WSA_10_0" true
else
  write_project editor-uwp     "$COMMON;UNITY_EDITOR;UNITY_EDITOR_WIN;UNITY_WSA;UNITY_WSA_10_0" false
  echo "note: SCRUBIN_EDITOR_REFS not set, so scripts in Editor/ folders are NOT checked."
fi
CONFIGS="$CONFIGS editor-uwp"

status=0
for cfg in $CONFIGS; do
  echo "== $cfg =="
  if "$DOTNET" build "$WORK/$cfg/$cfg.csproj" -nologo -v:q -clp:NoSummary 2>&1 | sed "s|$REPO/||g" | grep -E "error|warning|Build succeeded" | sort -u; then :; fi
  if ! "$DOTNET" build "$WORK/$cfg/$cfg.csproj" -nologo -v:q -clp:NoSummary >/dev/null 2>&1; then status=1; echo "FAILED: $cfg"; else echo "ok: $cfg"; fi
done
[ "$USE_TMP_STUBS" = true ] && echo "note: TextMeshPro was type-checked against tools/compile-check/TMPStubs.cs, not the real package."
exit $status
