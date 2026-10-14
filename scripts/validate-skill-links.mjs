// The link check of the whole repo (L2-release §2.8): no relative link in a Markdown file
// (tracked, or new and not ignored) points to a file that is not there. External links are not fetched.
// The check itself is in the prerelease skill, which runs it in every project at step 4 and step 6.
import { brokenLinks, markdownFiles } from "../skills/prerelease/scripts/links.mjs";

const root = process.cwd();
const files = markdownFiles(root);
const broken = brokenLinks(root, files);

if (broken.length > 0) {
  console.error("Markdown 相对链接指向的文件不存在：");
  for (const item of broken) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Markdown 相对链接都存在（${files.length} 个文件）`);
