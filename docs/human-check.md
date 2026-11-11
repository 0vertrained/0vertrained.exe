# The human check on sign-in and sign-up

Sign-in and sign-up can require proof that a person is there: [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
in the form, checked by Supabase Auth before it looks at a password. It is off until both sides are switched on,
and it stops scripts from creating accounts or guessing passwords against the public sign-in endpoint, which the
anon key alone can reach.

## How it works

1. The first time someone focuses or sends the sign-in form, the page loads Turnstile's script from
   `challenges.cloudflare.com` and draws the widget above the button. A visitor who only reads the landing page
   never contacts Cloudflare.
2. Cloudflare decides, usually without showing anything. When it wants the person to act, its box appears and the
   form says there is one more step. The answer is a token that is good once, for five minutes.
3. The token goes to Supabase with the username and password (`options.captchaToken` on `signUp` and
   `signInWithPassword`, in `src/auth.js`). After a failed attempt the form asks for a new one.
4. Supabase checks the token with Cloudflare, using the widget's secret key, and refuses the request if the token
   is missing, used or not accepted. The form says the human check did not go through; it never calls that a wrong
   password.

Two keys are involved. The **site key** is public: it is in the built page, set at build time as
`VITE_TURNSTILE_SITE_KEY`. The **secret key** is held by Supabase and nowhere else. It is not a Netlify variable,
and nothing in this repository reads it.

The code is `src/humanCheck.js` (the check itself), `src/HumanCheck.jsx` (its place in the form) and
`src/AuthScreen.jsx`. The content security policy in `netlify.toml` allows Turnstile's script and frame.

## Turning it on

The order matters. Once Supabase asks for a token, a page that cannot produce one cannot sign in, so the page goes
first.

1. **Cloudflare.** In the Cloudflare dashboard, open Turnstile and choose *Add widget*. Name it, add the hostnames
   `0vertrained.com` and `0vertrained.netlify.app`, keep the mode *Managed*, and create it. Copy the site key. Leave
   the secret key where it is for step 4.
2. **Netlify.** Add the environment variable `VITE_TURNSTILE_SITE_KEY` with the site key as its value. It is not a
   secret, so leave *Contains secret values* off. Deploy.
3. **Check the page.** Open the site in a private window and click into the username field. In the browser's
   network panel there is now a request to `challenges.cloudflare.com`. Sign in: it works as before, because
   Supabase is not asking yet.
4. **Supabase.** Under Authentication, open the attack protection settings (the section is called *Bot and Abuse
   Protection*), turn on *Enable CAPTCHA protection*, choose Turnstile, paste the secret key from Cloudflare, and
   save.
5. **Check again.** Sign out and in. Then confirm Supabase refuses a request with no token: from a terminal,

   ```bash
   curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
     -H "apikey: $SUPABASE_ANON_KEY" -H "content-type: application/json" \
     -d '{"email":"nobody@athlete.app","password":"not-a-real-password"}'
   ```

   answers with an error that names the captcha, where before it answered `invalid_credentials`.

## Turning it off

Switch *Enable CAPTCHA protection* off in Supabase. That takes effect at once, and sign-in works again for every
page, old or new. The widget still runs until `VITE_TURNSTILE_SITE_KEY` is removed and the site redeployed; its
token is then simply not checked.

## What it does not cover

- **Sessions that already exist.** Refreshing a session asks for no token, so people who are signed in stay signed
  in when the check is switched on.
- **Password reset by recovery phrase.** That goes through `netlify/functions/account-recovery.js`, which has its
  own limits by username and address.
- **The functions.** They require a signed-in session's token, as before.
- **Deploy previews.** A preview's hostname is not on the widget's list, so the widget fails there and, with the
  check on in Supabase, a preview cannot sign in.
- **A page loaded before step 2.** It has no widget. It can use its existing session, but not sign in again until
  it is reloaded.

## Privacy

Turnstile runs in Cloudflare's frame. To decide, Cloudflare receives the visitor's IP address and technical details
of the browser and device. The page sends it no username, password or account data. The privacy policy
(`public/legal/privacy-policy.html`) lists it among the services the app shares information with, and a test keeps
it there for as long as the code can load it.

## Trying it without a Cloudflare account

Cloudflare publishes site keys for testing that work on any hostname: `1x00000000000000000000AA` always passes,
`2x00000000000000000000AB` always fails and `3x00000000000000000000FF` always shows its box.

```bash
VITE_TURNSTILE_SITE_KEY=3x00000000000000000000FF npm run dev
```

Their tokens are accepted only by Cloudflare's test secret keys, so use them against a Supabase project where the
check is off, or against a local one.
