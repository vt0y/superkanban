# Tarot card image drop folder

The recommended source is the complete 78-card Pam-A scan set on [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC)). Wikimedia marks the originals as Public Domain. Download and verify the complete set automatically:

```bash
npm run tarot:images:download
```

The downloader checks the category count, MIME types, unique card mapping, and Public Domain metadata before it copies anything into `inbox/`. It downloads Wikimedia's official 900px derivatives (the preparation step limits cards to 900px anyway), and saves both original and downloaded URLs, license metadata, dimensions, and checksums in `inbox/source-manifest.json`. It refuses to replace existing images unless you explicitly run `npm run tarot:images:download -- --force`.

Alternatively, put exactly 78 licensed Rider–Waite card images in `inbox/` manually. Keep proof that your scan is public domain or licensed for this use; do not put a card-back image in the folder.

Accepted inputs: JPG, PNG, WebP, TIFF, and AVIF. The filename parser recognizes canonical names, English card names, `ar00`–`ar21`, and compact minor names such as `w01`, `c12`, `s14`, and `p03`.

```bash
# See the canonical names without adding images
npm run tarot:images:list

# After placing all 78 originals in inbox/
npm run tarot:images:check
npm run tarot:images:prepare
```

Prepared files appear in `upload/deck-v1/` as optimized WebP images plus `manifest.json` (including Wikimedia provenance when downloaded automatically) and `upload-list.txt`. Upload the contents of that folder so the public URL is:

```text
https://<your-card-domain>/deck-v1/major-00-fool.webp
```

The preparation command never modifies `inbox/`. It refuses ambiguous, duplicate, missing, or extra image files and refuses to replace existing output unless you explicitly run:

```bash
npm run tarot:images:prepare -- --force
```

ImageMagick (`magick`/`convert`) is preferred; `cwebp` is accepted as a fallback.
