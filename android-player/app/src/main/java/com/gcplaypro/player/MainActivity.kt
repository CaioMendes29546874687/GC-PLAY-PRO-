package com.gcplaypro.player

import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer

class MainActivity : AppCompatActivity() {
    private var exo: ExoPlayer? = null
    private var vlc: MediaPlayer? = null
    private var libvlc: LibVLC? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(com.gcplaypro.player.R.layout.activity_main)
    }

    fun playWithMedia3(url: String) {
        stopVlc()
        if (exo == null) {
            exo = ExoPlayer.Builder(this).build()
            findViewById<PlayerView>(R.id.media3View).player = exo
        }
        exo!!.setMediaItem(MediaItem.fromUri(Uri.parse(url)))
        exo!!.prepare()
        exo!!.play()
    }

    fun playWithVlc(url: String) {
        exo?.stop()
        exo?.clearMediaItems()
        if (libvlc == null) libvlc = LibVLC(this, arrayListOf("--network-caching=1000"))
        if (vlc == null) vlc = MediaPlayer(libvlc)
        val media = Media(libvlc, Uri.parse(url))
        vlc!!.media = media
        media.release()
        vlc!!.play()
    }

    private fun stopVlc() { vlc?.stop() }
    override fun onDestroy() {
        exo?.release()
        vlc?.release()
        libvlc?.release()
        super.onDestroy()
    }
}
