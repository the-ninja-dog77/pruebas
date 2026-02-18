const fs = require('fs');
const path = require('path');
const db = require('./database');

function runSeeders() {
  const seedersPath = path.join(__dirname, 'seeders');

  if (!fs.existsSync(seedersPath)) return;

  const files = fs
    .readdirSync(seedersPath)
    .filter(file => file.endsWith('.js'))
    .sort();

  files.forEach(file => {
    console.log(`🌱 Ejecutando seeder: ${file}`);
    const seeder = require(path.join(seedersPath, file));
    seeder.up(db);
  });
}

module.exports = runSeeders;
