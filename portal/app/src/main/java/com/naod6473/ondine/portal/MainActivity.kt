package com.naod6473.ondine.portal

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Ondine Portal : la goutte en plein écran, qu'on touche ou qu'on appelle
 * (« Dis Ondine »), qui répond avec Claude, à voix haute et par écrit.
 *
 * L'écran est une page web locale (assets/face/), qui dessine la goutte avec
 * le même moteur que le site (ondine-gomme.js) ; tout le reste est ici.
 */
class MainActivity : Activity(), Ears.Listener, ConfigServer.Listener {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var web: WebView
    private lateinit var settings: Settings
    private lateinit var brain: Brain
    private lateinit var voice: Voice
    private lateinit var server: ConfigServer
    private var ears: Ears? = null
    private var faceReady = false
    /** "pret", "ecoute", "reflechit", "parle". */
    private var state = "pret"
    private var lastTalk = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        settings = Settings(this)
        brain = Brain(settings)
        voice = Voice(this) { main.post { afterSpeaking() } }
        server = ConfigServer(assets, settings, this)
        try { server.start() } catch (e: Exception) { info("La page de réglages ne démarre pas : ${e.message}") }

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.setBackgroundColor(0xFF0B1C2C.toInt())
        web.addJavascriptInterface(Bridge(), "Ondine")
        web.loadUrl("file:///android_asset/face/index.html")
        setContentView(web)
        immersive()

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) loadEars()
        else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)

        // La conversation s'oublie après 10 minutes sans parler.
        main.postDelayed(object : Runnable {
            override fun run() {
                if (lastTalk > 0 && System.currentTimeMillis() - lastTalk > 10 * 60_000) { brain.forget(); lastTalk = 0 }
                main.postDelayed(this, 60_000)
            }
        }, 60_000)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) loadEars()
        else info("Sans le micro, je ne peux pas vous entendre. Autorisez-le dans les paramètres du Portal.")
    }

    /** Le modèle de reconnaissance met quelques secondes à se charger. */
    private fun loadEars() {
        worker.execute {
            val e = try { Ears(assets, this) } catch (ex: Throwable) { null }
            main.post {
                if (e == null) {
                    info("La reconnaissance vocale ne se charge pas (modèle absent de l'APK ?).")
                } else {
                    ears = e
                    applyMode()
                }
            }
        }
    }

    private fun applyMode() {
        if (!faceReady) return
        val e = ears ?: return js("face.state('charge')")
        if (settings.micMode == Settings.MIC_ALWAYS) e.startAlways() else e.stop()
        setState("pret")
        js("face.mascot(${q(settings.mascot)}, ${q(settings.color)})")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    @Suppress("DEPRECATION")
    private fun immersive() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
    }

    override fun onDestroy() {
        server.stop()
        ears?.release()
        voice.release()
        worker.shutdown()
        super.onDestroy()
    }

    // ── Ce que fait Ondine ──────────────────────────────────────────────────

    private fun setState(s: String) {
        state = s
        val shown = if (s == "pret" && settings.micMode == Settings.MIC_ALWAYS) "guette" else s
        js("face.state(${q(shown)})")
    }

    private fun tapped() {
        when (state) {
            "parle" -> { voice.stop(); afterSpeaking() }
            "reflechit" -> Unit
            "ecoute" -> Unit
            else -> {
                val e = ears ?: return info("Je me réveille encore, un instant…")
                setState("ecoute")
                js("face.play('ecoute')")
                e.listenOnce()
            }
        }
    }

    private fun ask(question: String) {
        lastTalk = System.currentTimeMillis()
        ears?.deaf = true
        js("face.heard(${q(question)})")
        setState("reflechit")
        worker.execute {
            val (answer, mood) = brain.ask(question)
            main.post { answer(answer, mood) }
        }
    }

    private fun answer(text: String, mood: String?) {
        js("face.answer(${q(text)}, ${q(mood ?: "happy")})")
        setState("parle")
        if (!(settings.voiceOn && voice.say(Mood.spoken(text), settings.voiceRate, settings.voicePitch))) {
            // Sans voix : le temps de lire (≈ 15 caractères par seconde, 3 à 12 s).
            main.postDelayed({ afterSpeaking() }, (text.length * 66L).coerceIn(3000, 12000))
        }
    }

    private fun afterSpeaking() {
        if (state != "parle") return
        ears?.deaf = false
        setState("pret")
        // En mode permanent, on peut enchaîner sans redire « Dis Ondine » pendant 6 s.
        if (settings.micMode == Settings.MIC_ALWAYS) {
            ears?.let { setState("ecoute"); it.listenOnce(6) }
        }
    }

    private fun info(message: String) = js("face.info(${q(message)})")

    private fun showPairing() {
        val ip = Pairing.localIp()
        if (ip == null) return info("Le Portal n'est pas sur un réseau Wi-Fi local : pas de page de réglages.")
        val (token, code) = server.openPairing()
        val base = "http://$ip:${ConfigServer.PORT}"
        val o = JSONObject().put("url", base).put("code", code).put("qr", Pairing.qrSvg("$base/#k=$token"))
        js("face.pairing($o)")
    }

    // ── Ears.Listener (fil des oreilles → fil principal) ────────────────────

    override fun onPartial(text: String) = main.post { if (state == "ecoute" || state == "pret") js("face.partial(${q(text)})") }.let {}
    override fun onQuestion(text: String) = main.post { ask(text) }.let {}
    override fun onCalled() = main.post { setState("ecoute"); js("face.play('coucou')") }.let {}
    override fun onNothing() = main.post { if (state == "ecoute" || state == "pret") { setState("pret"); js("face.partial('')") } }.let {}
    override fun onError(message: String) = main.post { setState("pret"); info(message) }.let {}

    // ── ConfigServer.Listener (fil du serveur) ──────────────────────────────

    override fun onSettingsChanged() = main.post { applyMode() }.let {}
    override fun onTest(text: String) = main.post { if (state != "reflechit") ask(text) }.let {}
    override fun onForget() = brain.forget()
    override fun status(): JSONObject = JSONObject()
        .put("voice", voice.state)
        .put("ears", if (ears == null) "charge" else if (ears?.isListening == true) "ouvert" else "ferme")
        .put("state", state)
        .put("version", BuildConfig.VERSION_NAME)

    // ── La page de la goutte ────────────────────────────────────────────────

    private inner class Bridge {
        @JavascriptInterface fun ready() = main.post { faceReady = true; applyMode() }.let {}
        @JavascriptInterface fun tap() = main.post { tapped() }.let {}
        @JavascriptInterface fun gear() = main.post { showPairing() }.let {}
        @JavascriptInterface fun closePairing() = main.post { server.closePairing() }.let {}
    }

    private fun js(code: String) {
        if (!faceReady) return
        web.evaluateJavascript("window.face && $code", null)
    }

    /** Une chaîne JavaScript sûre (JSON). */
    private fun q(s: String) = JSONObject.quote(s)
}
