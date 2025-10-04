# Top-Down Racer (Android-ready)

This project now includes basic Android compatibility via PWA features, touch controls, motion steering, and a service worker for installability/offline.

What’s included
- Touch HUD: On-screen buttons for throttle/brake and left/right
- Motion steering: DeviceOrientation-based analog steering (enabled after first tap)
- Auto audio unlock on first interaction (WebAudio)
- Pause when app/tab hidden
- Optional Screen Wake Lock (keeps the display on while playing)
- PWA manifest + service worker

How to run locally (Windows PowerShell)
1. Serve the folder over HTTP (service workers need http/https). You can use Python or Node.

   Python 3:
   ```powershell
   python -m http.server 8080
   ```

   Node (if you have `npx`):
   ```powershell
   npx http-server -p 8080 .
   ```

2. Open http://localhost:8080/racer_start_menu.html in Chrome on desktop or on your Android device (same network).

Android install (PWA)
- In Chrome for Android, open the URL and use "Add to Home screen". The app will launch fullscreen in landscape.

Play Store route options
- Trusted Web Activity (TWA): Host as a PWA, then wrap with TWA for Play Store listing.
- Capacitor (WebView): `npm i @capacitor/core @capacitor/cli @capacitor/android`, build static files, set `webDir`, `npx cap add android`, then open in Android Studio.

Notes
- Motion sensors require a user gesture; we enable listeners on first pointerdown.
- Place your PWA icons under `icons/icon-192.png` and `icons/icon-512.png`.
- If motion steering is too sensitive, tweak the divisor (currently ~45 degrees for full lock) or thresholds in both mode files.
