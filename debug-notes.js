const fs = require('fs');
const path = require('path');
const cfg = require('./user-config');

const versions = ['7.0','6.0'];
for (const v of versions) {
  const dir = path.join(process.env.APPDATA, 'Creality', 'Creality Print', v, 'user', cfg.USERID, 'filament', 'base');
  console.log('\n=== Creality Print', v, '===');
  console.log('Base dir:', dir);
  if (!fs.existsSync(dir)) { console.log('  (missing)'); continue; }

  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json'));
  console.log('Files:', files.length ? files.join(', ') : '(none)');

  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
    const n = j.filament_notes;

    // robust-ish "has notes" check (avoid JS coercion weirdness)
    let hasNotes = false;
    if (typeof n === 'string') hasNotes = n.trim() !== '' && n.trim() !== '""';
    if (Array.isArray(n)) hasNotes = n.length > 0 && String(n[0] ?? '').trim() !== '' && String(n[0] ?? '').trim() !== '""';

    console.log(`- ${f}`);
    console.log(`    filament_notes type: ${Array.isArray(n) ? 'array' : typeof n}`);
    console.log(`    hasNotes: ${hasNotes}`);
    if (!hasNotes) console.log(`    VALUE:`, n);
  }
}