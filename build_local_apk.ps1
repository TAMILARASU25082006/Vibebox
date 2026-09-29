$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectDir = "C:\Users\yas12\.gemini\antigravity-ide\scratch\vibebox"
$toolsDir = Join-Path $projectDir "local-sdk-tools"
$jdkZip = Join-Path $toolsDir "jdk.zip"
$sdkZip = Join-Path $toolsDir "cmdtools.zip"

if (!(Test-Path $toolsDir)) {
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
}

$jdkFolder = Join-Path $toolsDir "jdk"
# Check if JDK 21 is present, otherwise clean it up
if (Test-Path $jdkFolder) {
    $releaseContent = Get-Content (Join-Path $jdkFolder "release") -ErrorAction SilentlyContinue | Out-String
    if ($releaseContent -notlike '*JAVA_VERSION="21*') {
        Write-Output "Upgrading local JDK from 17 to 21..."
        Remove-Item -Path $jdkFolder -Recurse -Force
    }
}

if (!(Test-Path $jdkFolder)) {
    if (!(Test-Path $jdkZip)) {
        Write-Output "Step 1/6: Downloading portable JDK 21..."
        $jdkUrl = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
        Invoke-WebRequest -Uri $jdkUrl -OutFile $jdkZip -UserAgent "Mozilla/5.0"
    }

    Write-Output "Step 3/6: Extracting JDK..."
    $jdkExtract = Join-Path $toolsDir "jdk_temp"
    Expand-Archive -Path $jdkZip -DestinationPath $jdkExtract -Force
    $jdkExtractedFolder = Get-ChildItem -Path $jdkExtract -Directory | Select-Object -First 1
    Move-Item -Path $jdkExtractedFolder.FullName -Destination $jdkFolder -Force
    Remove-Item -Path $jdkExtract -Recurse -Force
    if (Test-Path $jdkZip) { Remove-Item -Path $jdkZip -Force }
} else {
    Write-Output "JDK 21 already exists locally, skipping download/extraction."
}

$latestDir = Join-Path $toolsDir "android-sdk\cmdline-tools\latest"
if (!(Test-Path $latestDir)) {
    Write-Output "Step 2/6: Downloading Android Command-line Tools..."
    $sdkUrl = "https://dl.google.com/android/repository/commandlinetools-win-10406996_latest.zip"
    Invoke-WebRequest -Uri $sdkUrl -OutFile $sdkZip -UserAgent "Mozilla/5.0"
} else {
    Write-Output "Android SDK Command-line Tools already exist locally, skipping download."
}

if (!(Test-Path $latestDir)) {
    Write-Output "Step 4/6: Extracting Android SDK Tools..."
    $sdkExtract = Join-Path $toolsDir "sdk_temp"
    Expand-Archive -Path $sdkZip -DestinationPath $sdkExtract -Force
    New-Item -ItemType Directory -Force -Path $latestDir | Out-Null
    $extractedCmdtools = Join-Path $sdkExtract "cmdline-tools"
    Get-ChildItem -Path $extractedCmdtools | ForEach-Object {
        Move-Item -Path $_.FullName -Destination $latestDir -Force
    }
    Remove-Item -Path $sdkExtract -Recurse -Force
    Remove-Item -Path $sdkZip -Force
} else {
    Write-Output "Android SDK Tools already extracted, skipping step 4."
}

Write-Output "Step 5/6: Preparing Android SDK & Licenses..."
$env:JAVA_HOME = Join-Path $toolsDir "jdk"
$sdkRoot = Join-Path $toolsDir "android-sdk"
$sdkManager = Join-Path $toolsDir "android-sdk\cmdline-tools\latest\bin\sdkmanager.bat"

$cfgDir = Join-Path $HOME ".android"
if (!(Test-Path $cfgDir)) {
    New-Item -ItemType Directory -Path $cfgDir | Out-Null
}
New-Item -ItemType File -Path (Join-Path $cfgDir "repositories.cfg") -Force | Out-Null

Write-Output "Accepting Android SDK licenses..."
# Accept all SDK licenses
$yesList = , "y" * 20
$yesList | & $sdkManager --sdk_root=$sdkRoot --licenses | Out-Null

Write-Output "Step 6/6: Compiling VibeBox Android App..."
# Configure local.properties for the android project
$localProperties = Join-Path $projectDir "android\local.properties"
$sdkPathEscaped = $sdkRoot.Replace('\', '/')
"sdk.dir=$sdkPathEscaped" | Out-File -FilePath $localProperties -Encoding utf8 -Force

# Run Gradle assembleDebug to compile the APK
$env:ANDROID_HOME = $sdkRoot
$gradlew = Join-Path $projectDir "android\gradlew.bat"
cd (Join-Path $projectDir "android")
& $gradlew assembleDebug

Write-Output "=== COMPILATION COMPLETE ==="
$apkPath = Join-Path $projectDir "android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    Write-Output "APK generated successfully at: $apkPath"
} else {
    Write-Output "Compilation finished, but APK was not found."
}
