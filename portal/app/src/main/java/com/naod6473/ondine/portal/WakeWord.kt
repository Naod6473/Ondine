package com.naod6473.ondine.portal

// Le mot d'appel « Dis Ondine » dans un texte reconnu (pur, testé).
// Même règle que l'Ondine du PC (src-tauri/src/modules/askclaude_wake.rs) :
// un mot d'appel (« dis », « hey », « ok »…, au plus deux mots avant), puis
// « Ondine » ou presque (« undine », « ondin », « on dine » en deux mots).
object WakeWord {
    /** Les mots qui précèdent « Ondine » (sans accents). */
    private val CALLS = setOf(
        "dis", "di", "dit", "dites", "hey", "hei", "hay", "he", "eh", "hep",
        "ok", "okay", "oke", "okey", "hi", "hello", "allo",
    )

    /** Un mot sans accents ni ponctuation, en minuscules. */
    fun plain(word: String): String = buildString {
        for (c in word.lowercase()) {
            val d = when (c) {
                'à', 'â', 'ä', 'á' -> 'a'
                'é', 'è', 'ê', 'ë' -> 'e'
                'î', 'ï', 'í' -> 'i'
                'ô', 'ö', 'ó' -> 'o'
                'ù', 'û', 'ü', 'ú' -> 'u'
                'ÿ', 'ý' -> 'y'
                'ç' -> 'c'
                else -> if (c.isLetterOrDigit()) c else null
            }
            if (d != null) append(d)
        }
    }

    /** Distance d'édition (petits mots seulement). */
    private fun distance(a: String, b: String): Int {
        var prev = IntArray(b.length + 1) { it }
        for (i in a.indices) {
            val row = IntArray(b.length + 1)
            row[0] = i + 1
            for (j in b.indices) {
                row[j + 1] = minOf(prev[j] + if (a[i] != b[j]) 1 else 0, prev[j + 1] + 1, row[j] + 1)
            }
            prev = row
        }
        return prev[b.length]
    }

    /** « ondine », ou presque. */
    private fun soundsLikeOndine(word: String) = word.length in 5..8 && distance(word, "ondine") <= 1

    /**
     * Le texte commence-t-il par le mot d'appel ? Alors ce qui suit (peut-être
     * vide, la question viendra ensuite), avec une majuscule ; sinon null.
     */
    fun rest(text: String): String? {
        val words = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        val plain = words.mapIndexed { i, w -> i to plain(w) }.filter { it.second.isNotEmpty() }
        for (start in 0 until minOf(plain.size, 3)) {
            if (plain[start].second !in CALLS) continue
            val (i1, w1) = plain.getOrNull(start + 1) ?: break
            val end = if (soundsLikeOndine(w1)) {
                i1
            } else {
                plain.getOrNull(start + 2)?.takeIf { soundsLikeOndine(w1 + it.second) }?.first
            } ?: continue
            val rest = words.drop(end + 1).joinToString(" ")
                .trimStart { it.isWhitespace() || it in ",.;:!?-–—…" }
                .trim()
            return sentence(rest)
        }
        return null
    }

    /** « BONJOUR TOI » (le modèle écrit en capitales) → « Bonjour toi ». */
    fun sentence(text: String): String {
        val t = text.trim()
        if (t.isEmpty()) return t
        val low = if (t == t.uppercase()) t.lowercase() else t
        return low.replaceFirstChar { it.uppercase() }
    }
}
