import * as fs from 'fs';

const bytes = fs.readFileSync('/tmp/user_file.bin');

// Search for patterns
const sigs = [
  { name: 'JEK!', pattern: Buffer.from('JEK!') },
  { name: 'LSD!', pattern: Buffer.from('LSD!') },
  { name: 'LZH!', pattern: Buffer.from('LZH!') },
  { name: 'LZW!', pattern: Buffer.from('LZW!') },
  { name: 'JAM!', pattern: Buffer.from('JAM!') },
];

for (const sig of sigs) {
  let idx = -1;
  while (true) {
    idx = bytes.indexOf(sig.pattern, idx + 1);
    if (idx === -1) break;
    console.log(`Found ${sig.name} at offset ${idx} (0x${idx.toString(16)})`);
  }
}

// Let's check the last 4 bytes as a string
const last4 = bytes.slice(bytes.length - 4);
console.log(`Last 4 bytes: [${Array.from(last4).map(b => b.toString(16)).join(', ')}] = "${last4.toString('ascii').replace(/[^\x20-\x7e]/g, '?')}"`);

// Let's print size
console.log(`Total size: ${bytes.length} bytes`);
