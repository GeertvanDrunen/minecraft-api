import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type UploadOptions = {
  publicDir: string;
  includeDirs: string[];
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  concurrency: number;
  dryRun: boolean;
  skipExisting: boolean;
  cacheControl?: string;
};

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function loadEnvFileIfPresent(envFilePath: string): void {
  const resolved = path.resolve(process.cwd(), envFilePath);
  if (!fs.existsSync(resolved)) return;
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) return;

  const content = fs.readFileSync(resolved, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    process.env[key] = value;
  }
}

function normalizePrefix(prefix: string): string {
  if (!prefix) return "";
  const p = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return p ? `${p}/` : "";
}

function guessContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return undefined;
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseOptions(): UploadOptions {
  const publicDir = getArg("--public-dir") ?? process.env.R2_PUBLIC_DIR ?? "public";
  const includeDirs = (getArg("--include") ?? process.env.R2_INCLUDE ?? "blocks,items")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const bucket = getArg("--bucket") ?? process.env.R2_BUCKET ?? "";
  if (!bucket) throw new Error("Missing bucket. Provide `--bucket <name>` or set `R2_BUCKET`.");

  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint =
    getArg("--endpoint") ??
    process.env.R2_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!endpoint) {
    throw new Error(
      "Missing endpoint. Provide `--endpoint <url>`, set `R2_ENDPOINT`, or set `R2_ACCOUNT_ID`."
    );
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? requireEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? requireEnv("AWS_SECRET_ACCESS_KEY");

  const prefix = normalizePrefix(getArg("--prefix") ?? process.env.R2_PREFIX ?? "");
  const concurrency = Number(getArg("--concurrency") ?? process.env.R2_CONCURRENCY ?? 10);
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("`--concurrency` must be a positive number.");
  }

  const dryRun = hasFlag("--dry-run") || process.env.R2_DRY_RUN === "1";
  const skipExisting = hasFlag("--skip-existing") || process.env.R2_SKIP_EXISTING === "1";
  const cacheControl = getArg("--cache-control") ?? process.env.R2_CACHE_CONTROL;

  return {
    publicDir,
    includeDirs,
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    prefix,
    concurrency,
    dryRun,
    skipExisting,
    cacheControl,
  };
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyErr = error as any;
  const code = anyErr?.$metadata?.httpStatusCode;
  const name = anyErr?.name;
  return code === 404 || name === "NotFound" || name === "NoSuchKey";
}

async function main(): Promise<void> {
  loadEnvFileIfPresent(getArg("--env-file") ?? ".env.r2");
  const options = parseOptions();
  const baseDir = path.resolve(process.cwd(), options.publicDir);
  const uploadRoots = options.includeDirs.map((d) => path.join(baseDir, d));

  for (const dir of uploadRoots) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`Directory not found: ${dir}`);
    }
  }

  const files = (
    await Promise.all(
      uploadRoots.map(async (dir) => {
        const collected = await collectFiles(dir);
        return collected;
      })
    )
  ).flat();

  files.sort();

  const client = new S3Client({
    region: "auto",
    endpoint: options.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });

  const limit = pLimit(options.concurrency);
  let uploaded = 0;
  let skipped = 0;
  const failed: { file: string; error: unknown }[] = [];

  const tasks = files.map((filePath) =>
    limit(async () => {
      const rel = path.relative(baseDir, filePath).split(path.sep).join("/");
      const key = `${options.prefix}${rel}`;

      if (options.dryRun) {
        uploaded += 1;
        if (uploaded % 100 === 0 || uploaded === files.length) {
          console.log(`[dry-run] queued ${uploaded}/${files.length}`);
        }
        return;
      }

      try {
        if (options.skipExisting) {
          try {
            await client.send(
              new HeadObjectCommand({
                Bucket: options.bucket,
                Key: key,
              })
            );
            skipped += 1;
            if ((uploaded + skipped) % 200 === 0 || uploaded + skipped === files.length) {
              console.log(`processed ${uploaded + skipped}/${files.length} (skipped: ${skipped})`);
            }
            return;
          } catch (error) {
            if (!isNotFoundError(error)) throw error;
          }
        }

        const contentType = guessContentType(filePath);

        await client.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: key,
            Body: fs.createReadStream(filePath),
            ContentType: contentType,
            CacheControl: options.cacheControl,
          })
        );

        uploaded += 1;
        if (uploaded % 50 === 0 || uploaded === files.length) {
          console.log(`uploaded ${uploaded}/${files.length}`);
        }
      } catch (error) {
        failed.push({ file: filePath, error });
        console.error(`failed: ${filePath}`);
      }
    })
  );

  await Promise.all(tasks);

  if (failed.length > 0) {
    console.error(`\nFailed uploads: ${failed.length}/${files.length}`);
    for (const entry of failed.slice(0, 20)) {
      const message = entry.error instanceof Error ? entry.error.message : String(entry.error);
      console.error(`- ${entry.file}: ${message}`);
    }
    if (failed.length > 20) console.error(`...and ${failed.length - 20} more`);
    process.exitCode = 1;
    return;
  }

  const summary = options.dryRun
    ? `Dry run queued ${uploaded} objects`
    : options.skipExisting
      ? `Uploaded ${uploaded} objects (skipped existing: ${skipped})`
      : `Uploaded ${uploaded} objects`;
  console.log(`\nDone. ${summary} to ${options.bucket}/${options.prefix}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
