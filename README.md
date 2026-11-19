# MANHUNT IRL

Mobile-first real-life Manhunt web app built for outdoor play with low battery usage and zero-config Render deployment.

## Features
- **Lobby System**: 4-character join code + one-tap invite link, max player limit, kick/host transfer, automatic reconnect after mobile browser refresh.
- **Synchronized Hunter Wheel**: Server-seeded canvas wheel picks N manhunters in sync across every phone.
- **Geofenced Play Boundary**: Draw a custom block polygon or quick circle on the map; adaptive GPS polling (6s inside / 2s near edge) triggers a configurable grace countdown before auto-eliminating runners who step outside.
- **Two Intel Ping Modes**:
  - **Live 360° Video Mode**: Rear-camera-only `MediaRecorder` capture (`640×360` @ 24fps, ~650 kbps sharp low-bandwidth clips), zero gallery uploads, server-issued 4-digit live verification code, configurable deadline (auto-eliminates if missed), and a **Keep Videos** toggle for a post-game download vault.
  - **GPS Spot Ping Mode**: Drops runners' latest GPS pin + accuracy ring onto hunters' maps every ping interval.
- **Battery Optimized**: True OLED dark UI, adaptive GPS sampling instead of continuous 1Hz tracking, immediate camera track shutdown, and a one-tap **Battery Saver** toggle.

## Local Development
```bash
npm run install:all
npm run build
npm run start
```
Open `http://localhost:3001`.

## Deploy to Render
1. Push this repo to GitHub.
2. In [Render](https://dashboard.render.com), click **New + → Blueprint** and select the repo (`render.yaml` is preconfigured).
3. Render automatically builds and serves over HTTPS (required on phones for GPS & live camera).
