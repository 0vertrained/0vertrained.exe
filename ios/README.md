# 0VERTRAINED for iPhone and Apple Watch

A private build for your own phone and watch.

- `App/` is the iPhone app: a web view that opens the site, plus the native
  pieces a web page can't do: haptics, a rest-over notification when the phone
  is locked, keeping the screen on during a session, and the link to the watch.
- `WatchApp/` is the Apple Watch app, written in SwiftUI: today's lifts, one
  set at a time, a tap on the wrist when the rest is over, and the workout
  tracked in Health.

The project opens in Xcode as it is. You don't need Node or the command line.

## Run it on your iPhone and watch

1. Install Xcode from the Mac App Store and open it once. When it asks which
   platforms to download, include watchOS (or later: Xcode > Settings >
   Components > watchOS).
2. On GitHub, open the repository, switch to the `ios` branch, then
   Code > Download ZIP, and unzip it.
3. Open `ios/App/App.xcodeproj`. Wait until Xcode finishes fetching the
   Capacitor package (the status bar at the top says when).
4. Add your Apple ID: Xcode > Settings > Accounts > + > Apple ID.
5. In the left sidebar, select the blue App project. Under Targets, select
   App, open Signing & Capabilities, and set Team to your name. Do the same for
   the WatchApp target.
   - If Xcode says the bundle identifier isn't available, select the App
     project (not a target), open Build Settings, search for `APP_BUNDLE_ID`,
     and change it, for example to `com.yourname.overtrained`. The watch's
     identifier follows it.
6. Plug in your iPhone and tap Trust. Turn on Developer Mode on the phone:
   Settings > Privacy & Security > Developer Mode, then restart.
7. At the top of Xcode, choose the App scheme and your iPhone, then press Run.
   The first time, the phone asks you to trust your developer certificate:
   Settings > General > VPN & Device Management.
8. For the watch, turn on Developer Mode on it too (Settings > Privacy &
   Security > Developer Mode). Keep it on its charger next to the Mac, on the
   same Wi-Fi. Choose the WatchApp scheme and your watch, then press Run. The
   first connection can take several minutes.
9. Open 0VERTRAINED on the phone and sign in as usual.

With a free Apple account, the apps stop opening after 7 days: connect the
phone and press Run again. With the paid Apple Developer Program you can use
TestFlight instead, where a build lasts 90 days and installs over the air.

## Using the watch

- Open the iPhone app once before you train. It sends today's lifts to the
  watch, and sends them again whenever something changes.
- On the watch, press Start workout, pick an exercise, and press Log set. Each
  set arrives filled the way the phone would fill it and says from what. The
  Digital Crown changes the outlined number; tap the other number to switch.
- The rest starts when you log a set and taps your wrist when it's over.
- Sets logged on the watch reach the phone even when it's out of range, and
  go into your log the next time the iPhone app is open.
- End workout saves the workout to Health and Fitness, and marks the session
  finished on the phone if every set is logged.

## The site the app opens

`server.url` in `capacitor.config.json` at the repository root says which
address the app loads. While this branch is being tested it is the `ios`
branch's Netlify deploy, so the app gets the code that talks to the watch.
Netlify builds that address only because `ios` is listed under Project
configuration > Continuous deployment > Branches and deploy contexts >
Branch deploys. A branch added there is built on its next push.
Once that code is on the production branch, point it at the production
address, then run `npx cap copy ios` to update `App/App/capacitor.config.json`
(or edit that file the same way).

If the site can't load, the app shows `native-shell/offline.html`, and tries
again when the connection comes back.

## Not in this build

- Reminders: Web Push doesn't reach a web view inside an app.
- Opening with no connection: the app loads the site each time it starts.
- Today's lifts on the watch without opening the iPhone app that day.
- Widgets, Live Activities and Siri.
