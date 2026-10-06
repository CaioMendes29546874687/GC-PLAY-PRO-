plugins {
    id("com.android.application")
}

android {
    namespace = "com.gcplaypro.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.gcplaypro.android"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        buildConfigField("String", "WEB_APP_URL", ""https://caiomendes29546874687.github.io/GC-PLAY-PRO-/"")
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
    implementation("androidx.webkit:webkit:1.14.0")
}
