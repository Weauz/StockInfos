package fr.stockinfos.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/** StockInfos sur téléphone : l'interface de l'appli PC dans une WebView, branchée sur la même base de données. */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 41, REQ_CAM_PERM = 42;
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private Uri camUri;
    private WebChromeClient.FileChooserParams pendingParams;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("file".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                pendingParams = p;
                boolean wantsImage = Arrays.toString(p.getAcceptTypes()).contains("image");
                if (wantsImage && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM_PERM);
                } else openChooser(p);
                return true;
            }
        });
        web.loadUrl("file:///android_asset/www/index.html");
    }

    private void openChooser(WebChromeClient.FileChooserParams p) {
        Intent pick = p.createIntent();
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        Intent chooser;
        boolean wantsImage = Arrays.toString(p.getAcceptTypes()).contains("image");
        camUri = null;
        if (wantsImage && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            try {
                File dir = new File(getCacheDir(), "photos"); dir.mkdirs();
                File f = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
                camUri = FileProvider.getUriForFile(this, "fr.stockinfos.app.photos", f);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, camUri);
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                cam.setClipData(ClipData.newRawUri("", camUri));
                if (p.isCaptureEnabled()) { startActivityForResult(cam, REQ_FILE); return; }
                chooser = Intent.createChooser(pick, "Choisir une photo");
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
            } catch (Exception e) { chooser = Intent.createChooser(pick, "Choisir un fichier"); }
        } else chooser = Intent.createChooser(pick, "Choisir un fichier");
        try { startActivityForResult(chooser, REQ_FILE); }
        catch (Exception e) { if (fileCb != null) { fileCb.onReceiveValue(null); fileCb = null; } }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == REQ_CAM_PERM && pendingParams != null) openChooser(pendingParams);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_FILE || fileCb == null) { super.onActivityResult(req, res, data); return; }
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0 && data.getData() == null && camUri == null) {
                ClipData c = data.getClipData(); out = new Uri[c.getItemCount()];
                for (int i = 0; i < c.getItemCount(); i++) out[i] = c.getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) out = new Uri[]{data.getData()};
            else if (camUri != null) out = new Uri[]{camUri};
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
    }

    @Override
    public void onBackPressed() {
        // Retour : ferme la fenêtre ouverte dans l'appli, sinon quitte
        web.evaluateJavascript("(function(){var m=document.querySelector('#modal .ov');if(m){var c=document.querySelector('#modal [data-act=close]');if(c){c.click();return 1}}return 0})()", v -> {
            if (!"1".equals(v)) MainActivity.super.onBackPressed();
        });
    }

    private void reply(String id, boolean ok, String payload) {
        String js = "window.__abReply(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(payload == null ? "" : payload) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    // ---- données locales ----
    private File dataFile() { return new File(getFilesDir(), "donnees.json"); }
    private SharedPreferences prefs() { return getSharedPreferences("base", MODE_PRIVATE); }
    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n);
        in.close(); return o.toString("UTF-8");
    }
    private String device() { return (Build.MANUFACTURER + " " + Build.MODEL).trim(); }

    // ---- base de données (même fonctionnement que sur le PC) ----
    private static final Pattern URL_OK = Pattern.compile("^https://[a-z0-9]+\\.supabase\\.co$");
    private JSONObject parseCode(String code) throws Exception {
        String c = code == null ? "" : code.trim();
        if (!c.startsWith("SI1.")) throw new Exception("code de connexion invalide");
        String json = new String(Base64.decode(c.substring(4), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8);
        JSONObject o = new JSONObject(json);
        if (!URL_OK.matcher(o.optString("u")).matches() || o.optString("a").isEmpty() || o.optString("k").isEmpty()) throw new Exception("code de connexion invalide");
        return o;
    }
    private JSONObject http(JSONObject cfg, String method, String path, String body, String prefer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(cfg.getString("u") + "/rest/v1/" + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000); c.setReadTimeout(30000);
        c.setRequestProperty("apikey", cfg.getString("a"));
        c.setRequestProperty("x-si-key", cfg.getString("k"));
        c.setRequestProperty("x-si-device", URLEncoder.encode(device(), "UTF-8"));
        c.setRequestProperty("Content-Type", "application/json");
        if (prefer != null && !prefer.isEmpty()) c.setRequestProperty("Prefer", prefer);
        if (body != null && !body.isEmpty()) {
            c.setDoOutput(true);
            try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int st = c.getResponseCode();
        InputStream in = st >= 400 ? c.getErrorStream() : c.getInputStream();
        String txt = in == null ? "" : readAll(in);
        JSONObject r = new JSONObject();
        r.put("status", st);
        Object json = JSONObject.NULL;
        try { if (!txt.isEmpty()) json = txt.trim().startsWith("[") ? new JSONArray(txt) : new JSONObject(txt); } catch (Exception ignored) {}
        r.put("json", json);
        return r;
    }

    class Bridge {
        @JavascriptInterface public String version() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; } }
        @JavascriptInterface public String load() {
            try { File f = dataFile(); return f.exists() ? readAll(new FileInputStream(f)) : ""; } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public boolean save(String json) {
            try {
                File tmp = new File(getFilesDir(), "donnees.json.tmp");
                try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
                return tmp.renameTo(dataFile());
            } catch (Exception e) { return false; }
        }
        @JavascriptInterface public String backup() {
            try {
                File dir = new File(getFilesDir(), "sauvegardes"); dir.mkdirs();
                String st = new SimpleDateFormat("yyyy-MM-dd-HH-mm", Locale.FRANCE).format(new Date());
                File t = new File(dir, "avant-suppression-" + st + ".json");
                if (dataFile().exists()) { try (InputStream i = new FileInputStream(dataFile()); OutputStream o = new FileOutputStream(t)) { byte[] b = new byte[16384]; int n; while ((n = i.read(b)) > 0) o.write(b, 0, n); } }
                File[] all = dir.listFiles(); if (all != null && all.length > 10) { Arrays.sort(all); for (int k = 0; k < all.length - 10; k++) all[k].delete(); }
                return t.getName();
            } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public String dbStatus() {
            try { JSONObject o = new JSONObject(); String c = prefs().getString("cfg", null); o.put("connected", c != null); o.put("device", device()); return o.toString(); } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public void dbDisconnect() { prefs().edit().remove("cfg").apply(); }
        @JavascriptInterface public void call(String id, String name, String arg) {
            pool.execute(() -> {
                try {
                    if ("dbConnect".equals(name)) {
                        JSONObject cfg = parseCode(arg);
                        JSONArray ping = new JSONArray().put(new JSONObject().put("kind", "setting").put("id", "_ping").put("data", new JSONObject().put("at", System.currentTimeMillis())));
                        JSONObject r = http(cfg, "POST", "si_items?on_conflict=kind,id", ping.toString(), "resolution=merge-duplicates,return=minimal");
                        int st = r.getInt("status");
                        if (st >= 300) throw new Exception(st == 401 || st == 403 ? "clé refusée par la base" : "base injoignable (" + st + ")");
                        prefs().edit().putString("cfg", cfg.toString()).apply();
                        reply(id, true, "true");
                    } else if ("dbReq".equals(name)) {
                        String c = prefs().getString("cfg", null);
                        if (c == null) throw new Exception("base non connectée");
                        JSONObject o = new JSONObject(arg);
                        String method = o.optString("method", "GET").toUpperCase(Locale.ROOT), path = o.optString("path", "");
                        if (!(method.equals("GET") || method.equals("POST")) || !path.matches("^si_(items|audit)(\\?.*)?$")) throw new Exception("appel refusé");
                        Object body = o.opt("body");
                        JSONObject r = http(new JSONObject(c), method, path, body == null || body == JSONObject.NULL ? null : body.toString(), o.optString("prefer", null));
                        reply(id, true, r.toString());
                    } else throw new Exception("action inconnue");
                } catch (Exception e) { reply(id, false, e.getMessage() == null ? "erreur" : e.getMessage()); }
            });
        }
    }
}
