import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillsRoot = resolve(process.argv[2] ?? resolve(scriptDir, '..', '..'));

function scalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'mu'));
  if (!match) return null;
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

const entries = await readdir(skillsRoot, { withFileTypes: true });
const catalog = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const skillPath = resolve(skillsRoot, entry.name, 'SKILL.md');
  let source;
  try {
    source = await readFile(skillPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source)?.[1];
  if (!frontmatter) continue;
  const name = scalar(frontmatter, 'name');
  const description = scalar(frontmatter, 'description');
  if (!name || !description) continue;
  catalog.push({
    name,
    description,
    path: relative(process.cwd(), skillPath).replaceAll('\\', '/'),
  });
}

catalog.sort((a, b) => a.name.localeCompare(b.name));
process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
