# copyIms

A small local web app for hand-picking photos out of a large, deeply nested
folder tree and copying them to a new location, **one click per photo**,
while keeping the original folder structure.

Typical use: you have years of photos spread over hundreds of subfolders and
want to pull out the good ones (for an album, a backup or a family share)
without dragging files around in Explorer.

## Features

- **One-click copy.** Click a thumbnail and it is copied to the same relative
  path under the target folder. Copied images get a green outline and ✓ badge.
- **Large preview.** Right-click any image to open it full screen. Use ← / →
  to step through the folder, and Esc or a click to close.
- **Mirrored folder tree.** `Origin/2019/Trip/IMG_001.jpg` is copied to
  `Target/2019/Trip/IMG_001.jpg`. Folders are created as needed.
- **Never touches your originals.** Files are only read from the origin
  folder. A file that already exists in the target is never overwritten.
- **iPhone HEIC/HEIF support.** HEIC photos are shown in the browser and can
  optionally be converted to high-quality JPG when copied.
- **Progress at a glance.** A folder whose images have all been copied shows
  a ✓ badge.
- **Continue where you left off.** With *Continue from last point* checked,
  the app reopens at the first folder that still has uncopied images.
- **Merge subdirectories.** View every image under a folder as one flat grid.
  Copies made in this mode land directly in that folder, with the
  subfolder names prefixed to the filename (`B1/C1/photo.jpg` becomes
  `B1_C1_photo.jpg`) so identically named files never collide.
- **Fast with big folders.** Thumbnails are cached on disk and pre-generated
  in the background. Large folders render in batches as you scroll.
- **Remembers your settings.** The origin and target folders are saved
  between sessions.

"Copied" status is always worked out live from what is actually in the
target folder. There is no separate database, so if you delete or move files
in the target by hand, the app picks that up.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- Windows 10/11 is the main target. The app is plain Node.js and should run
  on macOS and Linux too, but the **Browse…** folder picker uses a Windows
  dialog. On other systems, type or paste the folder paths instead.

## Getting started

### Windows (easiest)

1. Download or clone this repository.
2. Double-click **`start.bat`**.
   The first run installs the dependencies, which takes a minute.
3. Your browser opens at <http://localhost:4000>.

### Any platform

```bash
git clone https://github.com/<your-username>/copyIms.git
cd copyIms
npm install
npm start
```

Then open <http://localhost:4000>.

## How to use

1. Set **Origin root** (the folder tree you're picking from) and **Target
   root** (where the copies go). Use **Browse…** or paste a path.
2. Choose your options:
   - **Continue from last point:** reopen at the first folder that still
     has uncopied images.
   - **Convert iPhone (HEIC/HEIF) photos to JPG when copying:** on by
     default.
3. Click **Save**.
4. Browse folders by clicking them, and use the breadcrumb at the top to go
   back up.
5. **Left-click** an image to copy it. **Right-click** to see it large first.

## Where data is stored

Everything the app stores lives in the local `data/` folder next to the code
(this folder is git-ignored):

| File / folder       | Contents                                   |
| ------------------- | ------------------------------------------ |
| `data/config.json`  | Your saved origin and target folders and options |
| `data/thumbnails/`  | Cached thumbnails. Safe to delete at any time. |
| `data/app.log`      | Error and diagnostic log                   |

## Security note

The server listens on `127.0.0.1` only, so it can't be reached from other
machines on your network. It can read any image under the origin folder you
configure. Don't change it to listen on a public interface.

## Supported formats

JPG / JPEG, PNG, GIF, BMP, WebP, SVG, TIFF, HEIC / HEIF.

## Project layout

```
server.js            Express server (port 4000)
start.bat            Windows launcher
public/              Front end (plain HTML/CSS/JS, no build step)
src/
  routes/            API endpoints (browse, copy, thumbnail, image, ...)
  imageScan.js       Folder scanning, copied status, resume search, merge paths
  thumbnails.js      On-disk thumbnail cache (sharp)
  thumbnailWarmer.js Background thumbnail pre-generation
  heicConversion.js  HEIC to JPEG decoding (heic-convert)
  fsSafety.js        Path checks that keep requests inside the configured roots
```

## License

[MIT](LICENSE)
