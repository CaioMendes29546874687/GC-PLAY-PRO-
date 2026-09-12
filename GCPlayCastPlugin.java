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

import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;

import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;

import com.google.android.gms.cast.framework.media.RemoteMediaClient;


@CapacitorPlugin(name = "GCPlayCast")
public class GCPlayCastPlugin extends Plugin {


    // ============================================================
    // ABRIR SELETOR DE TV / CHROMECAST
    // ============================================================

    @PluginMethod
    public void openCastDialog(PluginCall call) {

        Activity activity = getActivity();

        if (activity == null) {
            call.reject(
                "Atividade Android indisponível."
            );
            return;
        }


        activity.runOnUiThread(() -> {

            try {

                // Inicializa o Cast Framework
                CastContext.getSharedInstance(activity);


                // Root da Activity
                FrameLayout root =
                    activity.findViewById(
                        android.R.id.content
                    );


                // Cria botão Cast invisível
                // que será usado para abrir o diálogo
                final MediaRouteButton button =
                    new MediaRouteButton(activity);


                button.setBackgroundColor(
                    Color.TRANSPARENT
                );


                button.setVisibility(
                    View.VISIBLE
                );


                // Botão praticamente invisível.
                // Ele existe apenas para disparar
                // o diálogo oficial do Google Cast.
                FrameLayout.LayoutParams params =
                    new FrameLayout.LayoutParams(
                        1,
                        1
                    );


                params.leftMargin = 1;
                params.topMargin = 1;


                root.addView(
                    button,
                    params
                );


                // Conecta o botão ao Google Cast
                CastButtonFactory
                    .setUpMediaRouteButton(
                        activity.getApplicationContext(),
                        button
                    );


                // Abre o diálogo
                button.post(() -> {

                    button.performClick();


                    // Remove o botão depois
                    // que o diálogo foi aberto.
                    root.postDelayed(
                        () -> {

                            try {
                                root.removeView(button);
                            } catch (Exception ignored) {
                            }

                        },
                        1500
                    );

                });


                call.resolve();


            } catch (Exception e) {

                call.reject(
                    "Não foi possível abrir "
                    + "a seleção de TV: "
                    + e.getMessage()
                );

            }

        });

    }


    // ============================================================
    // TRANSMITIR MÍDIA PARA A TV
    // ============================================================

    @PluginMethod
    public void cast(PluginCall call) {

        String url =
            call.getString("url");

        String title =
            call.getString(
                "title",
                "GC PLAY PRO"
            );

        String subtitle =
            call.getString(
                "subtitle",
                ""
            );

        String contentType =
            call.getString(
                "contentType",
                "video/mp4"
            );


        // --------------------------------------------------------
        // VALIDAR URL
        // --------------------------------------------------------

        if (
            url == null ||
            url.trim().isEmpty()
        ) {

            call.reject(
                "URL da mídia não informada."
            );

            return;
        }


        // --------------------------------------------------------
        // ACTIVITY
        // --------------------------------------------------------

        Activity activity =
            getActivity();

        if (activity == null) {

            call.reject(
                "Atividade Android indisponível."
            );

            return;
        }


        // --------------------------------------------------------
        // EXECUTAR NA THREAD PRINCIPAL
        // --------------------------------------------------------

        activity.runOnUiThread(() -> {

            try {

                // ------------------------------------------------
                // CAST CONTEXT
                // ------------------------------------------------

                CastContext castContext =
                    CastContext.getSharedInstance(
                        activity
                    );


                // ------------------------------------------------
                // SESSÃO ATUAL
                // ------------------------------------------------

                CastSession session =
                    castContext
                        .getSessionManager()
                        .getCurrentCastSession();


                if (
                    session == null ||
                    !session.isConnected()
                ) {

                    call.reject(
                        "Nenhuma TV/Chromecast conectado. "
                        + "Toque em Transmitir e escolha sua TV.",
                        "NO_CAST_SESSION"
                    );

                    return;
                }


                // ------------------------------------------------
                // REMOTE MEDIA CLIENT
                // ------------------------------------------------

                RemoteMediaClient client =
                    session.getRemoteMediaClient();


                if (client == null) {

                    call.reject(
                        "Controle de mídia do Cast indisponível."
                    );

                    return;
                }


                // ------------------------------------------------
                // METADATA
                // ------------------------------------------------

                MediaMetadata metadata =
                    new MediaMetadata(
                        MediaMetadata.MEDIA_TYPE_MOVIE
                    );


                metadata.putString(
                    MediaMetadata.KEY_TITLE,
                    title
                );


                if (
                    subtitle != null &&
                    !subtitle.isEmpty()
                ) {

                    metadata.putString(
                        MediaMetadata.KEY_SUBTITLE,
                        subtitle
                    );

                }


                // ------------------------------------------------
                // MEDIA INFO
                // ------------------------------------------------

                MediaInfo mediaInfo =
                    new MediaInfo.Builder(url)

                        .setStreamType(
                            isLive(contentType)
                                ? MediaInfo.STREAM_TYPE_LIVE
                                : MediaInfo.STREAM_TYPE_BUFFERED
                        )

                        .setContentType(
                            normalizeContentType(
                                contentType
                            )
                        )

                        .setMetadata(
                            metadata
                        )

                        .build();


                // ------------------------------------------------
                // ENVIAR PARA O CHROMECAST
                // ------------------------------------------------

                client
                    .load(
                        new MediaLoadRequestData.Builder()
                            .setMediaInfo(mediaInfo)
                            .setAutoplay(true)
                            .build()
                    )

                    .setResultCallback(
                        result -> {

                            if (
                                result
                                    .getStatus()
                                    .isSuccess()
                            ) {

                                JSObject ret =
                                    new JSObject();

                                ret.put(
                                    "connected",
                                    true
                                );

                                ret.put(
                                    "title",
                                    title
                                );

                                ret.put(
                                    "url",
                                    url
                                );

                                call.resolve(ret);

                            } else {

                                String message =
                                    result
                                        .getStatus()
                                        .getStatusMessage();

                                if (
                                    message == null ||
                                    message.isEmpty()
                                ) {

                                    message =
                                        "A TV recusou a mídia.";

                                }

                                call.reject(
                                    message
                                );

                            }

                        }
                    );


            } catch (Exception e) {

                call.reject(
                    "Erro ao transmitir: "
                    + e.getMessage()
                );

            }

        });

    }


    // ============================================================
    // IDENTIFICAR LIVE / HLS
    // ============================================================

    private boolean isLive(
        String type
    ) {

        if (type == null) {
            return false;
        }

        String t =
            type.toLowerCase();

        return
            t.contains("mpegurl") ||
            t.contains("mpeg") ||
            t.contains("hls") ||
            t.contains("live");

    }


    // ============================================================
    // NORMALIZAR CONTENT TYPE
    // ============================================================

    private String normalizeContentType(
        String type
    ) {

        if (
            type == null ||
            type.trim().isEmpty()
        ) {

            return "video/mp4";

        }


        if (
            type.equalsIgnoreCase(
                "application/vnd.apple.mpegurl"
            )
        ) {

            return "application/x-mpegURL";

        }


        if (
            type.equalsIgnoreCase(
                "application/mpegurl"
            )
        ) {

            return "application/x-mpegURL";

        }


        return type;

    }

}
