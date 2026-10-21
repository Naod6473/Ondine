package com.naod6473.ondine.portal

import android.annotation.SuppressLint
import android.content.res.AssetManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.k2fsa.sherpa.onnx.EndpointConfig
import com.k2fsa.sherpa.onnx.EndpointRule
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig

/**
 * Les oreilles d'Ondine : le micro du Portal et la reconnaissance en français,
 * tout sur l'appareil (sherpa-onnx, modèle zipformer en continu). Rien ne part
 * sur Internet avant que la phrase soit finie et adressée à Ondine.
 *
 * Deux modes (réglage micMode) :
 *  - « toucher » : le micro est fermé ; on touche Ondine, elle écoute une phrase ;
 *  - « permanent » : le micro reste ouvert et Ondine attend « Dis Ondine ».
 * Pendant qu'elle réfléchit ou parle, ce qu'elle entend est ignoré (sinon elle
 * s'entendrait elle-même).
 */
class Ears(assets: AssetManager, private val listener: Listener) {
    interface Listener {
        /** Le texte en cours (pour l'afficher pendant qu'on parle). */
        fun onPartial(text: String)
        /** Une phrase finie, adressée à Ondine (le mot d'appel déjà retiré). */
        fun onQuestion(text: String)
        /** « Dis Ondine » tout seul : Ondine attend la suite. */
        fun onCalled()
        /** L'écoute d'une phrase s'arrête sans rien (silence, ou phrase pas pour elle). */
        fun onNothing()
        fun onError(message: String)
    }

    private val recognizer = OnlineRecognizer(assets, config())
    @Volatile private var thread: Thread? = null
    @Volatile private var running = false
    /** Une seule phrase à écouter (toucher Ondine, ou après « Dis Ondine »). */
    @Volatile private var oneShot = false
    @Volatile private var oneShotUntil = 0L
    /** Ondine réfléchit ou parle : on n'écoute pas. */
    @Volatile var deaf = false

    /** Le micro reste ouvert entre les phrases (mode permanent). */
    @Volatile private var always = false

    /** Micro ouvert en continu, en attente du mot d'appel. */
    fun startAlways() {
        always = true
        oneShot = false
        start()
    }

    /** Une phrase, sans mot d'appel (toucher Ondine), au plus [seconds] s pour commencer. */
    fun listenOnce(seconds: Int = 8) {
        oneShot = true
        oneShotUntil = System.currentTimeMillis() + seconds * 1000L
        deaf = false
        start()
    }

    fun stop() {
        always = false
        running = false
        thread?.join(1500)
        thread = null
    }

    fun release() {
        stop()
        recognizer.release()
    }

    val isListening get() = running

    @SuppressLint("MissingPermission") // demandée par MainActivity avant tout démarrage
    private fun start() {
        if (running) return
        running = true
        thread = Thread({ loop() }, "ondine-oreilles").apply { start() }
    }

    @SuppressLint("MissingPermission")
    private fun loop() {
        val rate = 16_000
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, rate))
        } catch (_: Exception) {
            null
        }
        if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
            running = false
            listener.onError("Le micro ne s'ouvre pas (bouton de confidentialité du Portal ? autorisation ?).")
            return
        }
        val stream = recognizer.createStream()
        val chunk = ShortArray(rate / 10) // 100 ms
        val samples = FloatArray(chunk.size)
        var lastPartial = ""
        try {
            rec.startRecording()
            while (running) {
                val n = rec.read(chunk, 0, chunk.size)
                if (n <= 0) continue
                if (deaf) {
                    // Rien n'est gardé de ce qu'on entend pendant qu'Ondine parle.
                    if (lastPartial.isNotEmpty()) { recognizer.reset(stream); lastPartial = "" }
                    continue
                }
                for (i in 0 until n) samples[i] = chunk[i] / 32768f
                stream.acceptWaveform(if (n == samples.size) samples else samples.copyOf(n), rate)
                while (recognizer.isReady(stream)) recognizer.decode(stream)
                val text = recognizer.getResult(stream).text.trim()
                if (text != lastPartial) {
                    lastPartial = text
                    // En mode permanent, on n'affiche que ce qui commence comme un appel.
                    if (oneShot || looksLikeCall(text)) listener.onPartial(WakeWord.sentence(text))
                }
                if (recognizer.isEndpoint(stream)) {
                    recognizer.reset(stream)
                    lastPartial = ""
                    if (text.isNotEmpty()) handlePhrase(text)
                } else if (oneShot && text.isEmpty() && System.currentTimeMillis() > oneShotUntil) {
                    // Personne n'a parlé : on referme.
                    finishOneShot()
                    listener.onNothing()
                }
                if (!running) break
            }
        } finally {
            try { rec.stop() } catch (_: Exception) {}
            rec.release()
            stream.release()
        }
    }

    private fun handlePhrase(text: String) {
        if (oneShot) {
            // Une phrase sans mot d'appel ; si on l'a dit quand même, on le retire.
            val q = WakeWord.rest(text) ?: WakeWord.sentence(text)
            finishOneShot()
            if (q.isEmpty()) listener.onNothing() else listener.onQuestion(q)
            return
        }
        val rest = WakeWord.rest(text) ?: return listener.onNothing()
        if (rest.isEmpty()) {
            // « Dis Ondine » tout seul : la phrase suivante est la question.
            oneShot = true
            oneShotUntil = System.currentTimeMillis() + 8000
            listener.onCalled()
        } else {
            listener.onQuestion(rest)
        }
    }

    /** Fin d'une phrase écoutée : en mode toucher on ferme le micro, en permanent on revient au guet. */
    private fun finishOneShot() {
        oneShot = false
        if (!always) running = false
    }

    /**
     * Le début d'un appel (« dis… », « dis Ondine… ») : seul ce texte-là est
     * affiché en mode permanent, pas les conversations de la pièce.
     */
    private fun looksLikeCall(text: String) = WakeWord.rest(text) != null || WakeWord.rest("$text ondine") != null

    companion object {
        private const val MODEL = "sherpa-onnx-streaming-zipformer-fr-2023-04-14"

        fun config() = OnlineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = "$MODEL/encoder-epoch-29-avg-9-with-averaged-model.int8.onnx",
                    decoder = "$MODEL/decoder-epoch-29-avg-9-with-averaged-model.onnx",
                    joiner = "$MODEL/joiner-epoch-29-avg-9-with-averaged-model.onnx",
                ),
                tokens = "$MODEL/tokens.txt",
                modelType = "zipformer",
                numThreads = 2,
            ),
            // Une phrase est finie après 1 s de silence (2,4 s si rien n'a été reconnu).
            endpointConfig = EndpointConfig(
                rule1 = EndpointRule(false, 2.4f, 0.0f),
                rule2 = EndpointRule(true, 1.0f, 0.0f),
                rule3 = EndpointRule(false, 0.0f, 20.0f),
            ),
            enableEndpoint = true,
        )
    }
}
