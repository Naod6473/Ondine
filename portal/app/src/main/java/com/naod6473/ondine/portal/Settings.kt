package com.naod6473.ondine.portal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Les réglages, modifiés depuis la page web (ConfigServer). La clé Claude est
 * chiffrée par une clé du Keystore Android, qui ne sort jamais de l'appareil.
 */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("ondine", Context.MODE_PRIVATE)

    var micMode: String
        get() = prefs.getString("micMode", MIC_TAP) ?: MIC_TAP
        set(v) = prefs.edit().putString("micMode", if (v == MIC_ALWAYS) MIC_ALWAYS else MIC_TAP).apply()
    var model: String
        get() = prefs.getString("model", MODELS[0]) ?: MODELS[0]
        set(v) = prefs.edit().putString("model", if (v in MODELS) v else MODELS[0]).apply()
    var tutoie: Boolean
        get() = prefs.getBoolean("tutoie", false)
        set(v) = prefs.edit().putBoolean("tutoie", v).apply()
    var voiceOn: Boolean
        get() = prefs.getBoolean("voiceOn", true)
        set(v) = prefs.edit().putBoolean("voiceOn", v).apply()
    var voiceRate: Float
        get() = prefs.getFloat("voiceRate", 1.0f)
        set(v) = prefs.edit().putFloat("voiceRate", v.coerceIn(0.5f, 2.0f)).apply()
    var voicePitch: Float
        get() = prefs.getFloat("voicePitch", 1.1f)
        set(v) = prefs.edit().putFloat("voicePitch", v.coerceIn(0.5f, 2.0f)).apply()
    var personality: String
        get() = prefs.getString("personality", "") ?: ""
        set(v) = prefs.edit().putString("personality", v.trim().take(1500)).apply()
    var mascot: String
        get() = prefs.getString("mascot", "goutte") ?: "goutte"
        set(v) = prefs.edit().putString("mascot", v.filter { it.isLetterOrDigit() || it == '-' }.take(32).ifEmpty { "goutte" }).apply()
    var color: String
        get() = prefs.getString("color", "auto") ?: "auto"
        set(v) = prefs.edit().putString("color", v.filter { it.isLetterOrDigit() || it == '-' }.take(32).ifEmpty { "auto" }).apply()
    /** Le jeton de la page web : celui qui l'a peut tout régler. */
    var webToken: String
        get() = prefs.getString("webToken", "") ?: ""
        set(v) = prefs.edit().putString("webToken", v).apply()

    var apiKey: String
        get() = prefs.getString("apiKey", null)?.let { decrypt(it) } ?: ""
        set(v) {
            val k = v.trim()
            prefs.edit().apply { if (k.isEmpty()) remove("apiKey") else putString("apiKey", encrypt(k)) }.apply()
        }

    /** Ce que la page web peut lire : jamais la clé, seulement ses 4 derniers caractères. */
    fun toJson(): JSONObject = JSONObject().apply {
        put("micMode", micMode)
        put("model", model)
        put("models", org.json.JSONArray(MODELS))
        put("tutoie", tutoie)
        put("voiceOn", voiceOn)
        put("voiceRate", voiceRate.toDouble())
        put("voicePitch", voicePitch.toDouble())
        put("personality", personality)
        put("mascot", mascot)
        put("color", color)
        val key = apiKey
        put("hasKey", key.isNotEmpty())
        put("keyEnd", if (key.length > 8) key.takeLast(4) else "")
    }

    /** Applique ce que la page envoie (les champs absents ne changent pas). */
    fun apply(j: JSONObject) {
        if (j.has("micMode")) micMode = j.getString("micMode")
        if (j.has("model")) model = j.getString("model")
        if (j.has("tutoie")) tutoie = j.getBoolean("tutoie")
        if (j.has("voiceOn")) voiceOn = j.getBoolean("voiceOn")
        if (j.has("voiceRate")) voiceRate = j.getDouble("voiceRate").toFloat()
        if (j.has("voicePitch")) voicePitch = j.getDouble("voicePitch").toFloat()
        if (j.has("personality")) personality = j.getString("personality")
        if (j.has("mascot")) mascot = j.getString("mascot")
        if (j.has("color")) color = j.getString("color")
        if (j.has("apiKey")) apiKey = j.getString("apiKey")
    }

    // ── La clé chiffrée (AES-GCM, clé du Keystore) ───────────────────────────
    private fun secret(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secret()) }
        val out = c.iv + c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? = try {
        val all = Base64.decode(stored, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, all, 0, 12))
        String(c.doFinal(all, 12, all.size - 12))
    } catch (_: Exception) {
        null
    }

    companion object {
        const val MIC_TAP = "toucher"
        const val MIC_ALWAYS = "permanent"
        /** Les modèles proposés (les mêmes que Parler à Ondine sur le PC). */
        val MODELS = listOf("claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001")
        private const val ALIAS = "ondine-cle"
    }
}
