package com.naod6473.ondine.portal

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * La voix d'Ondine : le moteur de synthèse vocale d'Android. Le Portal n'en a
 * peut-être aucun en français ; on en installe un avec OpenPortal (RHVoice ou
 * « sherpa-onnx TTS Engine », voir portal/README.md). Sans voix, Ondine écrit
 * seulement sa réponse à l'écran.
 */
class Voice(context: Context, private val onDone: () -> Unit) {
    /** "attente", "ok", "sans-moteur", "sans-francais". */
    @Volatile var state = "attente"
        private set
    private var tts: TextToSpeech? = null

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            state = if (status != TextToSpeech.SUCCESS) {
                "sans-moteur"
            } else {
                val r = tts?.setLanguage(Locale.FRANCE) ?: TextToSpeech.LANG_NOT_SUPPORTED
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) "sans-francais" else "ok"
            }
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) = onDone()
            @Deprecated("Ancienne signature, encore appelée par certains moteurs")
            override fun onError(id: String?) = onDone()
            override fun onError(id: String?, code: Int) = onDone()
        })
    }

    /** Dit le texte ; renvoie false s'il n'y a pas de voix (alors onDone n'est pas appelé). */
    fun say(text: String, rate: Float, pitch: Float): Boolean {
        val t = tts ?: return false
        if (state != "ok" || text.isBlank()) return false
        t.setSpeechRate(rate)
        t.setPitch(pitch)
        return t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ondine-${System.nanoTime()}") == TextToSpeech.SUCCESS
    }

    fun stop() {
        tts?.stop()
    }

    fun release() {
        tts?.shutdown()
        tts = null
    }
}
