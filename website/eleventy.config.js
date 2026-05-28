import techdoc from "eleventy-plugin-techdoc";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(siteRoot, "..");

const publishedDocSets = [
  { label: "Specs", dir: "docs/specs", parent: "Specs", order: 30, tag: "specDocs" },
];

function markdownFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function unixPath(path) {
  return path.replaceAll("\\", "/");
}

function titleFromMarkdown(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function publishedUrlForRepoPath(repoPath) {
  const normalized = unixPath(repoPath);
  for (const set of publishedDocSets) {
    const prefix = `${set.dir}/`;
    if (normalized.startsWith(prefix)) {
      return `/docs/${set.dir.slice("docs/".length)}/${normalized.slice(prefix.length).replace(/\.md$/, "/")}`;
    }
  }
  return null;
}

function rewriteDocLinks(markdown, sourceRepoPath) {
  return markdown.replace(/(\[[^\]]+\]\()((?!https?:|mailto:|#)[^)#]+\.md)(#[^)]+)?(\))/g, (match, open, target, hash = "", close) => {
    const resolvedTarget = unixPath(resolve(repoRoot, dirname(sourceRepoPath), target));
    const repoTarget = unixPath(relative(repoRoot, resolvedTarget));
    const publishedUrl = publishedUrlForRepoPath(repoTarget);
    return publishedUrl ? `${open}${publishedUrl}${hash}${close}` : match;
  });
}

function registerPublishedDocs(eleventyConfig) {
  for (const set of publishedDocSets) {
    const absoluteDir = join(repoRoot, set.dir);
    markdownFiles(absoluteDir).forEach((file, index) => {
      const sourceRepoPath = unixPath(relative(repoRoot, file));
      const relativeDocPath = unixPath(relative(absoluteDir, file));
      const rawMarkdown = readFileSync(file, "utf8");
      const title = titleFromMarkdown(rawMarkdown, relativeDocPath.replace(/\.md$/, ""));
      const permalink = `/docs/${set.dir.slice("docs/".length)}/${relativeDocPath.replace(/\.md$/, "/")}`;
      const frontMatter = [
        "---",
        "layout: layouts/docs.njk",
        "templateEngineOverride: md",
        `title: ${JSON.stringify(title)}`,
        `description: ${JSON.stringify(`Source doc: ${sourceRepoPath}`)}`,
        `permalink: ${JSON.stringify(permalink)}`,
        `sourcePath: ${JSON.stringify(sourceRepoPath)}`,
        `docSection: ${JSON.stringify(set.label)}`,
        `tags: ["docs", "publishedDocs", ${JSON.stringify(set.tag)}]`,
        "eleventyNavigation:",
        `  key: ${JSON.stringify(title)}`,
        `  parent: ${JSON.stringify(set.parent)}`,
        `  order: ${set.order * 100 + index}`,
        "---",
        "",
      ].join("\n");

      eleventyConfig.addTemplate(
        `published/${set.tag}/${relativeDocPath}`,
        `${frontMatter}${rewriteDocLinks(rawMarkdown, sourceRepoPath)}`
      );
    });
  }
}

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(techdoc, {
    site: {
      name: "Shipwright",
      url: "https://shipwright.nimblesite.dev",
      description: "Secure supply-chain contracts for IDE extensions and developer-tool binaries.",
    },
    features: {
      blog: false,
      docs: true,
      darkMode: true,
      i18n: false,
    },
    i18n: {
      defaultLanguage: "en",
      languages: ["en"],
    },
  });

  registerPublishedDocs(eleventyConfig);

  eleventyConfig.addCollection("posts", () => [
    {
      date: new Date("2026-05-27T00:00:00.000Z"),
      url: "/docs/",
      data: {
        title: "Shipwright Documentation",
        description: "Published Shipwright security and supply-chain docs.",
      },
      templateContent: "",
    },
  ]);
  eleventyConfig.addFilter("dateToRfc3339", (date) => {
    if (date === "now" || !date) {
      return new Date().toISOString();
    }
    return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
  });
  eleventyConfig.addPassthroughCopy({ [join(siteRoot, "src/assets")]: "assets" });
  eleventyConfig.addPassthroughCopy({
    [join(repoRoot, "extensions/shipwright-tools/media/shipwright.png")]: "assets/img/shipwright.png",
  });

  return {
    dir: {
      input: "src",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
}
