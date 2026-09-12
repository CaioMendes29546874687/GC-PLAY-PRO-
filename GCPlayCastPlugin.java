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
    // ABRIR SELEÇÃO DE TV / CHROMECAST
    // ============================================================

    @PluginMethod
    public void openCastDialog(PluginCall call) {

        Activity activity = getActivity();

        if (activity == null) {
            call.reject("Atividade Android indisponível.");
            return;
        }

        activity.runOnUiThread(() -> {

            try {

                CastContext castContext =
                    CastContext.getSharedInstance(activity);

                FrameLayout root =
                    activity.findViewById(android.R.id.content);

                if (root == null) {
                    call.reject("Tela principal do aplicativo não encontrada.");
                    return;
                }

                /*
                 * Criamos um MediaRouteButton REAL.
                 *
                 * Ele fica invisível para o usuário,
                 * mas é registrado pelo Google Cast.
                 */

                final MediaRouteButton button =
                    new MediaRouteButton(activity);

                button.setBackgroundColor(Color.TRANSPARENT);
                button.setVisibility(View.VISIBLE);

                FrameLayout.LayoutParams params =
                    new FrameLayout.LayoutParams(
                        80,
                        80
                    );

                params.leftMargin = 5;
                params.topMargin = 5;

                root.addView(button, params);

                /*
                 * Liga o botão ao Google Cast.
                 */

                CastButtonFactory
                    .setUpMediaRouteButton(
                        activity.getApplicationContext(),
                        button
                    );

                /*
                 * Dá tempo para o MediaRouter
                 * terminar a inicialização.
                 */

                button.postDelayed(() -> {

                    try {

                        boolean clicou =
                            button.performClick();

                        if (!clicou) {

                            /*
                             * Segunda tentativa.
                             */

                            button.postDelayed(
                                () -> {
                                    try {
                                        button.performClick();
                                    } catch (Exception ignored) {
                                    }
                                },
                                300
                            );
                        }

                    } catch (Exception e) {

                        call.reject(
                            "Erro ao abrir seleção de TV: "
                            + e.getMessage()
                        );

                    }

                }, 500);


                /*
                 * Mantém o botão durante alguns segundos
                 * para o diálogo do Google Cast abrir.
                 */

                root.postDelayed(
                    () -> {

                        try {
                            root.removeView(button);
                        } catch (Exception ignored) {
                        }

                    },
                    5000
                );


                /*
                 * Verifica se já existe sessão.
                 */

                CastSession session =
                    castContext
                        .getSessionManager()
                        .getCurrentCastSession();

                JSObject result =
                    new JSObject();

                result.put(
                    "connected",
                    session != null &&
                    session.isConnected()
                );

                result.put(
                    "status",
                    "CAST_DIALOG_REQUESTED"
                );

                call.resolve(result);


            } catch (Exception e) {

                call.reject(
                    "Não foi possível abrir a seleção de TV: "
                    + e.getMessage()
                );

            }

        });

    }


    // ============================================================
    // TRANSMITIR MÍDIA
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


        if (
            url == null ||
            url.trim().isEmpty()
        ) {

            call.reject(
                "URL da mídia não informada."
            );

            return;
        }


        Activity activity =
            getActivity();


        if (activity == null) {

            call.reject(
                "Atividade Android indisponível."
            );

            return;
        }


        activity.runOnUiThread(() -> {

            try {

                CastContext castContext =
                    CastContext.getSharedInstance(
                        activity
                    );


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
                        + "Abra Transmitir e escolha sua TV.",
                        "NO_CAST_SESSION"
                    );

                    return;
                }


                RemoteMediaClient client =
                    session.getRemoteMediaClient();


                if (client == null) {

                    call.reject(
                        "Controle de mídia do Google Cast indisponível."
                    );

                    return;
                }


                // =================================================
                // METADADOS
                // =================================================

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


                // =================================================
                // MEDIA INFO
                // =================================================

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


                // =================================================
                // ENVIAR PARA TV
                // =================================================

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

                                ret.put(
                                    "status",
                                    "PLAYING"
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


                                call.reject(message);

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
    // DETECTAR LIVE
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
