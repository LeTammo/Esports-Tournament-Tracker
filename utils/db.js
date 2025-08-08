const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/tourneys.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tiers (
    id INTEGER PRIMARY KEY,
    game_id INTEGER,
    url TEXT,
    filter_json TEXT,
    FOREIGN KEY(game_id) REFERENCES games(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY,
    name TEXT,
    start_date TEXT,
    end_date TEXT,
    prize_pool INTEGER,
    location TEXT,
    url TEXT,
    tier_id INTEGER,
    UNIQUE(name, start_date),
    FOREIGN KEY(tier_id) REFERENCES tiers(id)
  )`);
});

// Helper functions for async/await usage
function getGames() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM games', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getTiers() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM tiers', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getTournaments({ year }) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM tournaments WHERE start_date LIKE ?', [`${year}%`], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const fs = require('fs');
const path = require('path');
const SAVED_PAGES_DIR = path.join(__dirname, '../data/saved_pages');
function getSavedPages() {
  return new Promise((resolve, reject) => {
    fs.readdir(SAVED_PAGES_DIR, (err, files) => {
      if (err) return resolve([]);
      const pages = files.filter(f => f.endsWith('.html')).map(f => {
        const [game, ...tierParts] = f.replace('.html', '').split('_');
        const tier = tierParts.join('_');
        return {
          file: f,
          url: `https://liquipedia.net/${game}/${tier}`
        };
      });
      resolve(pages);
    });
  });
}

module.exports = Object.assign(db, {
  getGames,
  getTiers,
  getTournaments,
  getSavedPages
});
