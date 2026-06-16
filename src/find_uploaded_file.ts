import * as fs from 'fs';
import * as path from 'path';

function searchDirectory(dir: string, depth = 0) {
  if (depth > 5) return;
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip node_modules, .git, and huge build directories
          if (file === 'node_modules' || file === '.git' || file === 'dist') continue;
          searchDirectory(fullPath, depth + 1);
        } else {
          // Check file size first to be fast
          if (stat.size > 100 && stat.size < 2000000) {
            const buf = fs.readFileSync(fullPath);
            if (buf.includes("FIRE_2OGAMES") || buf.includes("Pack-Ice") || file.toLowerCase().endsWith('.prg') || file.toLowerCase().endsWith('.st') || file.toLowerCase().endsWith('.msa')) {
              console.log(`FOUND FILE: ${fullPath} (${stat.size} bytes)`);
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
}

console.log("Searching . and /tmp for matching files...");
searchDirectory(".");
searchDirectory("/tmp");
console.log("Search complete.");
