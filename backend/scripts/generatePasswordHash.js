#!/usr/bin/env node
const bcrypt = require('bcrypt');

async function main() {
  const password = String(process.argv[2] || '').trim();
  const rounds = Number(process.argv[3] || 12);

  if (!password) {
    console.error('Uso: node scripts/generatePasswordHash.js "<password>" [rounds]');
    process.exit(1);
  }

  const safeRounds = Number.isFinite(rounds) && rounds >= 10 ? Math.floor(rounds) : 12;
  const hash = await bcrypt.hash(password, safeRounds);
  console.log(hash);
}

main().catch(err => {
  console.error(`No se pudo generar hash: ${err.message}`);
  process.exit(1);
});
