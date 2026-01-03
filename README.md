# The Minecraft API

This is the repository for the (unofficial) Minecraft API!

The aim of this API is to provide you with access to all sorts of information about the game Minecraft. This includes things like images, descriptions, stats, technical details, and much more. Currently, the API has endpoints for information about items, blocks, and crafting recipes, but more is planned for the future. The API is up to date for Minecraft Java Edition 1.18. At this time, 1.19 data isn't available since the Minecraft Wiki (where the data is pulled from) hasn't updated its website yet.

# Documentation

You can find detailed documentation for the API [here](https://anish-shanbhag.stoplight.io/docs/minecraft-api).

# Endpoints

The root endpoint of the API is https://minecraft-api.vercel.app/api.

To form requests to the API, append the path of the resource you want to the end of the root endpoint. As an example, a simple request to get information about all of the items in Minecraft would be https://minecraft-api.vercel.app/api/items. This request would return the following JSON:

```json
[
  {
    "name": "Acacia Boat",
    "namespacedId": "acacia_boat",
    "description": "A boat is both an item and a vehicle entity.",
    "image": "https://minecraft-api.vercel.app/images/items/acacia_boat.png",
    "stackSize": 1,
    "renewable": true
  },
  {
    "name": "Acacia Button",
    "namespacedId": "acacia_button",
    "description": "A button is a non-solid block that can provide temporary redstone power.",
    "image": "https://minecraft-api.vercel.app/images/items/acacia_button.png",
    "stackSize": 64,
    "renewable": true
  },
  {
    "name": "Acacia Door",
    "namespacedId": "acacia_door",
    "description": "A door is a block that can be used as a barrier that can be opened by hand or with redstone.",
    "image": "https://minecraft-api.vercel.app/images/items/acacia_door.png",
    "stackSize": 64,
    "renewable": true
  },
  ...
]
```

# A Note About Development

This project is currently a work in progress, and so there may be errors in the documentation or bugs in the API. If you find one, you can help me out by creating an issue in the [GitHub repository](https://github.com/anish-shanbhag/minecraft-api).

# Uploading `public/` assets to Cloudflare R2

The `public/blocks` and `public/items` folders contain ~2k images, which is more than the Cloudflare dashboard upload limit. Use the S3-compatible R2 API instead:

1) Create an R2 bucket in the Cloudflare dashboard.
2) Create an R2 API token / access key pair (R2 → Manage R2 API tokens).
3) Install deps (adds the AWS S3 client used by the script):

```bash
npm install
```

4) Upload:

```bash
cp .env.r2.example .env.r2
# fill in the values in `.env.r2` (the upload script auto-loads it)

# dry run
npm run upload:r2 -- --dry-run

# real upload
npm run upload:r2
```

By default it uploads `public/blocks` and `public/items` into the bucket as `blocks/...` and `items/...`.

To upload only one directory, set `R2_INCLUDE=blocks` (or `items`) in `.env.r2`, or pass `--include blocks` / `--include items`.

To upload into a versioned folder, set `R2_PREFIX=v1` (objects will be `v1/blocks/...` and `v1/items/...`).

To upload the other `public/` folders (biomes, circles, generatedStructures, mobs, redstone, trades):

```bash
npm run upload:r2 -- --include biomes,circles,generatedStructures,mobs,redstone,trades
# or
npm run upload:r2:extras
```

To skip keys that already exist in the bucket, add `--skip-existing` (or set `R2_SKIP_EXISTING=1`).
