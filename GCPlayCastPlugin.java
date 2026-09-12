package __PACKAGE__;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.mediarouter.app.MediaRouteButton;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
    public void ping(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("plugin", "GCPlayCast");
        ret.put("message", "Google Cast plugin ativo");
        call.resolve(ret);
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        try {
            Activity activity = getActivity();
            if (activity == null) {
                call.reject("Atividade Android indisponível.");
                return;
            }

            CastContext context = CastContext.getSharedInstance(activity);
            CastSession session = context.getSessionManager().getCurrentCastSession();

            JSObject ret = new JSObject();
            ret.put("connected", session != null && session.isConnected());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Erro ao consultar sessão Cast: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openCastDialog(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Atividade Android indisponível.");
            return;
        }

        activity.runOnUiThread(() -> {
            MediaRouteButton button = null;
            try {
                CastContext.getSharedInstance(activity);

                Toast.makeText(
                    activity,
                    "Procurando Chromecast / Google TV...",
                    Toast.LENGTH_SHORT
                ).show();

                FrameLayout root = activity.findViewById(android.R.id.content);
                if (root == null) {
                    call.reject("Tela principal não encontrada.");
                    return;
                }

                button = new MediaRouteButton(activity);
                button.setVisibility(View.VISIBLE);
                button.setBackgroundColor(Color.TRANSPARENT);
                button.setContentDescription("Transmitir para TV");

                FrameLayout.LayoutParams params =
                    new FrameLayout.LayoutParams(72, 72);
                params.leftMargin = 8;
                params.topMargin = 8;

                root.addView(button, params);

                CastButtonFactory.setUpMediaRouteButton(
                    activity.getApplicationContext(),
                    button
                );

                final MediaRouteButton finalButton = button;

                finalButton.postDelayed(() -> {
                    try {
                        boolean clicked = finalButton.performClick();
                        if (!clicked) {
                            Toast.makeText(
                                activity,
                                "Botão Google Cast não foi inicializado.",
                                Toast.LENGTH_SHORT
                            ).show();
                        }
                    } catch (Exception e) {
                        Toast.makeText(
                            activity,
                            "Erro Google Cast: " + e.getMessage(),
                            Toast.LENGTH_LONG
                        ).show();
                    }
                }, 800);

                root.postDelayed(() -> {
                    try {
                        root.removeView(finalButton);
                    } catch (Exception ignored) {
                    }
                }, 8000);

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("status", "CAST_DIALOG_REQUESTED");
                call.resolve(ret);

            } catch (Exception e) {
                call.reject("Não foi possível abrir o Google Cast: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void cast(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "GC PLAY PRO");
        String subtitle = call.getString("subtitle", "");
        String contentType = call.getString("contentType", "video/mp4");

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
                CastContext context = CastContext.getSharedInstance(activity);
                CastSession session = context.getSessionManager().getCurrentCastSession();

                if (session == null || !session.isConnected()) {
                    call.reject(
                        "Nenhuma TV/Chromecast conectado. Escolha uma TV primeiro.",
                        "NO_CAST_SESSION"
                    );
                    return;
                }

                RemoteMediaClient client = session.getRemoteMediaClient();
                if (client == null) {
                    call.reject("Controle de mídia do Cast indisponível.");
                    return;
                }

                MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
                metadata.putString(MediaMetadata.KEY_TITLE, title);

                if (subtitle != null && !subtitle.isEmpty()) {
                    metadata.putString(MediaMetadata.KEY_SUBTITLE, subtitle);
                }

                MediaInfo info = new MediaInfo.Builder(url)
                    .setStreamType(isLive(contentType)
                        ? MediaInfo.STREAM_TYPE_LIVE
                        : MediaInfo.STREAM_TYPE_BUFFERED)
                    .setContentType(normalizeContentType(contentType))
                    .setMetadata(metadata)
                    .build();

                client.load(
                    new MediaLoadRequestData.Builder()
                        .setMediaInfo(info)
                        .setAutoplay(true)
                        .build()
                ).setResultCallback(result -> {
                    if (result.getStatus().isSuccess()) {
                        JSObject ret = new JSObject();
                        ret.put("connected", true);
                        ret.put("playing", true);
                        ret.put("title", title);
                        ret.put("url", url);
                        call.resolve(ret);
                    } else {
                        String msg = result.getStatus().getStatusMessage();
                        if (msg == null || msg.isEmpty()) {
                            msg = "A TV recusou a mídia.";
                        }
                        call.reject(msg);
                    }
                });

            } catch (Exception e) {
                call.reject("Erro ao transmitir: " + e.getMessage());
            }
        });
    }

    private boolean isLive(String type) {
        if (type == null) return false;
        String t = type.toLowerCase();
        return t.contains("mpegurl") || t.contains("mpeg") ||
               t.contains("hls") || t.contains("live");
    }

    private String normalizeContentType(String type) {
        if (type == null || type.trim().isEmpty()) return "video/mp4";
        if (type.equalsIgnoreCase("application/vnd.apple.mpegurl") ||
            type.equalsIgnoreCase("application/mpegurl")) {
            return "application/x-mpegURL";
        }
        return type;
    }
}
