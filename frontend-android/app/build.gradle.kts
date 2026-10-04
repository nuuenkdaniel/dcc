import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
val releaseFile = File(System.getProperty("user.home"), ".local/share/dcc-signing/signing.properties")
val releaseSecrets = Properties().apply { if (releaseFile.isFile) releaseFile.inputStream().use { load(it) } }
gradle.taskGraph.whenReady {
    if (allTasks.any { it.name.contains("Release") }) check(releaseFile.isFile) { "Release signing is not configured. See RELEASE.md." }
}
android {
    namespace = "online.captnuu.dcc"
    compileSdk = 35
    defaultConfig {
        applicationId = "online.captnuu.dcc"
        minSdk = 26
        targetSdk = 35
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = 2
        versionName = "0.2.0"
    }
    signingConfigs {
        if (releaseFile.isFile) create("release") {
            storeFile = file(releaseSecrets.getProperty("storeFile"))
            storePassword = releaseSecrets.getProperty("storePassword")
            keyAlias = releaseSecrets.getProperty("keyAlias")
            keyPassword = releaseSecrets.getProperty("keyPassword")
        }
    }
    buildTypes { getByName("release") { if (releaseFile.isFile) signingConfig = signingConfigs.getByName("release") } }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.compose.material:material-icons-core")
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
