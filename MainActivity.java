package vn.trolylaixe.app;

import android.Manifest;
import android.app.Activity;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity implements TextToSpeech.OnInitListener {

    private static final int REQ_VOICE = 100;
    private static final int REQ_PERM = 200;

    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private float speechRate = 1.0f;
    private AudioManager audio;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("settings", MODE_PRIVATE);
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0F14);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:")) return false;
                openExternal(url);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);

        tts = new TextToSpeech(this, this);

        if (Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM);
        }
    }

    // ---------- Text to speech ----------
    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) {
            js("App.onTtsReady(false)");
            return;
        }
        int r = tts.setLanguage(new Locale("vi", "VN"));
        ttsReady = true;
        tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        tts.setSpeechRate(speechRate);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) {
                releaseFocus();
                js("App.onSpeakDone(" + JSONObject.quote(id) + ")");
            }
            @Override public void onError(String id) {
                releaseFocus();
                js("App.onSpeakDone(" + JSONObject.quote(id) + ")");
            }
        });
        boolean viOk = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
        js("App.onTtsReady(" + viOk + ")");
    }

    @SuppressWarnings("deprecation")
    private void grabFocus() {
        if (audio != null) audio.requestAudioFocus(null, AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
    }

    @SuppressWarnings("deprecation")
    private void releaseFocus() {
        if (audio != null) audio.abandonAudioFocus(null);
    }

    // ---------- Helpers ----------
    private void js(final String code) {
        ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    private boolean tryStart(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private void openExternal(String url) {
        if (!tryStart(new Intent(Intent.ACTION_VIEW, Uri.parse(url)))) {
            toast("Không mở được liên kết");
        }
    }

    private void toast(final String msg) {
        ui.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    private void http(final String method, final String url, final String headersJson,
                      final String body, final String cbId) {
        pool.execute(() -> {
            int code = 0;
            String text;
            try {
                String target = url;
                HttpURLConnection c = null;
                for (int hop = 0; hop < 5; hop++) {
                    c = (HttpURLConnection) new URL(target).openConnection();
                    c.setInstanceFollowRedirects(true);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(60000);
                    c.setRequestMethod(method);
                    c.setRequestProperty("User-Agent",
                            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
                    if (headersJson != null && headersJson.length() > 2) {
                        JSONObject h = new JSONObject(headersJson);
                        Iterator<String> keys = h.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            c.setRequestProperty(k, h.getString(k));
                        }
                    }
                    if (body != null && "POST".equals(method)) {
                        c.setDoOutput(true);
                        OutputStream os = c.getOutputStream();
                        os.write(body.getBytes(StandardCharsets.UTF_8));
                        os.close();
                    }
                    code = c.getResponseCode();
                    if ((code == 301 || code == 302 || code == 307 || code == 308) && "GET".equals(method)) {
                        String loc = c.getHeaderField("Location");
                        if (loc == null) break;
                        target = new URL(new URL(target), loc).toString();
                        c.disconnect();
                        continue;
                    }
                    break;
                }
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                text = readAll(in);
                c.disconnect();
            } catch (Exception e) {
                text = "ERROR: " + e.getMessage();
            }
            js("App.onHttp(" + JSONObject.quote(cbId) + "," + code + "," + JSONObject.quote(text) + ")");
        });
    }

    // ---------- Voice input result ----------
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_VOICE) return;
        String text = null;
        if (resultCode == RESULT_OK && data != null) {
            ArrayList<String> res = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (res != null && !res.isEmpty()) text = res.get(0);
        }
        js("App.onVoice(" + (text == null ? "null" : JSONObject.quote(text)) + ")");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        js("App.onPermission && App.onPermission()");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("App.onBack()", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        pool.shutdownNow();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ---------- Bridge exposed to the web UI as window.Android ----------
    public class Bridge {

        @JavascriptInterface
        public boolean isTtsReady() { return ttsReady; }

        @JavascriptInterface
        public void speak(String text, String id, boolean flush) {
            if (!ttsReady || text == null) {
                js("App.onSpeakDone(" + JSONObject.quote(id) + ")");
                return;
            }
            grabFocus();
            Bundle b = new Bundle();
            tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, b, id);
        }

        @JavascriptInterface
        public void stopSpeak() {
            if (tts != null) tts.stop();
            releaseFocus();
        }

        @JavascriptInterface
        public void setSpeechRate(float rate) {
            speechRate = rate;
            if (tts != null) tts.setSpeechRate(rate);
        }

        @JavascriptInterface
        public void listen(final String prompt) {
            ui.post(() -> {
                if (tts != null) tts.stop();
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "vi-VN");
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "vi-VN");
                i.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt == null ? "Mời bạn nói..." : prompt);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                try {
                    startActivityForResult(i, REQ_VOICE);
                } catch (ActivityNotFoundException e) {
                    toast("Máy chưa có dịch vụ nhận giọng nói (cần ứng dụng Google)");
                    js("App.onVoice(null)");
                }
            });
        }

        @JavascriptInterface
        public void httpGet(String url, String cbId) { http("GET", url, null, null, cbId); }

        @JavascriptInterface
        public void httpPost(String url, String headersJson, String body, String cbId) {
            http("POST", url, headersJson, body, cbId);
        }

        @JavascriptInterface
        public String getPref(String key) { return prefs.getString(key, ""); }

        @JavascriptInterface
        public void setPref(String key, String value) { prefs.edit().putString(key, value).apply(); }

        @JavascriptInterface
        @SuppressWarnings({"MissingPermission", "deprecation"})
        public void getLocation(final String cbId) {
            ui.post(() -> {
                if (Build.VERSION.SDK_INT >= 23
                        && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                        && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM);
                    js("App.onLocation(" + JSONObject.quote(cbId) + ",null,null)");
                    return;
                }
                final LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                Location best = null;
                try {
                    for (String p : lm.getProviders(true)) {
                        Location l = lm.getLastKnownLocation(p);
                        if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                    }
                } catch (Exception ignored) { }
                if (best != null && System.currentTimeMillis() - best.getTime() < 10 * 60 * 1000) {
                    js("App.onLocation(" + JSONObject.quote(cbId) + "," + best.getLatitude() + "," + best.getLongitude() + ")");
                    return;
                }
                final Location fallback = best;
                final boolean[] done = {false};
                final LocationListener listener = new LocationListener() {
                    @Override public void onLocationChanged(Location l) {
                        if (done[0]) return;
                        done[0] = true;
                        lm.removeUpdates(this);
                        js("App.onLocation(" + JSONObject.quote(cbId) + "," + l.getLatitude() + "," + l.getLongitude() + ")");
                    }
                    @Override public void onStatusChanged(String p, int s, Bundle b) { }
                    @Override public void onProviderEnabled(String p) { }
                    @Override public void onProviderDisabled(String p) { }
                };
                try {
                    if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                        lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0, 0, listener, Looper.getMainLooper());
                    if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0, 0, listener, Looper.getMainLooper());
                } catch (Exception ignored) { }
                ui.postDelayed(() -> {
                    if (done[0]) return;
                    done[0] = true;
                    lm.removeUpdates(listener);
                    if (fallback != null)
                        js("App.onLocation(" + JSONObject.quote(cbId) + "," + fallback.getLatitude() + "," + fallback.getLongitude() + ")");
                    else
                        js("App.onLocation(" + JSONObject.quote(cbId) + ",null,null)");
                }, 15000);
            });
        }

        @JavascriptInterface
        public void navigateTo(String destination) {
            Intent i = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("google.navigation:q=" + Uri.encode(destination) + "&mode=d"));
            i.setPackage("com.google.android.apps.maps");
            if (!tryStart(i)) {
                if (!tryStart(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(destination))))) {
                    openExternal("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + Uri.encode(destination));
                }
            }
        }

        @JavascriptInterface
        public void navigateLatLng(double lat, double lng) {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + lat + "," + lng + "&mode=d"));
            i.setPackage("com.google.android.apps.maps");
            if (!tryStart(i)) {
                openExternal("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + lat + "," + lng);
            }
        }

        @JavascriptInterface
        public void searchNearby(String what) {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(what)));
            i.setPackage("com.google.android.apps.maps");
            if (!tryStart(i)) {
                if (!tryStart(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(what))))) {
                    openExternal("https://www.google.com/maps/search/" + Uri.encode(what));
                }
            }
        }

        @JavascriptInterface
        public void dial(String number) {
            tryStart(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number))));
        }

        @JavascriptInterface
        public void playMusic(String query) {
            Intent i = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
            i.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
            i.putExtra(SearchManager.QUERY, query);
            if (!tryStart(i)) {
                openExternal("https://www.youtube.com/results?search_query=" + Uri.encode(query));
            }
        }

        @JavascriptInterface
        public void openUrl(String url) { openExternal(url); }

        @JavascriptInterface
        public void toastMsg(String msg) { toast(msg); }
    }
}
