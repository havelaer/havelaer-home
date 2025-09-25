import { promises as fs } from 'node:fs';
import { watch as fsWatch, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import Handlebars from 'handlebars';
import { marked } from 'marked';

type FrontMatter = {
  meta?: {
    title?: string;
    description?: string;
  };
};

type Page = {
  routePath: string; // e.g. "/blog/today" or "/"
  htmlBody: string;
  frontMatter: FrontMatter;
  sourcePath: string;
};

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readTemplate(templatePath: string): Promise<Handlebars.TemplateDelegate> {
  const templateString = await fs.readFile(templatePath, 'utf8');
  return Handlebars.compile(templateString);
}

function markdownToHtml(markdown: string): string {
  return marked.parse(markdown) as string;
}

function contentPathToRoute(filePath: string, contentDir: string): string {
  const rel = path.relative(contentDir, filePath);
  const noExt = rel.replace(/\.[^.]+$/, '');
  const segments = noExt.split(path.sep).map(s => (s === 'index' ? '' : s));
  const route = '/' + segments.filter(Boolean).join('/');
  return route === '' ? '/' : route;
}

function routeToOutputFile(routePath: string): string {
  // For both "/" and any other route, write to an index.html inside its folder
  if (routePath === '/') return path.join('build', 'index.html');
  const clean = routePath.replace(/^\//, '');
  return path.join('build', clean, 'index.html');
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

async function collectPages(contentDir: string): Promise<Page[]> {
  const pages: Page[] = [];
  for await (const file of walk(contentDir)) {
    if (!file.endsWith('.md')) continue;
    const raw = await fs.readFile(file, 'utf8');
    const parsed = matter(raw);
    const frontMatter = (parsed.data || {}) as FrontMatter;
    const htmlBody = markdownToHtml(parsed.content);
    const routePath = contentPathToRoute(file, contentDir);
    pages.push({ routePath, htmlBody, frontMatter, sourcePath: file });
  }
  return pages;
}

async function build() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const root = path.resolve(path.dirname(currentFilePath), '..');
  const contentDir = path.join(root, 'content');
  const templatesDir = path.join(root, 'templates');
  const buildDir = path.join(root, 'build');

  await fs.rm(buildDir, { recursive: true, force: true });
  await ensureDir(buildDir);

  const layoutPath = path.join(templatesDir, 'layout.hbs');
  const layout = await readTemplate(layoutPath);

  const pages = await collectPages(contentDir);

  for (const page of pages) {
    const outputFile = routeToOutputFile(page.routePath);
    const outputDir = path.dirname(path.join(root, outputFile));
    await ensureDir(outputDir);

    const html = layout({
      meta: page.frontMatter?.meta ?? {},
      content: page.htmlBody,
      route: page.routePath,
      source: path.relative(root, page.sourcePath),
    });

    await fs.writeFile(path.join(root, outputFile), html, 'utf8');
  }

  // Copy static assets if a public directory exists in root
  const publicDir = path.join(root, 'public');
  try {
    const stat = await fs.stat(publicDir);
    if (stat.isDirectory()) {
      await copyDir(publicDir, path.join(buildDir));
    }
  } catch {
    // no public dir
  }
}

async function copyDir(src: string, dest: string) {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function startWatch(contentDir: string, templatesDir: string, publicDir: string, root: string) {
  let debounceTimer: NodeJS.Timeout | undefined;
  const debounceMs = 150;

  const scheduleBuild = (reason: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        console.log(`[watch] change detected (${reason}). Rebuilding...`);
        await build();
        console.log('[watch] rebuild complete');
      } catch (err) {
        console.error('[watch] rebuild failed:', err);
      }
    }, debounceMs);
  };

  const watchers = [
    fsWatch(contentDir, { recursive: true }, (eventType, filename) => {
      scheduleBuild(`content: ${eventType} ${filename ?? ''}`);
    }),
    fsWatch(templatesDir, { recursive: true }, (eventType, filename) => {
      scheduleBuild(`templates: ${eventType} ${filename ?? ''}`);
    }),
  ];

  // Watch public directory if it exists
  try {
    const stat = statSync(publicDir);
    if (stat.isDirectory()) {
      watchers.push(
        fsWatch(publicDir, { recursive: true }, (eventType, filename) => {
          scheduleBuild(`public: ${eventType} ${filename ?? ''}`);
        }),
      );
    }
  } catch {
    // public directory not present; skip watching
  }

  console.log('[watch] watching directories:');
  console.log(' -', path.relative(root, contentDir));
  console.log(' -', path.relative(root, templatesDir));
  try {
    const stat = statSync(publicDir);
    if (stat.isDirectory()) {
      console.log(' -', path.relative(root, publicDir));
    }
  } catch {
    // no public dir
  }

  const cleanup = () => {
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
  };
  process.on('SIGINT', () => {
    console.log('\n[watch] stopping');
    cleanup();
    process.exit(0);
  });
}

async function main() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const root = path.resolve(path.dirname(currentFilePath), '..');
  const contentDir = path.join(root, 'content');
  const templatesDir = path.join(root, 'templates');
  const publicDir = path.join(root, 'public');

  const args = process.argv.slice(2);
  const watch = args.includes('--watch');

  if (watch) {
    await build();
    startWatch(contentDir, templatesDir, publicDir, root);
  } else {
    await build();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
