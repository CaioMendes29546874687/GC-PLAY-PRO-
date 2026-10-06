# GC PLAY PRO — Dual Media Engine

Android/Android TV native player module.

- **Media3/ExoPlayer**: primary engine for HLS, DASH, fMP4/CMAF and standard streams.
- **libVLC**: fallback engine for streams that Media3 cannot decode/play.
- FFmpeg is intentionally not used as the primary player; codecs/demuxing remain delegated to the engines.

Next integration step: connect the existing GC catalog/activation layer to this native playback module and add automatic engine fallback based on Media3 playback errors.
