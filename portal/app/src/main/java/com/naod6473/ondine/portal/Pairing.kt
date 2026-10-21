package com.naod6473.ondine.portal

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.SecureRandom

/**
 * L'appairage de la page de réglages : un jeton long (dans le QR code) et un
 * code à 6 chiffres (à taper si on préfère l'adresse affichée). Le code change
 * à chaque affichage et après 5 essais ratés.
 */
object Pairing {
    private val random = SecureRandom()

    fun newToken(): String {
        val alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return (1..32).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("")
    }

    fun newCode(): String = (0 until 6).map { random.nextInt(10) }.joinToString("")

    /** L'adresse du Portal sur le réseau local (Wi-Fi), ou null hors réseau. */
    fun localIp(): String? = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .map { it.hostAddress }
            .firstOrNull { isPrivate(it) }
    } catch (_: Exception) {
        null
    }

    /** Une adresse du réseau local (10/8, 172.16/12, 192.168/16) : les seules acceptées. */
    fun isPrivate(ip: String?): Boolean {
        val p = ip?.split('.')?.mapNotNull { it.toIntOrNull() } ?: return false
        if (p.size != 4) return false
        return p[0] == 10 || (p[0] == 172 && p[1] in 16..31) || (p[0] == 192 && p[1] == 168) || ip == "127.0.0.1"
    }

    /** Le QR code en SVG (dessiné par la page de la goutte, net à toute taille). */
    fun qrSvg(text: String): String {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2))
        val sb = StringBuilder("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${m.width} ${m.height}' shape-rendering='crispEdges'><rect width='100%' height='100%' fill='#fff'/><path fill='#0b1c2c' d='")
        for (y in 0 until m.height) for (x in 0 until m.width) if (m.get(x, y)) sb.append("M$x ${y}h1v1h-1z")
        return sb.append("'/></svg>").toString()
    }
}
