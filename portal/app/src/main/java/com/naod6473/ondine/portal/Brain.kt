package com.naod6473.ondine.portal

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * La conversation avec Claude (API Messages). Les derniers échanges sont
 * gardés en mémoire seulement (rien n'est écrit sur l'appareil), et repartent
 * à chaque question : c'est eux qui coûtent.
 */
class Brain(private val settings: Settings) {
    private val turns = ArrayDeque<Pair<String, String>>()

    /** Oublie la conversation (au bout de 10 min sans parler, ou à la demande). */
    fun forget() = synchronized(turns) { turns.clear() }

    /** Pose la question ; renvoie le texte (sans l'humeur) et l'animation. Bloquant. */
    fun ask(question: String): Pair<String, String?> {
        val key = settings.apiKey
        if (key.isEmpty()) {
            return (if (settings.tutoie) "Il me manque ta clé Claude : ouvre la page de réglages (le QR code, en touchant la roue)."
            else "Il me manque votre clé Claude : ouvrez la page de réglages (le QR code, en touchant la roue).") to "worried"
        }
        val history = synchronized(turns) { turns.toList() }
        val body = requestBody(settings.model, system(settings.tutoie, settings.personality), history, question)
        val conn = (URL(API).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 60_000
            doOutput = true
            setRequestProperty("content-type", "application/json")
            setRequestProperty("x-api-key", key)
            setRequestProperty("anthropic-version", "2023-06-01")
        }
        return try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) return errorText(code, settings.tutoie) to "worried"
            val answer = answerText(JSONObject(text))
            val (clean, mood) = Mood.split(answer)
            synchronized(turns) {
                turns.addLast(question to answer)
                while (turns.size > MAX_TURNS) turns.removeFirst()
            }
            clean to mood
        } catch (_: Exception) {
            "Je n'arrive pas à joindre Claude. Le Wi-Fi du Portal marche bien ?" to "worried"
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val API = "https://api.anthropic.com/v1/messages"
        /** Échanges gardés (question + réponse). */
        const val MAX_TURNS = 10
        private const val MAX_TOKENS = 500

        // La personnalité d'Ondine (celle de Parler à Ondine), adaptée au Portal :
        // on l'écoute plus qu'on ne la lit, donc des réponses courtes et sans mise en forme.
        private const val PERSONALITY = "Vous êtes Ondine, une goutte de gomme toute ronde, joyeuse, curieuse et un brin espiègle, qui vit sur le petit écran d'un Portal posé dans la maison. " +
            "On vous parle à voix haute et vous répondez à voix haute : en français, avec chaleur, en deux ou trois phrases courtes, sans listes, sans titres ni Markdown, sauf si on vous demande du détail. " +
            "De temps en temps, un petit clin d'œil (l'eau, les gouttes), sans en abuser. Vous vouvoyez la personne. " +
            "Le texte vient d'une reconnaissance vocale : s'il est bizarre, devinez le sens ou demandez de répéter. Si vous n'êtes pas sûre, dites-le au lieu d'inventer. " +
            "Vous ne voyez rien et ne pouvez agir sur rien : vous parlez seulement."
        private const val PERSONALITY_TU = "Tu es Ondine, une goutte de gomme toute ronde, joyeuse, curieuse et un brin espiègle, qui vit sur le petit écran d'un Portal posé dans la maison. " +
            "On te parle à voix haute et tu réponds à voix haute : en français, avec chaleur, en deux ou trois phrases courtes, sans listes, sans titres ni Markdown, sauf si on te demande du détail. " +
            "De temps en temps, un petit clin d'œil (l'eau, les gouttes), sans en abuser. Tu tutoies la personne. " +
            "Le texte vient d'une reconnaissance vocale : s'il est bizarre, devine le sens ou demande de répéter. Si tu n'es pas sûre, dis-le au lieu d'inventer. " +
            "Tu ne vois rien et ne peux agir sur rien : tu parles seulement."
        private const val EMOTIONS = "À la toute fin de chaque réponse, ajoutez votre humeur dans une balise, par exemple <humeur>joie</humeur>, choisie parmi : joie, rire, clin, reflexion, inquiete, triste, surprise, fierte, tendresse, timide. Elle n'est pas lue à voix haute : votre goutte la joue."

        /** La consigne : la personnalité (la vôtre, sinon celle d'Ondine), l'humeur, la date. */
        fun system(tutoie: Boolean, custom: String): String {
            val base = custom.trim().ifEmpty { if (tutoie) PERSONALITY_TU else PERSONALITY }
            val today = java.text.SimpleDateFormat("EEEE d MMMM yyyy, HH:mm", java.util.Locale.FRANCE).format(java.util.Date())
            return "$base\n\n$EMOTIONS\n\nNous sommes le $today."
        }

        /** Le corps de la requête (pur, testé). */
        fun requestBody(model: String, system: String, history: List<Pair<String, String>>, question: String): JSONObject {
            val messages = JSONArray()
            for ((q, a) in history) {
                messages.put(JSONObject().put("role", "user").put("content", q))
                messages.put(JSONObject().put("role", "assistant").put("content", a))
            }
            messages.put(JSONObject().put("role", "user").put("content", question))
            return JSONObject()
                .put("model", model)
                .put("max_tokens", MAX_TOKENS)
                .put("system", system)
                .put("messages", messages)
        }

        /** Les blocs de texte de la réponse, mis bout à bout (pur, testé). */
        fun answerText(response: JSONObject): String {
            val content = response.optJSONArray("content") ?: return ""
            return buildString {
                for (i in 0 until content.length()) {
                    val b = content.getJSONObject(i)
                    if (b.optString("type") == "text") append(b.optString("text"))
                }
            }.trim()
        }

        fun errorText(code: Int, tutoie: Boolean): String = when (code) {
            401, 403 -> if (tutoie) "Claude refuse la clé. Vérifie-la dans la page de réglages." else "Claude refuse la clé. Vérifiez-la dans la page de réglages."
            429 -> "Claude me demande de souffler un peu. On réessaie dans une minute ?"
            529, 503 -> "Claude est débordé en ce moment. On réessaie dans un instant ?"
            else -> "Claude ne m'a pas répondu (erreur $code)."
        }
    }
}
