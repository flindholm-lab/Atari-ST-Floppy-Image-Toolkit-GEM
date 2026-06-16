import * as fs from 'fs';
import * as path from 'path';

function listRecursive(dir: string, depth = 0) {
  if (depth > 2) return;
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          console.log(`${'  '.repeat(depth)}[DIR] ${fullPath}`);
          listRecursive(fullPath, depth + 1);
        } else {
          console.log(`${'  '.repeat(depth)}[FILE] ${fullPath} (${stat.size} bytes)`);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

console.log("Searching workspace root .:");
listRecursive(".");

