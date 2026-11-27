# 0VERTRAINED for iPhone and Apple Watch

A private build for your own phone and watch.

- `App/` is the iPhone app: a web view that opens the site, plus the native
  pieces a web page can't do: haptics, a rest-over notification when the phone
  is locked, keeping the screen on during a session, the link to the watch,
  planned runs scheduled in the watch's Workout app, recorded runs with their
  splits and effort, cardio fitness and the day's steps, weight and sleep read
  from Apple Health, weight, food and lifts saved to it, progress photos kept
  on the phone, barcode scanning for the food log, and the reminders.
- `RestActivity/` draws the rest timer on the Lock Screen and in the Dynamic
  Island, and the Today widget for the Home and Lock Screen (a widget
  extension the app embeds).
- `WatchApp/` is the Apple Watch app, written in SwiftUI: the day's lifts, one
  set at a time, a tap on the wrist when the rest is over, the workout
  tracked in Health, and the day's runs, which open in the Workout app. Double
  tap logs a set, and the Ultra's Action button can start the day's lifting.
- `WatchWidgets/` is the Today complication for the watch face (a widget
  extension the watch app embeds).
- `Shared/` is code more than one of them builds: a planned run as a
  WorkoutKit workout, the rest timer's data, and the day cards the widgets
  show.

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
   the WatchApp, RestActivity and WatchWidgets targets.
   - The app and its widgets share an app group, `group.` followed by the
     app's bundle identifier. Xcode registers it when it signs. If a target
     shows a red App Groups error, open that target's Signing &
     Capabilities, find App Groups, and tick the group (or press Try Again).
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

- The iPhone app sends the watch the next 7 days of lifts and runs, and sends
  them again whenever something changes. The watch moves to the new day at
  midnight, so it has the day's lifts even if you haven't opened the iPhone
  app that day, as long as you have in the last week. A set's starting numbers
  come from your log as it stood when the phone last sent the week.
- On the watch, press Start workout, pick an exercise, and press Log set. Each
  set arrives filled the way the phone would fill it and says from what. The
  Digital Crown changes the outlined number; tap the other number to switch.
- The rest starts when you log a set and taps your wrist when it's over.
- Sets logged on the watch reach the phone even when it's out of range, and
  go into your log the next time the iPhone app is open.
- End workout saves the workout to Health and Fitness, and marks the session
  finished on the phone if every set is logged.
- Double tap (thumb and finger, on Series 9, Ultra 2 and later, watchOS 11)
  presses the screen's main button: Log set, Skip during a rest, or Next.
- On Apple Watch Ultra, the Action button can start the day's lifting: Watch
  Settings > Action Button > Action: Workout > App: 0VERTRAINED. Pressing it
  opens the app with the workout running. With no lifting planned that day it
  just opens the app.

## Runs on the watch

- Turn it on in the iPhone app: Settings > Integrations > Apple Watch > Turn
  on. iOS asks twice: to add workouts to the watch, and to read runs from
  Health. Allow both.
- The next 7 days of planned runs then wait in the Workout app on the watch,
  under 0VERTRAINED, each with its warm-up, intervals and cool-down, and a
  pace alert on each step that has a target pace. A plan without paces gets a
  heart-rate zone alert instead. When the plan changes, the runs on the watch
  change with it.
- The watch app lists today's run too: Start in Workout opens it there.
- When you open the iPhone app after a run, it fills in that day's miles,
  time and pace from Health, unless you've already logged a run for that day.
  Undo in the message takes it back out. Each run is filled in only once.
- Its mile splits (pace and heart rate, pauses left out) and its effort come
  with it, and show under the run on Today and in History. The effort is your
  rating in the Workout or Fitness app, else Apple's estimate (iOS 18 and
  later), and it sets that run's training load. The first time, iOS asks to
  read cardio fitness and effort too.
- Progress > Running shows the watch's cardio fitness (VO2 max) over the
  last year.
- Turning it off takes the runs off the watch.

## The rest timer on the Lock Screen

- While the session runner rests, the rest shows as a timer on the Lock
  Screen and in the Dynamic Island, with what's next. A new rest moves it on;
  pausing the rest, closing the runner or finishing takes it away.
- If the rest runs out with the phone locked, it turns to "Rest over".
- To switch it off: iPhone Settings > 0VERTRAINED > Live Activities.

## Apple Health, barcodes and widgets

- Settings > Integrations > Apple Health fills in each day's steps and
  weight, and sleep, resting heart rate and HRV when Oura and Whoop aren't
  connected. Only empty fields are filled; numbers you type stay. Turning it
  on asks iOS to read them.
- Save to Apple Health, under it, saves the weight you type, each day's food
  totals (calories, protein, carbs and fat), and lifts you finish in the
  session runner on the phone as strength workouts, with the effort you give
  them on the Box Score. Lifts tracked on the watch are already in Health;
  they get the rating (iOS 18 and later). Saving a day again replaces what
  was saved for it. Turning it on asks iOS to save these.
- Progress > Body > Progress photos keeps photos on the phone only, in the
  app's own folder, never uploaded. Add a photo opens the iPhone's photo
  picker or camera.
- Fuel > Log food > Scan a barcode reads a packaged food's barcode with the
  camera and looks it up in Open Food Facts, then the USDA database. The
  first scan asks for the camera.
- Long-press the Home Screen or Lock Screen, tap +, and pick 0VERTRAINED for
  the Today widget. On the watch, edit a watch face and pick 0VERTRAINED's
  Today complication. Both move on at midnight; the iPhone one updates when
  the app opens, the watch one when the phone sends the week.

## Reminders

- In the iPhone app, Profile > Notifications has Today's plan (each morning
  at a time you choose, naming the session, its first lifts and its run), the
  evening check-in (7:30 pm, with Oura's bedtime window when Oura has one)
  and the Sunday Edition (Sunday, 5 pm), off until you turn them on. The
  phone schedules them itself; the app writes the coming mornings again
  whenever it opens or the plan changes.
- The Morning Edition and state changes go out only once your data has
  reached the server, so they need push. Push in the app needs the paid Apple
  Developer Program and work on the server; the Home Screen web app gets them
  today.

## The site the app opens

`server.url` in `capacitor.config.json` at the repository root says which
address the app loads. While this branch is being tested it is the `ios`
branch's Netlify deploy, so the app gets the code that talks to the watch.
Netlify builds that address only because `ios` is listed under Project
configuration > Continuous deployment > Branches and deploy contexts >
Branch deploys. A branch added there is built on its next push.
Once that code is on the production branch, point it at the production
address, then run `npx cap copy ios` to update `App/App/capacitor.config.json`
(or edit that file the same way). Put the new address in `WKAppBoundDomains`
in `App/App/Info.plist` too, in place of the `ios--` one: the app only runs
the site's offline cache for the domains listed there.

After the first launch the app opens without a connection: the site's
service worker keeps the app on the phone, and entries logged offline are
saved once the connection is back. If the site can't load and there's
nothing kept yet, the app shows `native-shell/offline.html`, and tries again
when the connection comes back.

## Not in this build

- Push notifications: the Morning Edition and state changes (see Reminders).
- Siri.
