package com.xelpfin.app.platform

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import kotlin.concurrent.thread

/**
 * Fire TV / Android TV platform services used by the shared TypeScript code
 * (src/platform/firetv). Only three things live natively:
 *  - a UDP broadcast round trip for server discovery (the payload and reply parsing are in TS),
 *  - the list of hardware/software video and audio decoders, for the playback device profile,
 *  - static device info.
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

  private fun isHardware(info: MediaCodecInfo): Boolean =
      if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated
      else !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")

  companion object {
    const val NAME = "XelpfinPlatform"
    const val MAX_DISCOVERY_REPLIES = 64
    const val MAX_DISCOVERY_MS = 10_000
  }
}
