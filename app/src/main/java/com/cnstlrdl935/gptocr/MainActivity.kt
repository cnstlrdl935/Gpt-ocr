package com.cnstlrdl935.gptocr

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import java.io.File

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var cameraOutputUri: Uri? = null
    private val chooserRequestCode = 4102

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = true
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                openImageChooser()
                return true
            }
        }
        if (savedInstanceState == null) webView.loadUrl("https://cnstlrdl935.github.io/Gpt-ocr/")
        else webView.restoreState(savedInstanceState)
    }

    private fun openImageChooser() {
        val contentIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        val initialIntents = mutableListOf<Intent>()
        cameraOutputUri = createCameraOutputUri()
        cameraOutputUri?.let { output ->
            val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, output)
                clipData = ClipData.newUri(contentResolver, "촬영 이미지", output)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
            if (cameraIntent.resolveActivity(packageManager) != null) initialIntents.add(cameraIntent)
        }
        val chooser = Intent.createChooser(contentIntent, "이미지를 가져올 앱 선택").apply {
            if (initialIntents.isNotEmpty()) putExtra(Intent.EXTRA_INITIAL_INTENTS, initialIntents.toTypedArray())
        }
        try {
            startActivityForResult(chooser, chooserRequestCode)
        } catch (_: Exception) {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
        }
    }

    private fun createCameraOutputUri(): Uri? = try {
        val directory = getExternalFilesDir("Pictures") ?: cacheDir
        if (!directory.exists()) directory.mkdirs()
        val imageFile = File.createTempFile("ocr_camera_", ".jpg", directory)
        FileProvider.getUriForFile(this, "$packageName.fileprovider", imageFile)
    } catch (_: Exception) { null }

    @Deprecated("Deprecated Android result API retained for broad device compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != chooserRequestCode) return
        val selectedUri = when {
            resultCode != RESULT_OK -> null
            data?.data != null -> data.data
            else -> cameraOutputUri
        }
        filePathCallback?.onReceiveValue(selectedUri?.let { arrayOf(it) })
        filePathCallback = null
        cameraOutputUri = null
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated Android back navigation API retained for compatibility")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        webView.destroy()
        super.onDestroy()
    }
}
