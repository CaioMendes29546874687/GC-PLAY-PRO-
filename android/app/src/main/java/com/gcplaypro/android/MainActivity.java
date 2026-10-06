package com.gcplaypro.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import java.util.Locale;

@UnstableApi
public class MainActivity extends Activity {
    private WebView webView;
    private PlayerView playerView;
    private TextView playerError;
    private ExoPlayer player;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        playerView = findViewById(R.id.playerView);
        playerError = findViewById(R.id.playerError);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new GCPlayerBridge(), "AndroidGCPlayer");
        webView.loadUrl(BuildConfig.WEB_APP_URL);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        player.addListener(new androidx.media3.common.Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                showPlayerError("ERRO NATIVO: " + error.errorCodeName);
                notifyWeb("nativeError", error.errorCodeName);
            }

            @Override public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    playerError.setVisibility(View.GONE);
                    notifyWeb("nativePlaying", "");
                }
            }
        });
    }

    private void playNative(String url, String title, String type) {
        runOnUiThread(() -> {
            playerError.setVisibility(View.GONE);
            playerView.setVisibility(View.VISIBLE);

            String lower = url.toLowerCase(Locale.US);
            MediaItem.Builder media = new MediaItem.Builder()
                    .setUri(url)
                    .setMediaId(title == null ? "" : title);

            if (lower.contains(".m3u8")) {
                media.setMimeType(MimeTypes.APPLICATION_M3U8);
            } else if (lower.contains(".mpd")) {
                media.setMimeType(MimeTypes.APPLICATION_MPD);
            } else if (lower.contains(".mp4")) {
                media.setMimeType(MimeTypes.VIDEO_MP4);
            }

            player.setMediaItem(media.build());
            player.prepare();
            player.play();
        });
    }

    private void stopNative() {
        runOnUiThread(() -> {
            player.stop();
            playerView.setVisibility(View.GONE);
            playerError.setVisibility(View.GONE);
        });
    }

    private void showPlayerError(String message) {
        playerView.setVisibility(View.VISIBLE);
        playerError.setText(message);
        playerError.setVisibility(View.VISIBLE);
    }

    private void notifyWeb(String event, String value) {
        if (webView == null) return;
        String safeEvent = event.replace("'", "\\'");
        String safeValue = value == null ? "" : value.replace("\\", "\\\\").replace("'", "\\'");
        webView.post(() -> webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('gc-native-player',{detail:{event:'" +
                        safeEvent + "',value:'" + safeValue + "'}}));", null));
    }

    @Override
    protected void onDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    public class GCPlayerBridge {
        @JavascriptInterface
        public void play(String url, String title, String type) {
            if (url == null || url.trim().isEmpty()) return;
            playNative(url, title, type);
        }

        @JavascriptInterface
        public void stop() {
            stopNative();
        }

        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }
    }
}
