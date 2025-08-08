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

// Map month names/abbrevs to numbers (1-12)
const MONTH_MAP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
};

function pad2(n){ return String(n).padStart(2,'0'); }
function toISO(y,m,d){ return `${y}-${pad2(m)}-${pad2(d)}`; }

// Parse Liquipedia date strings like:
// "Jan 23 - 26, 2025" | "Jan 29 - Feb 09, 2025" | "Jul 28, 2025"
function parseLiquipediaDateRange(dateText){
    if (!dateText) return { startISO: null, endISO: null };
    const s = String(dateText).replace(/[\u2013\u2014]/g,'-').replace(/\s+/g,' ').trim();
    // Range with optional 2nd month
    let m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2})\s*-\s*([A-Za-z]{3,})?\s*(\d{1,2}),\s*(\d{4})$/);
    if (m){
        const m1 = MONTH_MAP[m[1].toLowerCase()];
        const d1 = parseInt(m[2],10);
        const mon2 = m[3] ? m[3].toLowerCase() : m[1].toLowerCase();
        const m2 = MONTH_MAP[mon2];
        const d2 = parseInt(m[4],10);
        const y = parseInt(m[5],10);
        if (m1 && m2 && d1 && d2 && y){
            return { startISO: toISO(y,m1,d1), endISO: toISO(y,m2,d2) };
        }
    }
    // Single date
    m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})$/);
    if (m){
        const mm = MONTH_MAP[m[1].toLowerCase()];
        const d = parseInt(m[2],10);
        const y = parseInt(m[3],10);
        if (mm && d && y){
            const iso = toISO(y,mm,d);
            return { startISO: iso, endISO: iso };
        }
    }
    // Fallback: try native Date
    const nd = new Date(s);
    if (!isNaN(nd)){
        const y = nd.getFullYear();
        const mm = nd.getMonth()+1;
        const d = nd.getDate();
        const iso = toISO(y,mm,d);
        return { startISO: iso, endISO: iso };
    }
    return { startISO: null, endISO: null };
}
// Loose date parsing from various human formats
function parseDateLoose(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.replace(/[\u2013\u2014]/g, '-').trim();
    // Extract right side if it's a range like "2025-04-01 - 2025-04-10"
    const parts = s.split(/\s*-\s*/);
    const tryParse = (x) => {
        const d = new Date(x);
        if (!isNaN(d)) return d;
        // Try common formats: "Apr 1, 2025", "1 Apr 2025"
        const m = x.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
        if (m) {
            return new Date(`${m[2]} ${m[1]}, ${m[3]}`);
        }
        const m2 = x.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
        if (m2) {
            return new Date(`${m2[1]} ${m2[2]}, ${m2[3]}`);
        }
        // YYYY-MM-DD
        const iso = x.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (iso) {
            return new Date(`${iso[1]}-${iso[2]}-${iso[3]}`);
        }
        // YYYY/MM/DD
        const sl = x.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (sl) {
            return new Date(`${sl[1]}-${sl[2].padStart(2,'0')}-${sl[3].padStart(2,'0')}`);
        }
        return null;
    };
    // If the original contains a comma, try as-is first
    let d = tryParse(s);
    if (d) return d;
    // Try taking left or right part of range
    if (parts.length >= 2) {
        d = tryParse(parts[0]);
        if (d) return d;
        d = tryParse(parts[1]);
        if (d) return d;
    }
    return null;
}

function parseISODateUTC(s) {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function categorizeTournaments(tournaments) {
    // Compare using UTC midnight to avoid TZ drift
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const current = [];
    const upcoming = [];
    const past = [];
    for (const t of tournaments) {
        const sd = parseISODateUTC(t.start_date);
        const ed = parseISODateUTC(t.end_date) || sd;
        // Compute ETA for upcoming (days/weeks/months)
        let eta = null;
        if (sd) {
            const diffMs = sd.getTime() - today.getTime();
            if (diffMs > 0) {
                const days = Math.ceil(diffMs / (24*60*60*1000));
                if (days < 7) eta = `in ${days} day${days===1?'':'s'}`;
                else if (days < 28) {
                    const weeks = Math.round(days/7);
                    eta = `in ${weeks} week${weeks===1?'':'s'}`;
                } else {
                    const months = Math.round(days/30);
                    eta = `in ${months} month${months===1?'':'s'}`;
                }
            }
        }
        const tt = { ...t, _sd: sd || null, _ed: ed || null, eta };
        if (sd && ed) {
            if (sd.getTime() <= today.getTime() && today.getTime() <= ed.getTime()) current.push(tt);
            else if (sd.getTime() > today.getTime()) upcoming.push(tt);
            else past.push(tt);
        } else if (sd) {
            if (sd.getTime() > today.getTime()) upcoming.push(tt); else past.push(tt);
        } else {
            // Unknown date -> keep visible as upcoming
            upcoming.push(tt);
        }
    }
    const byStart = (a, b) => {
        const ax = a._sd ? a._sd.getTime() : Infinity;
        const bx = b._sd ? b._sd.getTime() : Infinity;
        return ax - bx;
    };
    current.sort(byStart);
    upcoming.sort(byStart);
    past.sort(byStart);
    // Always show the next upcoming tournament as a highlight
    let upNext = upcoming.length > 0 ? [upcoming[0]] : [];
    let next = upcoming.length > 1 ? upcoming.slice(1) : [];
    return { current, upNext, next, past };
}
function parseTournaments(html, currentYear) {
    const $ = cheerio.load(html);

    const extractYears = (text) => {
        if (!text) return [];
        const matches = text.match(/\b(19\d{2}|20\d{2})\b/g);
        return matches ? matches.map(Number) : [];
    };

    const tournaments = [];
    $('.gridRow').each((i, el) => {
        const row = $(el);
    const titleCell = row.find('.gridCell.Tournament.Header');
    const name = titleCell.find('a').last().text().trim();
    const href = titleCell.find('a').last().attr('href');
    const fullUrl = href ? (href.startsWith('http') ? href : `https://liquipedia.net${href}`) : null;
        const dateText = row.find('.gridCell.EventDetails.Date.Header').text().trim();
        const prize = row.find('.gridCell.EventDetails.Prize.Header').text().trim();
        const location = row.find('.gridCell.EventDetails.Location.Header').text().trim();

        if (!name || !dateText) return;

        const years = extractYears(dateText);
        if (!years.length) return;
        const maxYear = Math.max(...years);
        if (maxYear < currentYear) return;

        const { startISO, endISO } = parseLiquipediaDateRange(dateText);
        tournaments.push({
            name,
            date: dateText,
            start_date: startISO || null,
            end_date: endISO || null,
            url: fullUrl,
            prizePool: prize || 'N/A',
            location: location || 'N/A'
        });
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
                    const start = t.start_date || t.date || null;
                    const end = t.end_date || t.date || null;
                    db.run('INSERT OR IGNORE INTO tournaments (name, url, start_date, end_date, prize_pool, location, tier_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [t.name, t.url || null, start, end, t.prizePool, t.location, tierRow.id], (err) => {
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
            // Apply each tournament's tier's filter and DROP excluded ones
            const filtered = [];
            for (const t of tournaments) {
                const f = tierFilters[t.tier_id] || { include: [], exclude: [] };
                const result = filterUtils.filterTournaments([t], f)[0];
                if (result && result.included !== false) filtered.push(result);
            }
            tournaments = filtered;
        }
    } else {
        // No game selected: show all tiers and all tournaments (apply per-tier filters like "All tiers")
        tiers = await db.getTiers();
        const allWithTiers = await new Promise((resolve) => {
            db.all('SELECT t.*, r.id as tier_id, r.filter_json, g.name as game_name FROM tournaments t JOIN tiers r ON t.tier_id = r.id JOIN games g ON r.game_id = g.id', [], (err, rows) => {
                if (err || !rows) resolve([]); else resolve(rows);
            });
        });
        const filtered = [];
        for (const t of allWithTiers) {
            const f = t.filter_json ? JSON.parse(t.filter_json) : { include: [], exclude: [] };
            const result = filterUtils.filterTournaments([t], f)[0];
            if (result && result.included !== false) filtered.push(result);
        }
        tournaments = filtered;
    }
    const savedPages = await db.getSavedPages();
    const cats = categorizeTournaments(tournaments);
    res.render('index', {
        games,
        tiers,
        tournaments,
        currentTournaments: cats.current,
        upNextTournaments: cats.upNext,
        nextTournaments: cats.next,
        pastTournaments: cats.past,
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
