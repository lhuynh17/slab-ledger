# Slab Ledger — standalone app

A fully standalone version of the card inventory app. No Claude account, no
Anthropic API, no per-scan cost. Runs entirely in your browser, installs as
an app icon, and works offline except for the two things that genuinely need
the internet: PSA lookups and the very first load.

## What changed from the Claude-artifact version

- **Storage** — IndexedDB instead of Claude's artifact storage. Your data
  lives only on the device you use it on.
- **Cert number capture** — the barcode scanner (native browser API, same as
  before) still works instantly and offline. For a photo (Take Photo /
  Upload Photo), on-device OCR (Tesseract.js) reads the printed cert number.
  This runs entirely in your browser — no image ever leaves your phone.
- **Card details** — once a cert number is captured, the app calls **PSA's
  own public API** directly to pull the real card name and grade. This
  replaces the Claude-vision + web-search step, and is arguably more
  accurate since it's PSA's authoritative record instead of a best-effort
  read.

## One-time setup: PSA API token

1. Go to **psacard.com/publicapi** and sign in (or create a free PSA
   account).
2. Follow their flow to generate an API access token (free tier: 100
   lookups/day — plenty for a show).
3. In the app, open **Settings**, paste the token, and save. It's stored
   only in this browser's local storage on this device.

Without a token, everything else still works — you'll just fill in card
name and grade manually after capturing the cert number.

## Deploying it (so it has a real web address)

Pick whichever is easiest for you — both are free.

### Option A: Netlify Drop (fastest, no account)

1. Unzip the folder you downloaded.
2. Go to **app.netlify.com/drop** in a browser.
3. Drag the whole unzipped folder onto the page.
4. You'll get a live URL in a few seconds (something like
   `random-name-123.netlify.app`).

### Option B: GitHub Pages (if you already use GitHub)

1. Create a new repository, upload all the files (keep the folder
   structure — `icons/` stays a subfolder).
2. Go to the repo's **Settings → Pages**, set the source to the `main`
   branch, root folder.
3. GitHub gives you a URL like `yourname.github.io/repo-name`.

## Installing it on your phone

1. Open the deployed URL in Chrome on your Android phone.
2. Chrome should show an **"Install app"** prompt automatically, or:
   tap the ⋮ menu → **Install app** (not "Add to Home screen" — with a
   proper manifest, Chrome offers the real install option this time).
3. It'll appear in your app drawer and home screen like any other app —
   full screen, no browser bar.

## Notes and limits

- **First load needs internet** (to fetch React/Babel/Tesseract and cache
  them). After that, the app shell works offline.
- **PSA lookups need internet** every time, since that's a live API call.
- **OCR accuracy** is decent for clear, well-lit photos of printed digits,
  but not as sharp as the Claude-vision version was — the barcode scanner
  is still the most reliable free option when you have the physical slab
  in hand.
- **This is unique to this device.** There's no sync between phones. Use
  the CSV export on the Inventory screen if you want a backup or want to
  move data elsewhere.
