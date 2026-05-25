# ChupAds

Manifest V3 ad blocker for Chrome. Bundled EasyList-based rules, cosmetic hiding, popup stats, element picker.

## Development

```bash
npm install
npm run build      # requires easylist.txt in project root
npm run package    # chupads-extension.zip
npm run release    # build + package
```

Load unpacked from this folder, or extract the ZIP and load that folder.

## Distribution

- **Free (no fee):** Load unpacked from this folder, or share `chupads-extension.zip` 

## Structure

| Path | Purpose |
|------|---------|
| `background/index.js` | Service worker, rules, stats |
| `content/cosmetic.js` | Hide ad elements on pages |
| `popup/` | Toolbar popup UI |
| `options/` | Settings & privacy |
| `rules/` | Bundled DNR + cosmetic JSON |
| `compiler/` | Optional TS compiler (dev) |

## Version

1.1.0 — bundled rules, store-safe stats, options page.
