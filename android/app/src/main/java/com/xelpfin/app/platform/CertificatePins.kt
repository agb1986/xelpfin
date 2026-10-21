package com.xelpfin.app.platform

import android.content.Context
import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.websocket.WebSocketModule
import java.io.File
import java.lang.ref.WeakReference
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Locale
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager
import okhttp3.Cache
import okhttp3.OkHttpClient
import okhttp3.internal.tls.OkHostnameVerifier

/**
 * Trust on first use for servers behind a self-signed certificate.
 *
 * The system trust store always decides first. Only when it rejects a chain does the pin list
 * get a say, and a pin only matches when the server's own (leaf) certificate has exactly the
 * SHA-256 fingerprint the user accepted for that host and port. Nothing here ever trusts a
 * certificate the user has not seen, and a pin never applies to another host or port.
 *
 * [install] puts the pinning trust manager into every OkHttp client React Native hands out:
 * fetch (NetworkingModule), images (Fresco) and video (react-native-video's Media3 OkHttp data
 * source) all get their client from [OkHttpClientProvider], and WebSockets get it through
 * [WebSocketModule.setCustomClientBuilder].
 */
object CertificatePins {

  /** host:port -> fingerprint ("AB:CD:..."). Replaced as a whole, never mutated. */
  @Volatile private var pins: Map<String, String> = emptyMap()

  private val system: X509TrustManager by lazy { systemTrustManager() }

  /**
   * Rebuilt whenever the pins change so TLS sessions negotiated under an old pin cannot be
   * resumed after that pin was removed or replaced.
   */
  @Volatile private var context: SSLContext = newContext()

  private val clients = mutableListOf<WeakReference<OkHttpClient>>()

  fun install(appContext: Context) {
    // Only fetch had an HTTP cache before (React Native's default for NetworkingModule); keep
    // it there, and keep images and video streams out of it as before.
    val cache = Cache(File(appContext.cacheDir, "http-cache"), 10L * 1024 * 1024)
    OkHttpClientProvider.setOkHttpClientFactory(
        OkHttpClientFactory { track(apply(OkHttpClientProvider.createClientBuilder()).build()) })
    NetworkingModule.setCustomClientBuilder { it.cache(cache) }
    WebSocketModule.setCustomClientBuilder { apply(it) }
  }

  private fun apply(builder: OkHttpClient.Builder): OkHttpClient.Builder =
      builder.sslSocketFactory(SocketFactory, TrustManager).hostnameVerifier(Hostnames)

  private fun track(client: OkHttpClient): OkHttpClient {
    synchronized(clients) {
      clients.removeAll { it.get() == null }
      clients.add(WeakReference(client))
    }
    return client
  }

  /** Replaces the whole pin list. Keys are normalised; malformed fingerprints are dropped. */
  fun setPins(next: Map<String, String>) {
    val clean =
        next.entries
            .mapNotNull { (k, v) ->
              val fp = v.uppercase(Locale.ROOT)
              if (FINGERPRINT.matches(fp)) k.lowercase(Locale.ROOT) to fp else null
            }
            .toMap()
    if (clean == pins) return
    pins = clean
    context = newContext()
    // Pooled connections were accepted under the old list; drop them so the next request
    // handshakes again under the new one.
    val live = synchronized(clients) { clients.mapNotNull { it.get() } }
    live.forEach { runCatching { it.connectionPool.evictAll() } }
  }

  fun key(host: String, port: Int): String =
      "${host.trim('[', ']').lowercase(Locale.ROOT)}:$port"

  private fun pinMatches(host: String?, port: Int, leaf: X509Certificate?): Boolean {
    if (host == null || leaf == null || port <= 0) return false
    val pin = pins[key(host, port)] ?: return false
    return MessageDigest.isEqual(pin.toByteArray(), fingerprint(leaf).toByteArray())
  }

  fun fingerprint(cert: X509Certificate): String =
      MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString(":") {
        "%02X".format(it)
      }

  private fun newContext(): SSLContext =
      SSLContext.getInstance("TLS").apply { init(null, arrayOf(TrustManager), null) }

  private fun systemTrustManager(): X509TrustManager {
    val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    tmf.init(null as KeyStore?)
    return tmf.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  /** System trust first; on rejection, the exact leaf pin for this host and port. */
  private object TrustManager : X509ExtendedTrustManager() {
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) {
      val sys = system
      try {
        if (sys is X509ExtendedTrustManager) sys.checkServerTrusted(chain, authType, socket)
        else sys.checkServerTrusted(chain, authType)
      } catch (e: CertificateException) {
        val session = (socket as? SSLSocket)?.handshakeSession
        val port = session?.peerPort?.takeIf { it > 0 } ?: socket?.port ?: -1
        if (!pinMatches(session?.peerHost, port, chain.firstOrNull())) throw e
      }
    }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) {
      val sys = system
      try {
        if (sys is X509ExtendedTrustManager) sys.checkServerTrusted(chain, authType, engine)
        else sys.checkServerTrusted(chain, authType)
      } catch (e: CertificateException) {
        if (!pinMatches(engine?.peerHost, engine?.peerPort ?: -1, chain.firstOrNull())) throw e
      }
    }

    // Without a socket or engine there is no host to look a pin up for: system trust only.
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        system.checkServerTrusted(chain, authType)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        throw CertificateException("client certificates are not accepted")

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        throw CertificateException("client certificates are not accepted")

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        throw CertificateException("client certificates are not accepted")

    override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
  }

  /**
   * OkHttp's normal name check, except that a pinned leaf is accepted for the host it was
   * pinned to even when its names do not cover that host (a self-signed certificate made for
   * "jellyfin" but reached by IP address). The pin is the trust decision: only the holder of
   * that exact certificate's key can complete the handshake.
   */
  private object Hostnames : HostnameVerifier {
    override fun verify(host: String, session: SSLSession): Boolean {
      if (OkHostnameVerifier.verify(host, session)) return true
      val leaf = runCatching { session.peerCertificates.firstOrNull() as? X509Certificate }.getOrNull()
      return pinMatches(host, session.peerPort, leaf)
    }
  }

  /** Delegates to the current [context], so clients built before a pin change pick it up. */
  private object SocketFactory : SSLSocketFactory() {
    private val f: SSLSocketFactory
      get() = context.socketFactory

    override fun getDefaultCipherSuites(): Array<String> = f.defaultCipherSuites
    override fun getSupportedCipherSuites(): Array<String> = f.supportedCipherSuites
    override fun createSocket(): Socket = f.createSocket()
    override fun createSocket(s: Socket, host: String, port: Int, autoClose: Boolean): Socket =
        f.createSocket(s, host, port, autoClose)
    override fun createSocket(host: String, port: Int): Socket = f.createSocket(host, port)
    override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
        f.createSocket(host, port, localHost, localPort)
    override fun createSocket(host: InetAddress, port: Int): Socket = f.createSocket(host, port)
    override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
        f.createSocket(address, port, localAddress, localPort)
  }

  class Inspection(
      val chain: List<X509Certificate>,
      /** Null when the system trust store accepts the chain, else why it does not. */
      val systemError: String?,
  )

  /**
   * Opens a TLS connection to [host]:[port] only to read the certificate chain, then aborts the
   * handshake from the trust manager, so no request (and no token) is ever sent to a server
   * whose certificate has not been accepted. Blocking; call it off the main thread.
   */
  fun inspect(host: String, port: Int, timeoutMs: Int): Inspection {
    var seen: List<X509Certificate>? = null
    var systemError: String? = null
    val recorder =
        object : X509ExtendedTrustManager() {
          private fun record(chain: Array<X509Certificate>, check: () -> Unit) {
            seen = chain.toList()
            systemError =
                try {
                  check()
                  null
                } catch (e: CertificateException) {
                  e.message ?: e.javaClass.simpleName
                }
            throw CertificateException(INSPECTION_ONLY)
          }

          override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: Socket?) =
              record(c) {
                val sys = system
                if (sys is X509ExtendedTrustManager) sys.checkServerTrusted(c, a, s)
                else sys.checkServerTrusted(c, a)
              }

          override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) =
              record(c) { system.checkServerTrusted(c, a) }

          override fun checkServerTrusted(c: Array<X509Certificate>, a: String) =
              record(c) { system.checkServerTrusted(c, a) }

          override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: Socket?) =
              throw CertificateException(INSPECTION_ONLY)

          override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) =
              throw CertificateException(INSPECTION_ONLY)

          override fun checkClientTrusted(c: Array<X509Certificate>, a: String) =
              throw CertificateException(INSPECTION_ONLY)

          override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
        }
    val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(recorder), null) }
    val bare = host.trim('[', ']')
    Socket().use { raw ->
      raw.connect(InetSocketAddress(bare, port), timeoutMs)
      raw.soTimeout = timeoutMs
      (ctx.socketFactory.createSocket(raw, bare, port, true) as SSLSocket).use { tls ->
        if (!IP_LITERAL.containsMatchIn(bare)) {
          runCatching {
            tls.sslParameters = tls.sslParameters.apply { serverNames = listOf(SNIHostName(bare)) }
          }
        }
        try {
          tls.startHandshake()
        } catch (e: SSLException) {
          if (seen == null) throw e
        }
      }
    }
    val chain = seen ?: throw SSLException("the server sent no certificate")
    return Inspection(chain, systemError)
  }

  private const val INSPECTION_ONLY = "xelpfin: certificate inspection only"
  private val FINGERPRINT = Regex("^([0-9A-F]{2}:){31}[0-9A-F]{2}$")
  private val IP_LITERAL = Regex("^[0-9.]+$|:")
}
