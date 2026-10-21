// Ondine Portal : la petite Ondine pour un Meta Portal (Android 10).
// Projet à part, sur la branche ondine-portal, jamais fusionné dans main.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "ondine-portal"
include(":app")
