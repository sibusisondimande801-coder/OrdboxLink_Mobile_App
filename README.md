# OrdboxLink

OrdboxLink is an offline-first Expo app by Ordbox Tech for account-based,
end-to-end encrypted messaging. SQLite stores conversations locally and queues
messages when the network is unavailable. Supabase provides accounts, user
discovery, message delivery, and synchronization when online.

## Requirements

- Node.js 22.11 or newer and npm
- A Supabase project
- Android Studio and Android SDK for Android development builds
- macOS, Xcode, and CocoaPods for iOS development builds

## Supabase setup

1. Enable email/password authentication and turn off **Confirm email** for the
   Email provider in the Supabase project's Auth settings. Immediate registration
   is controlled by this project setting, not by the app.
2. Apply all migrations in `supabase/migrations/` using the Supabase SQL editor
   or Supabase CLI. They create messaging, contacts and private nicknames,
   per-user conversation deletion, public profile display names, stories,
   notifications, message edit/delete, and private media storage policies.
   Your display name is shown to contacts unless they set a private nickname;
   deleting a conversation hides it only for you and preserves the other
   person's copy. The latest story migration disables soundtrack uploads and
   access while allowing cleanup of soundtrack files attached to older stories.
3. Copy `.env.example` to `.env` and set the project's URL and public anon key:

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
   ```

   Do not put a service-role key in the app.
4. Deploy the push sender:

   ```bash
   supabase functions deploy send-message-push
   ```

5. Link the app to EAS and rebuild the native app so Expo can issue push tokens:

   ```bash
   npx eas-cli@latest init
   ```

   Keep the generated EAS project ID in the Expo app configuration and configure
   APNs/FCM credentials for the EAS build. Push notifications are not supported
   in the browser preview.
6. Deploy story cleanup, add a private `STORY_CLEANUP_SECRET`, then use Supabase
   Cron with the `pg_net` extension enabled to POST to the function URL every 10
   minutes. Set the request's `Authorization` header to
   `Bearer <STORY_CLEANUP_SECRET>`:

   ```bash
   supabase functions deploy cleanup-expired-stories --no-verify-jwt
   supabase secrets set STORY_CLEANUP_SECRET="<random secret>"
   ```

   The function removes expired story files, any soundtrack files attached to
   older stories, and legacy video stories before deleting their rows. Photo
   stories are hidden as soon as they expire and are physically cleaned up
   after 24 hours.

## Install and run

```bash
npm install
npm run android
```

For the VS Code browser-based mobile preview, run `npm run web -- --port 8082`
and open `http://localhost:8082`.

For iOS, run `npm run ios` on macOS after installing dependencies. The app uses
native SQLite, SecureStore, biometric authentication, and notification modules;
rebuild and reinstall the native app after adding or changing native modules.
Restarting Metro alone does not update an installed native app.
Stories accept photos only, with optional captions. Story music is not supported.

## Messaging and limitations

Create an account with a unique username, then search for another username to
start a conversation. Messages are encrypted on the device for the sender and
recipient. Offline sends are saved in SQLite and retried after connectivity
returns. Photos, documents, and voice notes are end-to-end encrypted before upload.
Photos and documents are limited to 10 MB; voice notes are limited to 5 MB and
two minutes. Attachment uploads require an internet connection; downloaded or
successfully sent attachments are cached encrypted for offline reopening. Text
messages can be queued offline. Voice notes display their recording length and
support 1x, 1.5x, and 2x playback. Chats show live typing status. Photo stories
support photos up to 10 MB and optional captions. They expire after 24 hours and
can be opened full-screen,
swiped right to advance, reacted to, and answered with a message. Story owners
can see their viewer list and view/reaction counts. Settings include profile
photos, ten colour palettes including monochrome, pink/plum, orchid, sky, lime,
and cocoa/sand, discoverability, blocking, message expiry, biometric locking,
notification preferences, and local history clearing.
The login screen's **Remember me** option is enabled by default. Turning it off
keeps the session only for the current app run and does not restore the signed-in
profile after the app is closed.

Encryption keys are generated and kept in the device's secure storage. There is
currently no key recovery or multi-device key transfer; losing app data or
changing devices can make old encrypted messages unreadable. Push delivery
requires the deployed sender function and an EAS project ID. Push alerts do not
include message contents. The Supabase project must be configured and all
migrations applied for account-based, cross-device messaging and message
edit/delete to work.
In the browser preview, encryption keys are encrypted with Web Crypto and stored
in IndexedDB; this is not equivalent to native OS secure storage. Biometrics and
native push notifications are unavailable in the browser preview.

## Validation

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npx expo-doctor
```
