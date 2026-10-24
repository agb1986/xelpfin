package com.xelpfin.app.platform

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import kotlin.concurrent.thread

/**
 * Fire TV / Android TV platform services used by the shared TypeScript code
 * (src/platform/firetv). Only a few things live natively:
 *  - a UDP broadcast round trip for server discovery (the payload and reply parsing are in TS),
 *  - the list of hardware/software video and audio decoders, for the playback device profile,
 *  - the HDR formats of the display and the encodings the audio output accepts, for the same,
 *  - the display modes and the window's preferred one, for refresh rate matching,
 *  - static device info,
 *  - trust on first use for self-signed HTTPS servers (see [CertificatePins]).
 * Nothing here talks to any host except the addresses the caller passes in.
 */
class XelpfinPlatformModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> =
      mapOf(
          "manufacturer" to Build.MANUFACTURER,
          "model" to Build.MODEL,
          "sdkInt" to Build.VERSION.SDK_INT,
          "abis" to Build.SUPPORTED_ABIS.joinToString(","),
          "isEmulator" to isEmulator(),
          "isFireTv" to reactApplicationContext.packageManager.hasSystemFeature("amazon.hardware.fire_tv"),
      )

  private fun isEmulator(): Boolean =
      Build.FINGERPRINT.startsWith("generic") ||
          Build.FINGERPRINT.contains("emulator") ||
          Build.MODEL.contains("sdk_gphone") ||
          Build.MODEL.contains("Android SDK built for") ||
          Build.HARDWARE.contains("ranchu") ||
          Build.HARDWARE.contains("goldfish")

  /**
   * Sends [message] to [port] on the limited broadcast address, every IPv4 interface broadcast
   * address, and any [extraHosts]; collects replies until [timeoutMs] elapses (clamped to
   * [MAX_DISCOVERY_MS]) or [MAX_DISCOVERY_REPLIES] replies have arrived, so a device flooding the
   * port cannot grow the result without bound. Resolves to an array of { address, payload } maps.
   */
  @ReactMethod
  fun udpBroadcast(
      message: String,
      port: Int,
      timeoutMs: Int,
      extraHosts: com.facebook.react.bridge.ReadableArray,
      promise: Promise,
  ) {
    val hosts = (0 until extraHosts.size()).mapNotNull { extraHosts.getString(it) }
    thread(name = "xelpfin-udp-discovery", isDaemon = true) {
      val results = Arguments.createArray()
      try {
        DatagramSocket().use { socket ->
          socket.broadcast = true
          val data = message.toByteArray(Charsets.UTF_8)
          val targets = LinkedHashSet<InetAddress>()
          targets.add(InetAddress.getByName("255.255.255.255"))
          targets.addAll(interfaceBroadcasts())
          hosts.forEach { h -> runCatching { targets.add(InetAddress.getByName(h)) } }
          for (t in targets) {
            runCatching { socket.send(DatagramPacket(data, data.size, t, port)) }
          }
          val deadline = System.currentTimeMillis() + timeoutMs.coerceIn(0, MAX_DISCOVERY_MS)
          val buf = ByteArray(8192)
          while (results.size() < MAX_DISCOVERY_REPLIES) {
            val left = deadline - System.currentTimeMillis()
            if (left <= 0) break
            socket.soTimeout = left.toInt().coerceAtLeast(1)
            val pkt = DatagramPacket(buf, buf.size)
            try {
              socket.receive(pkt)
            } catch (e: SocketTimeoutException) {
              break
            }
            val m = Arguments.createMap()
            m.putString("address", pkt.address.hostAddress)
            m.putString("payload", String(pkt.data, 0, pkt.length, Charsets.UTF_8))
            results.pushMap(m)
          }
        }
        promise.resolve(results)
      } catch (e: Exception) {
        promise.reject("E_UDP", e.message, e)
      }
    }
  }

  private fun interfaceBroadcasts(): List<InetAddress> =
      runCatching {
            NetworkInterface.getNetworkInterfaces()
                .toList()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.interfaceAddresses }
                .mapNotNull { it.broadcast }
          }
          .getOrDefault(emptyList())

  /**
   * Lists decoders: [{ mime, name, hardware, maxWidth, maxHeight, profiles }]. Video size limits
   * are only filled for video decoders.
   */
  @ReactMethod
  fun getDecoders(promise: Promise) {
    try {
      val out = Arguments.createArray()
      for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
        if (info.isEncoder) continue
        for (mime in info.supportedTypes) {
          val m = Arguments.createMap()
          m.putString("mime", mime)
          m.putString("name", info.name)
          m.putBoolean("hardware", isHardware(info))
          val caps = runCatching { info.getCapabilitiesForType(mime) }.getOrNull()
          val v = caps?.videoCapabilities
          if (v != null) {
            m.putInt("maxWidth", v.supportedWidths.upper)
            m.putInt("maxHeight", v.supportedHeights.upper)
          }
          val profiles = Arguments.createArray()
          caps?.profileLevels?.map { it.profile }?.distinct()?.forEach { profiles.pushInt(it) }
          m.putArray("profiles", profiles)
          out.pushMap(m)
        }
      }
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("E_CODECS", e.message, e)
    }
  }

  /**
   * HDR formats of the default display: { hdrTypes: [Display.HdrCapabilities.HDR_TYPE_*] }.
   * Empty when the display reports none (emulator, SDR TV), never rejected for that.
   */
  @ReactMethod
  fun getDisplayCapabilities(promise: Promise) {
    try {
      val types = Arguments.createArray()
      val dm = reactApplicationContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
      val display = dm?.getDisplay(Display.DEFAULT_DISPLAY)
      val supported = runCatching { display?.hdrCapabilities?.supportedHdrTypes }.getOrNull()
      supported?.forEach { types.pushInt(it) }
      val m = Arguments.createMap()
      m.putArray("hdrTypes", types)
      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("E_DISPLAY", e.message, e)
    }
  }

  /**
   * Modes of the default display: { modes: [{ id, width, height, refreshRate }], activeModeId }.
   * Empty and 0 when the display cannot be read.
   */
  @ReactMethod
  fun getDisplayModes(promise: Promise) {
    try {
      val display = defaultDisplay()
      val modes = Arguments.createArray()
      display?.supportedModes?.forEach { mode ->
        val m = Arguments.createMap()
        m.putInt("id", mode.modeId)
        m.putInt("width", mode.physicalWidth)
        m.putInt("height", mode.physicalHeight)
        m.putDouble("refreshRate", mode.refreshRate.toDouble())
        modes.pushMap(m)
      }
      val out = Arguments.createMap()
      out.putArray("modes", modes)
      out.putInt("activeModeId", display?.mode?.modeId ?: 0)
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("E_DISPLAY", e.message, e)
    }
  }

  /**
   * Sets the activity window's preferred display mode ([modeId] 0 clears the preference) and
   * resolves true once the default display reports a different mode, false when there is no
   * activity, the mode is already active, or nothing changed within [timeoutMs] (clamped to
   * [MAX_MODE_SWITCH_MS]). The window attribute stays set either way; the system drops it when
   * the activity goes away.
   */
  @ReactMethod
  fun setPreferredDisplayMode(modeId: Int, timeoutMs: Int, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val activity = reactApplicationContext.currentActivity
        val dm = reactApplicationContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
        val display = dm?.getDisplay(Display.DEFAULT_DISPLAY)
        if (activity == null || dm == null || display == null) {
          promise.resolve(false)
          return@runOnUiThread
        }
        val before = display.mode.modeId
        val attrs = activity.window.attributes
        if (attrs.preferredDisplayModeId == modeId) {
          promise.resolve(false)
          return@runOnUiThread
        }
        if (modeId != 0 && before == modeId) {
          attrs.preferredDisplayModeId = modeId
          activity.window.attributes = attrs
          promise.resolve(false)
          return@runOnUiThread
        }
        val handler = Handler(Looper.getMainLooper())
        var settled = false
        lateinit var listener: DisplayManager.DisplayListener
        val finish = { changed: Boolean ->
          if (!settled) {
            settled = true
            dm.unregisterDisplayListener(listener)
            handler.removeCallbacksAndMessages(null)
            promise.resolve(changed)
          }
        }
        listener =
            object : DisplayManager.DisplayListener {
              override fun onDisplayChanged(displayId: Int) {
                if (displayId != Display.DEFAULT_DISPLAY) return
                val now = dm.getDisplay(Display.DEFAULT_DISPLAY)?.mode?.modeId ?: return
                if (now != before) finish(true)
              }

              override fun onDisplayAdded(displayId: Int) {}

              override fun onDisplayRemoved(displayId: Int) {}
            }
        dm.registerDisplayListener(listener, handler)
        handler.postDelayed({ finish(false) }, timeoutMs.coerceIn(0, MAX_MODE_SWITCH_MS).toLong())
        attrs.preferredDisplayModeId = modeId
        activity.window.attributes = attrs
      } catch (e: Exception) {
        promise.reject("E_DISPLAY", e.message, e)
      }
    }
  }

  private fun defaultDisplay(): Display? =
      (reactApplicationContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)
          ?.getDisplay(Display.DEFAULT_DISPLAY)

  /**
   * Encodings and channel counts the audio outputs accept, over every output device (HDMI, the
   * TV's own speakers, Bluetooth): { encodings: [AudioFormat.ENCODING_*], maxChannels }. TS
   * keeps only the compressed encodings a sink can take as a bitstream. Empty and 0 when
   * nothing is reported.
   */
  @ReactMethod
  fun getAudioCapabilities(promise: Promise) {
    try {
      val encodings = LinkedHashSet<Int>()
      var maxChannels = 0
      val am = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      val devices = runCatching { am?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) }.getOrNull()
      devices?.forEach { d: AudioDeviceInfo ->
        d.encodings.forEach { encodings.add(it) }
        d.channelCounts.forEach { if (it > maxChannels) maxChannels = it }
      }
      val arr = Arguments.createArray()
      encodings.forEach { arr.pushInt(it) }
      val m = Arguments.createMap()
      m.putArray("encodings", arr)
      m.putInt("maxChannels", maxChannels)
      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("E_AUDIO", e.message, e)
    }
  }

  /**
   * Reads the certificate chain [host]:[port] presents, without completing the handshake or
   * sending any request. Resolves to { host, port, trusted, trustError?, chain: [{ sha256,
   * subject, issuer, notBefore, notAfter, selfSigned }] }, leaf first; `trusted` is the system
   * trust store's verdict. The caller shows the leaf fingerprint before calling
   * [setPinnedCertificates] with it.
   */
  @ReactMethod
  fun inspectCertificate(host: String, port: Int, timeoutMs: Int, promise: Promise) {
    thread(name = "xelpfin-tls-inspect", isDaemon = true) {
      try {
        val r = CertificatePins.inspect(host, port, timeoutMs.coerceIn(500, MAX_INSPECT_MS))
        val chain = Arguments.createArray()
        r.chain.forEach { c ->
          val m = Arguments.createMap()
          m.putString("sha256", CertificatePins.fingerprint(c))
          m.putString("subject", c.subjectX500Principal.name)
          m.putString("issuer", c.issuerX500Principal.name)
          m.putDouble("notBefore", c.notBefore.time.toDouble())
          m.putDouble("notAfter", c.notAfter.time.toDouble())
          m.putBoolean("selfSigned", c.subjectX500Principal == c.issuerX500Principal)
          chain.pushMap(m)
        }
        val out = Arguments.createMap()
        out.putString("host", host)
        out.putInt("port", port)
        out.putBoolean("trusted", r.systemError == null)
        r.systemError?.let { out.putString("trustError", it) }
        out.putArray("chain", chain)
        promise.resolve(out)
      } catch (e: Exception) {
        promise.reject("E_TLS", e.message ?: e.javaClass.simpleName, e)
      }
    }
  }

  /**
   * Replaces the pinned certificates: [{ host, port, sha256 }]. A pin is only consulted when the
   * system trust store rejects a chain, and only matches that host and port's leaf certificate.
   */
  @ReactMethod
  fun setPinnedCertificates(pins: ReadableArray, promise: Promise) {
    try {
      val map = HashMap<String, String>()
      for (i in 0 until pins.size()) {
        val p = pins.getMap(i) ?: continue
        val host = p.getString("host") ?: continue
        val sha = p.getString("sha256") ?: continue
        if (!p.hasKey("port")) continue
        map[CertificatePins.key(host, p.getInt("port"))] = sha
      }
      CertificatePins.setPins(map)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_TLS", e.message, e)
    }
  }

  private fun isHardware(info: MediaCodecInfo): Boolean =
      if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated
      else !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")

  companion object {
    const val NAME = "XelpfinPlatform"
    const val MAX_DISCOVERY_REPLIES = 64
    const val MAX_DISCOVERY_MS = 10_000
    const val MAX_INSPECT_MS = 15_000
    const val MAX_MODE_SWITCH_MS = 10_000
  }
}
