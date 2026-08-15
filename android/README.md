# ShaLom Admin Android app

Private Android app for changing the warning feature and per-guild cut scores.

The app reads `warning-admin-token.properties` during builds. That ignored file must contain the same
`WARNING_ADMIN_TOKEN` value configured on the `shalom-staff` Netlify site.

Build prerequisites are Android SDK 35, JDK 17, and Gradle 8.9.
