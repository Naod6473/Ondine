package com.naod6473.ondine.portal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Les mêmes cas que l'Ondine du PC (askclaude_wake.rs), plus les capitales du modèle.
class WakeWordTest {
    @Test
    fun wakePhrasesAreRecognized() {
        for (t in listOf("Dis Ondine", "dis, Ondine !", "Hey Ondine.", "Hé Ondine", "OK Ondine", "Okay, Ondine", "hey undine", "Hé, on dîne", "Dis ondin", "DIS ONDINE", "DIS ON DINE")) {
            assertEquals(t, "", WakeWord.rest(t))
        }
        assertEquals("Quel temps fait-il ?", WakeWord.rest("Hey Ondine, quel temps fait-il ?"))
        assertEquals("Mets un minuteur de 5 minutes", WakeWord.rest("Euh dis Ondine mets un minuteur de 5 minutes"))
        assertEquals("Quelle heure est il", WakeWord.rest("DIS ONDINE QUELLE HEURE EST IL"))
    }

    @Test
    fun otherPhrasesAreNot() {
        for (t in listOf("", "Ondine", "Bonjour Ondine", "on dîne à huit heures", "dis donc", "hey", "je lui ai dit Ondine hier soir parce que", "ok on y va", "dis Pauline")) {
            assertNull(t, WakeWord.rest(t))
        }
    }
}
