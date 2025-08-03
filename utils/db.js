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
    tier_id INTEGER,
    UNIQUE(name, start_date),
    FOREIGN KEY(tier_id) REFERENCES tiers(id)
  )`);
});

module.exports = db;

