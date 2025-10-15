import { cp, mkdir, rm, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const docsBuildDir = path.join(repoRoot, "docs", "build");
const nextPublicDocsDir = path.join(repoRoot, "frontend", "public", "docs");

async function ensureBuildExists() {
  try {
    const stats = await stat(docsBuildDir);
    if (!stats.isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "Docs build output not found. Run `pnpm -F docs build` before syncing."
    );
  }
}

async function syncDocs() {
  await ensureBuildExists();
  await rm(nextPublicDocsDir, { recursive: true, force: true });
  await mkdir(nextPublicDocsDir, { recursive: true });
  await cp(docsBuildDir, nextPublicDocsDir, { recursive: true });
  console.log(`Docs assets copied to ${nextPublicDocsDir}`);
}

syncDocs().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
