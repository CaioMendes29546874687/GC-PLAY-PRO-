plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android { namespace="com.gcplaypro.player"; compileSdk=35
    defaultConfig { applicationId="com.gcplaypro.player"; minSdk=23; targetSdk=35; versionCode=1; versionName="0.1.0" }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("org.videolan.android:libvlc-all:3.6.0")
}
