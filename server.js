const express = require('express');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const axios = require('axios');
const db = require('./utils/db');
const bodyParser = require('body-parser');
const filterUtils = require('./utils/filter');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const SAVED_PAGES_DIR = path.join(__dirname, 'data', 'saved_pages');

function parseTournaments(html, year) {
    const $ = cheerio.load(html);
    const yearHeader = $(`span.mw-headline#${year}`);
    if (!yearHeader.length) {
        console.warn(`Tournaments header not found for ${year}`);
        return [];
    }
    const h3 = yearHeader.closest('h3');
    const gridTable = h3.nextAll('.gridTable').first();
    if (!gridTable.length) {
        console.warn(`No .gridTable found after year header for ${year}`);
        return [];
    }
    const tournaments = [];
    gridTable.find('.gridRow').each((i, el) => {
        const row = $(el);
        const name = row.find('.gridCell.Tournament.Header a').last().text().trim();
        const date = row.find('.gridCell.EventDetails.Date.Header').text().trim();
        const prize = row.find('.gridCell.EventDetails.Prize.Header').text().trim();
        const location = row.find('.gridCell.EventDetails.Location.Header').text().trim();
        if (name && date && location) {
            tournaments.push({ name, date, prizePool: prize || 'N/A', location });
        }
    });
    return tournaments;
}

function getTierFileName(game, tier) {
    return path.join(SAVED_PAGES_DIR, `${game}_${tier}.html`);
}

app.post('/api/submit', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    const match = url.match(/liquipedia\.net\/(\w+)\/(\w+)/i);
    if (!match) return res.status(400).json({ error: 'Invalid Liquipedia URL' });
    const game = match[1].toLowerCase();
    const tier = match[2];
    const filePath = getTierFileName(game, tier);
    let html;
    if (fs.existsSync(filePath)) {
        console.log('Using cached page:', filePath);
        html = fs.readFileSync(filePath, 'utf-8');
    } else {
        console.log('Fetching page:', url);
        try {
            const response = await axios.get(url);
            html = response.data;
            fs.writeFileSync(filePath, html);
        } catch (err) {
            console.error('Failed to fetch page:', err);
            return res.status(500).json({ error: 'Failed to fetch page' });
        }
    }
    db.serialize(() => {
        db.run('INSERT OR IGNORE INTO games (name) VALUES (?)', [game]);
        db.get('SELECT id FROM games WHERE name = ?', [game], (err, gameRow) => {
            if (err || !gameRow) {
                console.error('Game DB error:', err);
                return res.status(500).json({ error: 'Game not found' });
            }
            db.run('INSERT OR IGNORE INTO tiers (game_id, url) VALUES (?, ?)', [gameRow.id, url]);
            db.get('SELECT id FROM tiers WHERE game_id = ? AND url = ?', [gameRow.id, url], (err, tierRow) => {
                if (err || !tierRow) {
                    console.error('Tier DB error:', err);
                    return res.status(500).json({ error: 'Tier not found' });
                }
                const year = new Date().getFullYear();
                const tournaments = parseTournaments(html, year);
                if (!tournaments.length) {
                    console.warn('No tournaments parsed for', url);
                }
                let insertCount = 0;
                tournaments.forEach(t => {
                    db.run('INSERT OR IGNORE INTO tournaments (name, start_date, end_date, prize_pool, location, tier_id) VALUES (?, ?, ?, ?, ?, ?)',
                        [t.name, t.date, t.date, t.prizePool, t.location, tierRow.id], (err) => {
                            if (err) console.error('Tournament insert error:', err, t);
                        });
                    insertCount++;
                });
                res.json({ success: true, tournaments, inserted: insertCount });
            });
        });
    });
});

app.get('/api/games', (req, res) => {
    db.all('SELECT * FROM games', (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ games: rows });
    });
});

app.get('/api/tiers', (req, res) => {
    const { game } = req.query;
    db.get('SELECT id FROM games WHERE name = ?', [game], (err, gameRow) => {
        if (!gameRow) return res.json({ tiers: [] });
        db.all('SELECT * FROM tiers WHERE game_id = ?', [gameRow.id], (err, rows) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            res.json({ tiers: rows });
        });
    });
});

app.get('/api/tournaments', (req, res) => {
    const { tier_id } = req.query;
    if (!tier_id) return res.status(400).json({ error: 'Missing tier_id' });
    db.all('SELECT * FROM tournaments WHERE tier_id = ?', [tier_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ tournaments: rows });
    });
});

app.get('/api/filters', (req, res) => {
    const { tier_id } = req.query;
    db.get('SELECT filter_json FROM tiers WHERE id = ?', [tier_id], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ filters: row ? JSON.parse(row.filter_json || '{}') : {} });
    });
});

app.post('/api/filters', (req, res) => {
    const { tier_id, filters } = req.body;
    db.run('UPDATE tiers SET filter_json = ? WHERE id = ?', [JSON.stringify(filters), tier_id], err => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ success: true });
    });
});

app.get('/api/saved-pages', (req, res) => {
    fs.readdir(SAVED_PAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Failed to list saved pages' });
        const pages = files.filter(f => f.endsWith('.html')).map(f => {
            const [game, ...tierParts] = f.replace('.html', '').split('_');
            const tier = tierParts.join('_');
            return {
                file: f,
                url: `https://liquipedia.net/${game}/${tier}`
            };
        });
        res.json({ pages });
    });
});

// Home page: render tournaments, games, tiers, filters, etc.
app.get('/', async (req, res) => {
    const games = await db.getGames();
    let selectedGame = req.query.game || null;
    let selectedTier = req.query.tier || null;
    let tiers = [];
    let tournaments = [];
    let filters = null;
    const filtersUnfolded = req.query.filters === 'show';
    if (selectedGame) {
        // Only show tiers for the selected game
        const gameRow = games.find(g => g.name === selectedGame);
        if (gameRow) {
            tiers = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM tiers WHERE game_id = ?', [gameRow.id], (err, rows) => {
                    if (err) resolve([]); else resolve(rows);
                });
            });
        }
        if (selectedTier) {
            // Single tier selected: filter tournaments by tier
            tournaments = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM tournaments WHERE tier_id = ?', [selectedTier], (err, rows) => {
                    if (err) resolve([]); else resolve(rows);
                });
            });
            filters = await new Promise((resolve, reject) => {
                db.get('SELECT filter_json FROM tiers WHERE id = ?', [selectedTier], (err, row) => {
                    if (err || !row) resolve({ include: [], exclude: [] });
                    else resolve(row.filter_json ? JSON.parse(row.filter_json) : { include: [], exclude: [] });
                });
            });
            tournaments = filterUtils.filterTournaments(tournaments, filters);
        } else {
            // All tiers: get all tournaments for this game
            tournaments = await new Promise((resolve, reject) => {
                db.all('SELECT t.*, r.id as tier_id FROM tournaments t JOIN tiers r ON t.tier_id = r.id WHERE r.game_id = ?', [gameRow.id], (err, rows) => {
                    if (err) resolve([]); else resolve(rows);
                });
            });
            // Get all filters for all tiers
            const tierFilters = {};
            for (const tier of tiers) {
                tierFilters[tier.id] = tier.filter_json ? JSON.parse(tier.filter_json) : { include: [], exclude: [] };
            }
            // Apply each tournament's tier's filter
            tournaments = tournaments.map(t => {
                const f = tierFilters[t.tier_id] || { include: [], exclude: [] };
                return filterUtils.filterTournaments([t], f)[0];
            });
        }
    } else {
        // No game selected: show all tiers and all tournaments for current year
        tiers = await db.getTiers();
        tournaments = await db.getTournaments({ year: new Date().getFullYear() });
    }
    const savedPages = await db.getSavedPages();
    res.render('index', {
        games,
        tiers,
        tournaments,
        savedPages,
        selectedGame,
        selectedTier,
        filters,
        filtersUnfolded
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
