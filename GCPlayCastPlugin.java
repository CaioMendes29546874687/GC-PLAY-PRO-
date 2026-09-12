package __PACKAGE__;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.widget.FrameLayout;

import androidx.mediarouter.app.MediaRouteButton;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;

@CapacitorPlugin(name = "GCPlayCast")
public class GCPlayCastPlugin extends Plugin {

    @PluginMethod
    public void openCastDialog(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Atividade Android indisponível.");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                CastContext.getSharedInstance(activity);

                FrameLayout root = activity.findViewById(android.R.id.content);
                final MediaRouteButton button = new MediaRouteButton(activity);
                button.setRouteTypes(androidx.mediarouter.media.MediaRouter.ROUTE_TYPE_LIVE_VIDEO);
                button.setBackgroundColor(Color.TRANSPARENT);
                button.setVisibility(View.VISIBLE);

                FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(1, 1);
                params.leftMargin = 1;
                params.topMargin = 1;
                root.addView(button, params);
                CastButtonFactory.setUpMediaRouteButton(activity.getApplicationContext(), button);

                button.post(() -> {
                    button.performClick();
                    root.postDelayed(() -> root.removeView(button), 1200);
                });

                call.resolve();
            } catch (Exception e) {
                call.reject("Não foi possível abrir a seleção de TV: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void cast(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "GC PLAY PRO");
        String subtitle = call.getString("subtitle", "");
        String contentType = call.getString("contentType", "video/mp4");
        String image = call.getString("image", "");

        if (url == null || url.trim().isEmpty()) {
            call.reject("URL da mídia não informada.");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Atividade Android indisponível.");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                CastContext castContext = CastContext.getSharedInstance(activity);
                CastSession session = castContext.getSessionManager().getCurrentCastSession();

                if (session == null || !session.isConnected()) {
                    call.reject("Nenhuma TV/Chromecast conectado. Toque em Transmitir e escolha sua TV.", "NO_CAST_SESSION");
                    return;
                }

                RemoteMediaClient client = session.getRemoteMediaClient();
                if (client == null) {
                    call.reject("Controle de mídia do Cast indisponível.");
                    return;
                }

                MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
                metadata.putString(MediaMetadata.KEY_TITLE, title);
                if (!subtitle.isEmpty()) {
                    metadata.putString(MediaMetadata.KEY_SUBTITLE, subtitle);
                }

                MediaInfo mediaInfo = new MediaInfo.Builder(url)
                        .setStreamType(isLive(contentType) ? MediaInfo.STREAM_TYPE_LIVE : MediaInfo.STREAM_TYPE_BUFFERED)
                        .setContentType(normalizeContentType(contentType))
                        .setMetadata(metadata)
                        .build();

                client.load(new MediaLoadRequestData.Builder()
                        .setMediaInfo(mediaInfo)
                        .setAutoplay(true)
                        .build())
                        .setResultCallback(result -> {
                            if (result.getStatus().isSuccess()) {
                                JSObject ret = new JSObject();
                                ret.put("connected", true);
                                ret.put("title", title);
                                call.resolve(ret);
                            } else {
                                call.reject("A TV recusou a mídia: " + result.getStatus().getStatusMessage());
                            }
                        });
            } catch (Exception e) {
                call.reject("Erro ao transmitir: " + e.getMessage());
            }
        });
    }

    private boolean isLive(String type) {
        String t = type == null ? "" : type.toLowerCase();
        return t.contains("mpegurl") || t.contains("mpeg") || t.contains("live");
    }

    private String normalizeContentType(String type) {
        if (type == null || type.trim().isEmpty()) return "video/mp4";
        if (type.equalsIgnoreCase("application/vnd.apple.mpegurl")) return "application/x-mpegURL";
        return type;
    }
}
