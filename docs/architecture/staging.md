# Staging (`devtalk-staging`) for Vercel Previews

Production stays on `devtalk-88046`. Vercel Preview deployments use the
separate Firebase project `devtalk-staging`, holding synthetic data only.

## Project and configuration isolation

`app/firebase/projects.ts` maps production → `devtalk-88046` and
staging → `devtalk-staging`. A deployment declares its environment with
`DEVTALK_FIREBASE_ENV` (`production` | `staging`) and/or Vercel's
`VERCEL_ENV`; when both are set they must agree. See server-auth.md for
the Admin-side checks.

For the browser, `app/firebase/web-config-bindings.ts` records, per
environment, a pinned SHA-256 fingerprint of the web API key plus the public
app ID, sender ID, auth domain, bucket and project from the Firebase console,
reviewed in code. A build that declares an environment must supply an API
key whose SHA-256 equals the pinned fingerprint and exactly those public
values; anything else (for example a production API key with
otherwise-staging settings) fails the build. The fingerprint is never
derived from the variable being checked, and the key itself is never stored
in the repository. A binding left `null`, or a missing or malformed
fingerprint, refuses every build for that environment. Never record a
secret there.

### Computing an API key fingerprint (owner, outside any session)

Copy the web API key from the Firebase console (Project settings > General >
Your apps > the web app > Config, `apiKey`), then in a terminal run `bash`
(macOS's default shell is zsh; this line was tested in bash) and:

```
read -rs KEY; printf '%s' "$KEY" | shasum -a 256 | cut -d' ' -f1; unset KEY
```

On Linux, use `sha256sum` instead of `shasum -a 256`. Paste the key at the
blank prompt and press Enter. The key is typed into `read`, never part of a
command line, so it is not saved in shell history or visible in any process's
arguments (`read` and `printf` are shell builtins); `-s` keeps it from being
echoed, and `unset` removes it from the shell afterwards. The output is 64
lowercase hex characters: record only that, as `apiKeySha256`. Use exactly
the value you will enter in Vercel; leading and trailing spaces are ignored
both here and by the build check. Clear the clipboard afterwards.
