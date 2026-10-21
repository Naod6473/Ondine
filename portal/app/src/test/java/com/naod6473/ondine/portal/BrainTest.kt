package com.naod6473.ondine.portal

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrainTest {
    @Test
    fun requestCarriesHistoryThenQuestion() {
        val body = Brain.requestBody("claude-sonnet-5-5", "consigne", listOf("Bonjour" to "Coucou !"), "Ça va ?")
        assertEquals("claude-sonnet-5-5", body.getString("model"))
        assertEquals("consigne", body.getString("system"))
        val m = body.getJSONArray("messages")
        assertEquals(3, m.length())
        assertEquals("user", m.getJSONObject(0).getString("role"))
        assertEquals("assistant", m.getJSONObject(1).getString("role"))
        assertEquals("Ça va ?", m.getJSONObject(2).getString("content"))
    }

    @Test
    fun answerJoinsTextBlocks() {
        val r = JSONObject("""{"content":[{"type":"text","text":"Il fait beau. "},{"type":"thinking","thinking":"x"},{"type":"text","text":"<humeur>joie</humeur>"}]}""")
        assertEquals("Il fait beau. <humeur>joie</humeur>", Brain.answerText(r))
    }

    @Test
    fun moodIsSplitAndMapped() {
        assertEquals("Il fait beau." to "happy", Mood.split("Il fait beau. <humeur>joie</humeur>"))
        assertEquals("Bravo !" to "fiere", Mood.split("Bravo ! <humeur>Fierté</humeur>"))
        val (t, m) = Mood.split("Sans humeur.")
        assertEquals("Sans humeur.", t)
        assertNull(m)
        assertEquals("Voici le plan", Mood.spoken("**Voici** le _plan_"))
    }

    @Test
    fun privateAddressesOnly() {
        assertTrue(Pairing.isPrivate("192.168.1.20"))
        assertTrue(Pairing.isPrivate("10.0.0.3"))
        assertTrue(Pairing.isPrivate("172.20.1.1"))
        assertEquals(false, Pairing.isPrivate("8.8.8.8"))
        assertEquals(false, Pairing.isPrivate("172.32.0.1"))
        assertEquals(false, Pairing.isPrivate(null))
    }
}
