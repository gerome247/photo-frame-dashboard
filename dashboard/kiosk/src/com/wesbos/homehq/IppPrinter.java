package com.wesbos.homehq;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Prints a JPEG straight to a network printer with IPP (Print-Job), without Android's print
 * framework, which needs a vendor print plugin these devices don't have. The printer is found
 * on the local network with DNS-SD (_ipp._tcp), so a changed DHCP address doesn't matter; the
 * last one found is remembered. Needs a printer that accepts image/jpeg (most AirPrint printers).
 * Call print() off the main thread.
 */
final class IppPrinter {
  static final String TAG = "HomeHQ";
  static final String PREFS = "printer";
  static final int DISCOVER_MS = 10000;
  static final int TIMEOUT_MS = 30000;

  private final Context context;

  IppPrinter(Context context) {
    this.context = context.getApplicationContext();
  }

  /** Sends one page. Returns null on success, else a short error for the owner. */
  String print(byte[] jpeg, String jobName) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String uri = prefs.getString("uri", null);
    if (uri != null) {
      try {
        send(uri, jpeg, jobName);
        return null;
      } catch (IOException e) {
        Log.w(TAG, "Saved printer failed, looking again: " + e.getMessage());
      }
    }
    String[] found = discover();
    if (found == null) return "No printer found on this Wi-Fi";
    uri = found[0];
    try {
      send(uri, jpeg, jobName);
    } catch (IOException e) {
      Log.w(TAG, "Print failed", e);
      return e.getMessage();
    }
    prefs.edit().putString("uri", uri).putString("name", found[1]).apply();
    return null;
  }

  /** Finds an IPP printer with DNS-SD. Returns {printer URI, service name}, or null. */
  private String[] discover() {
    final NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
    final String[] result = new String[2];
    final CountDownLatch done = new CountDownLatch(1);
    final boolean[] resolving = {false};
    NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
      @Override public void onStartDiscoveryFailed(String type, int code) { done.countDown(); }
      @Override public void onStopDiscoveryFailed(String type, int code) {}
      @Override public void onDiscoveryStarted(String type) {}
      @Override public void onDiscoveryStopped(String type) {}
      @Override public void onServiceLost(NsdServiceInfo info) {}

      @Override
      public void onServiceFound(NsdServiceInfo info) {
        synchronized (resolving) {
          if (resolving[0]) return; // NsdManager resolves one service at a time
          resolving[0] = true;
        }
        Log.i(TAG, "Found printer " + info.getServiceName());
        nsd.resolveService(info, new NsdManager.ResolveListener() {
          @Override
          public void onResolveFailed(NsdServiceInfo i, int code) {
            synchronized (resolving) { resolving[0] = false; }
          }

          @Override
          public void onServiceResolved(NsdServiceInfo i) {
            String rp = "ipp/print";
            Map<String, byte[]> txt = i.getAttributes();
            if (txt != null && txt.get("rp") != null) rp = new String(txt.get("rp"), StandardCharsets.UTF_8);
            String host = i.getHost().getHostAddress();
            if (host.indexOf(':') >= 0) host = "[" + host + "]";
            result[0] = "ipp://" + host + ":" + i.getPort() + "/" + rp;
            result[1] = i.getServiceName();
            done.countDown();
          }
        });
      }
    };
    WifiManager wifi = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
    WifiManager.MulticastLock lock = wifi != null ? wifi.createMulticastLock("homehq-print") : null;
    if (lock != null) lock.acquire();
    nsd.discoverServices("_ipp._tcp", NsdManager.PROTOCOL_DNS_SD, listener);
    try {
      done.await(DISCOVER_MS, TimeUnit.MILLISECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    } finally {
      try {
        nsd.stopServiceDiscovery(listener);
      } catch (IllegalArgumentException ignored) {
        // discovery never started
      }
      if (lock != null) lock.release();
    }
    return result[0] == null ? null : result;
  }

  /** IPP/1.1 Print-Job over HTTP. Throws with a readable message if the printer refuses. */
  private static void send(String printerUri, byte[] jpeg, String jobName) throws IOException {
    ByteArrayOutputStream req = new ByteArrayOutputStream();
    req.write(new byte[] {0x01, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01}); // version 1.1, Print-Job, request 1
    req.write(0x01); // operation attributes
    attr(req, 0x47, "attributes-charset", "utf-8");
    attr(req, 0x48, "attributes-natural-language", "en");
    attr(req, 0x45, "printer-uri", printerUri);
    attr(req, 0x42, "requesting-user-name", "Home HQ");
    attr(req, 0x42, "job-name", jobName);
    attr(req, 0x49, "document-format", "image/jpeg");
    req.write(0x02); // job attributes
    attr(req, 0x44, "media", "iso_a4_210x297mm");
    attr(req, 0x44, "print-color-mode", "monochrome");
    req.write(0x03); // end of attributes
    req.write(jpeg);
    byte[] body = req.toByteArray();

    HttpURLConnection http = (HttpURLConnection) new URL(printerUri.replaceFirst("^ipp://", "http://")).openConnection();
    try {
      http.setConnectTimeout(TIMEOUT_MS);
      http.setReadTimeout(TIMEOUT_MS);
      http.setDoOutput(true);
      http.setRequestMethod("POST");
      http.setRequestProperty("Content-Type", "application/ipp");
      http.setFixedLengthStreamingMode(body.length);
      OutputStream out = http.getOutputStream();
      out.write(body);
      out.close();
      if (http.getResponseCode() != 200) throw new IOException("Printer said HTTP " + http.getResponseCode());
      DataInputStream in = new DataInputStream(http.getInputStream());
      in.readShort(); // version
      int status = in.readUnsignedShort();
      in.close();
      // 0x0000-0x00ff are successful (including "ok, some attributes ignored").
      if (status > 0x00ff) throw new IOException("Printer refused the job (IPP status 0x" + Integer.toHexString(status) + ")");
      Log.i(TAG, "Printed '" + jobName + "' (IPP status 0x" + Integer.toHexString(status) + ")");
    } finally {
      http.disconnect();
    }
  }

  private static void attr(ByteArrayOutputStream out, int tag, String name, String value) {
    byte[] n = name.getBytes(StandardCharsets.UTF_8), v = value.getBytes(StandardCharsets.UTF_8);
    out.write(tag);
    out.write(n.length >> 8);
    out.write(n.length);
    out.write(n, 0, n.length);
    out.write(v.length >> 8);
    out.write(v.length);
    out.write(v, 0, v.length);
  }
}
