# 📸 Photo Collage Builder

Create beautiful photo collages right on your phone or computer. It’s completely free, respects your privacy, and works **100% offline**—even when you’re in Airplane Mode!

👉 **[Try the Live App Here](https://sharpkathy123.github.io/MakePhotoCollage/)**

![Collage App Banner](https://img.icons8.com/color/512/grid-2.png)

---

## ✨ What You Can Do

* **📱 Works Like an App:** Add this webpage to your phone's Home Screen and use it just like a regular app from the App Store.
* **🔒 100% Private:** Your photos **never leave your phone**. Everything is processed directly on your device.
* **✈️ Airplane Mode Ready:** Use it anywhere, even on a flight with no Wi-Fi or cellular signal.
* **🎨 Color Palette Matcher:** Automatically picks colors directly from your photos to use as background or border frames.
* **📐 Easy Shapes & Sizes:**
  * Square crops (great for Instagram or photo grids)
  * Fun shapes like **Circles** or **Rounded Corners**
  * Custom photo positioning, scale, and rotation
* **📲 Quick Save & Share:** Saves directly to your iPhone or Android photo library with one tap.

---

## 🖼️ Importing Photos from Google Photos

Besides picking photos from your device, you can import them directly from **Google Photos**. Because this app has no server of its own, connecting Google Photos requires a free Google OAuth Client ID that *you* create and control — your photos are fetched straight from Google to your browser and never touch any third-party server.

> **⚠️ This only works for approved Google accounts, permanently.** Google requires an OAuth app like this one to go through a verification review before *any* Google account can use it. This app is **not** submitted for that review, and there's no plan to — verification is a real process (ownership checks, a privacy policy URL, sometimes a video demo) that isn't worth it for a personal project. Left in "Testing" mode, Google caps it at 100 explicitly-added accounts, and every one of them sees the "hasn't completed the Google verification process" warning before signing in. So: the Google Photos button will only ever work for accounts added as **test users** in the Google Cloud project below (or the whole thing stays visible-but-broken for everyone else — that's an accepted trade-off, not a bug to file). Adding another device or account? Skip straight to step 3 below to add it as a test user; the app itself doesn't need any changes.

**One-time setup:**
1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. Under **APIs & Services → Library**, enable the **Google Photos Picker API**.
3. Under **APIs & Services → Google Auth Platform → Branding**, fill in the required app info (name, support email) to finish the consent screen setup. Then go to **Audience** (in that same Google Auth Platform section) — confirm **Publishing status** is **Testing**, and under **Test users** click **Add users** for every Google account that should be able to use this (yourself, and anyone else you want to grant access to). This is the step to revisit whenever you want to add another approved account — nothing else in this setup needs to change.
4. Under **APIs & Services → Credentials**, create an **OAuth client ID** of type **Web application**.
   * Add `https://sharpkathy123.github.io` as an **Authorized JavaScript origin** (add `http://localhost` too if you run the app locally).
5. Copy the generated **Client ID**.
6. In the app, tap **📷 Google Photos** and paste the Client ID when prompted. It's saved only on your device (`localStorage`), so you only need to do this once per device/browser.

After that, tapping **📷 Google Photos** opens Google's photo picker in a new tab — pick photos there, come back, and they're added to your collage.

---

## 📲 How to Install on Your Phone

You don't need an App Store to download this! Just follow these quick steps:

### On iPhone or iPad (Safari)
1. Open **[https://sharpkathy123.github.io/MakePhotoCollage/](https://sharpkathy123.github.io/MakePhotoCollage/)** in **Safari**.
2. Tap the **Share button** (the square with an arrow pointing up at the bottom of the screen).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top right corner.

### On Android (Chrome)
1. Open **[https://sharpkathy123.github.io/MakePhotoCollage/](https://sharpkathy123.github.io/MakePhotoCollage/)** in **Google Chrome**.
2. Tap the **Three Dots menu** in the top right corner.
3. Tap **Add to Home Screen** (or **Install App**).

---

## ✈️ How to Use It Offline (Airplane Mode)

To use this app while traveling or without internet, you just need to open it **once** while connected:

1. **Step 1 (First Time Only):** Open **[the app link](https://sharpkathy123.github.io/MakePhotoCollage/)** while connected to Wi-Fi or cellular data. Let the page load completely.
2. **Step 2:** Turn on **Airplane Mode** or disconnect from the internet.
3. **Step 3:** Open the app from your Home Screen—it will open instantly and work normally!
