// The link check of the whole repo (L2-release §2.8): no relative link in a Markdown file
// (tracked, or new and not ignored) points to a file that is not there. External links are not fetched.
// It also examines the anchors: each relative link to a Markdown file, and each `#anchor` link,
// names a heading of its target in the GitHub form, so `make validate` keeps the anchors right at each change.
// The check itself is in the prerelease skill, which runs it in every project at step 4 and step 6
// (there with no anchor check: `links.mjs --anchors` is an option).
import { brokenAnchors, brokenLinks, markdownFiles } from "../skills/prerelease/scripts/links.mjs";

const root = process.cwd();
const files = markdownFiles(root);
const broken = brokenLinks(root, files);
const anchors = brokenAnchors(root, files);

if (broken.length > 0) {
  console.error("Markdown 相对链接指向的文件不存在：");
  for (const item of broken) console.error(`- ${item}`);
}
if (anchors.length > 0) {
  console.error("Markdown 链接的锚点在目标文件里没有：");
  for (const item of anchors) console.error(`- ${item}`);
}
if (broken.length > 0 || anchors.length > 0) process.exit(1);

console.log(`Markdown 相对链接和锚点都存在（${files.length} 个文件）`);
