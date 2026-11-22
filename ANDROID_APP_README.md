# GPT OCR Android app

This repository now includes a native Android WebView wrapper for the existing OCR website.

The app intercepts the web page's image file input with WebChromeClient.onShowFileChooser
and launches Android's system chooser with Intent.createChooser(). A camera capture option
is added when a camera app is available. Android decides which installed photo and file
providers appear, including available Gallery, Google Photos, and My Files handlers.

## Build

Open this repository in Android Studio, or run:

    gradle assembleDebug

The debug APK is generated at app/build/outputs/apk/debug/app-debug.apk.

The app loads the hosted OCR website, so the Tesseract.js engine and language data still
require an internet connection. The project has not yet been verified on a physical Android device.
