plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.naod6473.ondine.portal"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.naod6473.ondine.portal"
        // Le Portal Mini est sous Android 10.
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        // Le Portal est en ARM : pas besoin des bibliothèques x86 (l'APK fond de moitié).
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    // Une clé de test, fixe et versionnée (branche personnelle) : chaque
    // nouvel APK peut ainsi remplacer le précédent sans perdre les réglages.
    // Pas une clé de publication.
    signingConfigs {
        create("test") {
            storeFile = rootProject.file("signature-test.jks")
            storePassword = "ondine-portal"
            keyAlias = "ondine"
            keyPassword = "ondine-portal"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("test")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // Les modèles .onnx ne doivent pas être compressés (lus tels quels).
    androidResources {
        noCompress += listOf("onnx", "txt")
    }
}

dependencies {
    // sherpa-onnx (voix → texte), téléchargé par scripts/prepare.sh.
    implementation(files("libs/sherpa-onnx.aar"))
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
