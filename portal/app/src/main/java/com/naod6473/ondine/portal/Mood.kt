package com.naod6473.ondine.portal

// L'humeur que Claude ajoute à la fin de sa réponse (<humeur>joie</humeur>),
// comme dans Parler à Ondine sur le PC, et l'animation de la goutte qui la joue.
object Mood {
    private val ANIMS = mapOf(
        "joie" to "happy", "rire" to "rire", "clin" to "wink",
        "reflexion" to "thinking", "réflexion" to "thinking",
        "inquiete" to "worried", "inquiète" to "worried", "triste" to "sad",
        "surprise" to "surprise", "fierte" to "fiere", "fierté" to "fiere",
        "tendresse" to "love", "timide" to "shy",
    )

    /** Le texte sans la balise, et l'animation (null si aucune ou inconnue). */
    fun split(answer: String): Pair<String, String?> {
        val m = Regex("<humeur>\\s*([^<]*?)\\s*</humeur>\\s*$", RegexOption.IGNORE_CASE).find(answer.trim())
            ?: return answer.trim() to null
        val text = answer.trim().substring(0, m.range.first).trim()
        return text to ANIMS[m.groupValues[1].lowercase()]
    }

    /** Pour la voix : sans balises restantes, astérisques ni dièses de Markdown. */
    fun spoken(text: String): String =
        text.replace(Regex("<[^>]+>"), " ")
            .replace(Regex("[*_#`>]+"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
}
