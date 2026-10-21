package com.naod6473.ondine.portal

import android.content.res.AssetManager
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.security.MessageDigest

/**
 * La page de réglages, servie par le Portal sur le réseau local (port 8787),
 * à ouvrir depuis un PC ou un téléphone : on scanne le QR code affiché par
 * Ondine (il contient le jeton), ou on tape l'adresse puis le code à 6 chiffres.
 *
 * Seules les adresses du réseau local sont acceptées. La page est en HTTP
 * simple (pas de certificat possible sur un réseau local) : la clé Claude
 * traverse donc le Wi-Fi de la maison en clair, une seule fois, quand on la
 * saisit. Elle n'est jamais renvoyée ensuite.
 */
class ConfigServer(
    private val assets: AssetManager,
    private val settings: Settings,
    private val listener: Listener,
) : NanoHTTPD(PORT) {
    interface Listener {
        fun onSettingsChanged()
        /** « Essayer » depuis la page : comme si on l'avait dit à Ondine. */
        fun onTest(text: String)
        fun onForget()
        /** L'état à montrer dans la page (voix, micro…). */
        fun status(): JSONObject
    }

    /** Le code à 6 chiffres affiché en ce moment (null = pas d'appairage en cours). */
    @Volatile var code: String? = null
        private set
    @Volatile private var misses = 0

    /** Un nouveau code (et le jeton s'il n'y en a pas). Renvoie (jeton, code). */
    fun openPairing(): Pair<String, String> {
        if (settings.webToken.isEmpty()) settings.webToken = Pairing.newToken()
        misses = 0
        val c = Pairing.newCode()
        code = c
        return settings.webToken to c
    }

    fun closePairing() {
        code = null
    }

    override fun serve(session: IHTTPSession): Response {
        if (!Pairing.isPrivate(session.remoteIpAddress)) return text(Response.Status.FORBIDDEN, "Réseau local seulement.")
        val path = session.uri ?: "/"
        return try {
            when {
                session.method == Method.GET && (path == "/" || path == "/index.html") -> asset("config/index.html", "text/html; charset=utf-8")
                session.method == Method.GET && path == "/gomme.js" -> asset("face/ondine-gomme.js", "application/javascript")
                session.method == Method.POST && path == "/api/pair" -> pair(body(session))
                path.startsWith("/api/") -> {
                    if (!authorized(session)) return json(Response.Status.UNAUTHORIZED, JSONObject().put("error", "jeton"))
                    api(session.method, path, if (session.method == Method.POST) body(session) else JSONObject())
                }
                else -> text(Response.Status.NOT_FOUND, "Introuvable.")
            }
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", e.message ?: "requête"))
        }
    }

    private fun api(method: Method, path: String, body: JSONObject): Response = when {
        method == Method.GET && path == "/api/settings" ->
            json(Response.Status.OK, settings.toJson().put("status", listener.status()))
        method == Method.POST && path == "/api/settings" -> {
            settings.apply(body)
            listener.onSettingsChanged()
            json(Response.Status.OK, settings.toJson().put("status", listener.status()))
        }
        method == Method.POST && path == "/api/test" -> {
            val t = body.optString("text").trim().take(500)
            if (t.isNotEmpty()) listener.onTest(t)
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        method == Method.POST && path == "/api/forget" -> {
            listener.onForget()
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        method == Method.POST && path == "/api/revoke" -> {
            // Déconnecte tous les appareils, celui-ci compris.
            settings.webToken = Pairing.newToken()
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        else -> text(Response.Status.NOT_FOUND, "Introuvable.")
    }

    /** Le code tapé dans la page → le jeton. Cinq essais ratés : le code change. */
    private fun pair(body: JSONObject): Response {
        val c = code ?: return json(Response.Status.FORBIDDEN, JSONObject().put("error", "Touchez la roue sur le Portal pour afficher un code."))
        if (!same(body.optString("code").trim(), c)) {
            if (++misses >= 5) code = Pairing.newCode().also { misses = 0; listener.onSettingsChanged() }
            return json(Response.Status.FORBIDDEN, JSONObject().put("error", "Code incorrect."))
        }
        return json(Response.Status.OK, JSONObject().put("token", settings.webToken))
    }

    private fun authorized(s: IHTTPSession): Boolean {
        val token = s.headers["x-ondine-jeton"] ?: return false
        val expected = settings.webToken
        return expected.isNotEmpty() && same(token, expected)
    }

    private fun same(a: String, b: String) = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    private fun body(s: IHTTPSession): JSONObject {
        val files = HashMap<String, String>()
        s.parseBody(files)
        val raw = files["postData"] ?: return JSONObject()
        if (raw.length > 20_000) throw IllegalArgumentException("trop long")
        return JSONObject(raw)
    }

    private fun asset(name: String, mime: String): Response {
        val bytes = assets.open(name).use { it.readBytes() }
        return newFixedLengthResponse(Response.Status.OK, mime, bytes.inputStream(), bytes.size.toLong()).apply {
            addHeader("Cache-Control", "no-store")
            addHeader("X-Content-Type-Options", "nosniff")
            addHeader("Referrer-Policy", "no-referrer")
        }
    }

    private fun json(status: Response.Status, j: JSONObject): Response =
        newFixedLengthResponse(status, "application/json; charset=utf-8", j.toString()).apply { addHeader("Cache-Control", "no-store") }

    private fun text(status: Response.Status, t: String): Response = newFixedLengthResponse(status, "text/plain; charset=utf-8", t)

    companion object {
        const val PORT = 8787
    }
}
