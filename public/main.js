document.addEventListener('DOMContentLoaded', async () => {
    fetchGames();
    fetchSavedPages();
});

let selectedGame = null;
let selectedTier = null;
let filters = { include: [], exclude: [] };
let tournaments = [];
let filtersExpanded = false;

async function fetchGames() {
    const res = await fetch('/api/games');
    const { games } = await res.json();
    renderGamesNav(games);
}

function renderGamesNav(games) {
    const nav = document.getElementById('games-nav');
    nav.innerHTML = '';
    const navBar = document.createElement('nav');
    navBar.style.display = 'flex';
    navBar.style.gap = '1rem';
    games.forEach(g => {
        const a = document.createElement('a');
        a.textContent = g.name;
        a.href = '#';
        a.className = selectedGame === g.name ? 'selected' : '';
        a.onclick = (e) => {
            e.preventDefault();
            selectedGame = g.name;
            selectedTier = null;
            fetchTiers();
        };
        navBar.appendChild(a);
    });
    nav.appendChild(navBar);
}

async function fetchTiers() {
    if (!selectedGame) return;
    const res = await fetch(`/api/tiers?game=${encodeURIComponent(selectedGame)}`);
    const { tiers } = await res.json();
    renderTiersNav(tiers);
}

function renderTiersNav(tiers) {
    const nav = document.getElementById('tiers-nav');
    nav.innerHTML = '';
    const navBar = document.createElement('nav');
    navBar.style.display = 'flex';
    navBar.style.gap = '1rem';
    tiers.forEach(t => {
        const a = document.createElement('a');
        a.textContent = t.url.split('/').pop();
        a.href = '#';
        a.className = selectedTier === t.id ? 'selected' : '';
        a.onclick = (e) => {
            e.preventDefault();
            selectedTier = t.id;
            fetchTournaments();
            fetchFilters();
        };
        navBar.appendChild(a);
    });
    nav.appendChild(navBar);
}

async function fetchTournaments() {
    if (!selectedTier) return;
    const res = await fetch(`/api/tournaments?tier_id=${selectedTier}`);
    const data = await res.json();
    tournaments = data.tournaments || [];
    renderTournaments();
}

function renderTournaments() {
    const list = document.getElementById('tourney-list');
    list.innerHTML = '';
    const { include, exclude } = filters;
    const filtered = tournaments.map(t => {
        let included = true;
        if (include && include.length) {
            included = include.some(f => applyFilterRule(t, f));
        }
        if (exclude && exclude.length) {
            if (exclude.some(f => applyFilterRule(t, f))) included = false;
        }
        return { ...t, included };
    });
    filtered.forEach(t => {
        const div = document.createElement('div');
        div.className = 'tourney' + (t.included ? '' : ' gray');
        div.innerHTML = `
          <div class="title">${t.name}</div>
          <div class="meta">Date: ${t.start_date || t.date}</div>
          <div class="meta">Prize Pool: ${t.prize_pool || t.prizePool}</div>
          <div class="meta">Location: ${t.location}</div>
        `;
        if (!t.included && !filtersExpanded) div.classList.add('hidden');
        list.appendChild(div);
    });
}

function applyFilterRule(t, rule) {
    const val = t.name.toLowerCase();
    const ruleVal = rule.value.toLowerCase();
    if (rule.type === 'has') return val.includes(ruleVal);
    if (rule.type === 'starts') return val.startsWith(ruleVal);
    if (rule.type === 'ends') return val.endsWith(ruleVal);
    if (rule.type === 'hasnot') return !val.includes(ruleVal);
    return false;
}

async function fetchFilters() {
    if (!selectedTier) return;
    const res = await fetch(`/api/filters?tier_id=${selectedTier}`);
    const data = await res.json();
    filters = {
        include: Array.isArray(data.filters?.include) ? data.filters.include : [],
        exclude: Array.isArray(data.filters?.exclude) ? data.filters.exclude : []
    };
    renderFiltersUI();
    renderTournaments();
}

function renderFiltersUI() {
    const ui = document.getElementById('filters-ui');
    ui.innerHTML = '';
    if (!filtersExpanded) return;
    filters.include = Array.isArray(filters.include) ? filters.include : [];
    filters.exclude = Array.isArray(filters.exclude) ? filters.exclude : [];
    const addRow = (type) => {
        const div = document.createElement('div');
        const select = document.createElement('select');
        ['has', 'starts', 'ends', 'hasnot'].forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            select.appendChild(o);
        });
        const input = document.createElement('input');
        input.placeholder = 'Value';
        const btn = document.createElement('button');
        btn.textContent = 'Add';
        btn.onclick = () => {
            filters[type].push({ type: select.value, value: input.value });
            saveFilters();
        };
        div.appendChild(select);
        div.appendChild(input);
        div.appendChild(btn);
        ui.appendChild(div);
    };
    ui.appendChild(document.createTextNode('Include rules:'));
    filters.include.forEach((f, i) => {
        const d = document.createElement('div');
        d.textContent = `${f.type} "${f.value}"`;
        const rm = document.createElement('button');
        rm.textContent = 'Remove';
        rm.onclick = () => { filters.include.splice(i, 1); saveFilters(); };
        d.appendChild(rm);
        ui.appendChild(d);
    });
    addRow('include');
    ui.appendChild(document.createTextNode('Exclude rules:'));
    filters.exclude.forEach((f, i) => {
        const d = document.createElement('div');
        d.textContent = `${f.type} "${f.value}"`;
        const rm = document.createElement('button');
        rm.textContent = 'Remove';
        rm.onclick = () => { filters.exclude.splice(i, 1); saveFilters(); };
        d.appendChild(rm);
        ui.appendChild(d);
    });
    addRow('exclude');
}

async function saveFilters() {
    await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier_id: selectedTier, filters })
    });
    renderTournaments();
    renderFiltersUI();
}

document.getElementById('filter-toggle').onclick = () => {
    filtersExpanded = !filtersExpanded;
    document.getElementById('filters-ui').classList.toggle('hidden', !filtersExpanded);
    document.getElementById('filter-toggle').textContent = filtersExpanded ? 'Hide Filters' : 'Show Filters';
    renderFiltersUI();
    renderTournaments();
};

async function fetchSavedPages() {
    const res = await fetch('/api/saved-pages');
    const { pages } = await res.json();
    renderSavedPages(pages);
}

function renderSavedPages(pages) {
    const container = document.getElementById('saved-pages-list');
    container.innerHTML = '<h3>Saved Pages</h3>';
    if (!pages.length) {
        container.innerHTML += '<div>No saved pages found.</div>';
        return;
    }
    pages.forEach(page => {
        const div = document.createElement('div');
        div.style.marginBottom = '0.5rem';
        div.innerHTML = `<span>${page.url}</span> `;
        const btn = document.createElement('button');
        btn.textContent = 'Resubmit';
        btn.onclick = async () => {
            const status = document.getElementById('submit-status');
            status.textContent = 'Resubmitting...';
            try {
                const res = await fetch('/api/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: page.url })
                });
                if (!res.ok) throw new Error('Failed');
                status.textContent = 'Success!';
                await fetchGames();
            } catch {
                status.textContent = 'Error!';
            }
        };
        div.appendChild(btn);
        container.appendChild(div);
    });
}

document.getElementById('submit-link').onclick = async () => {
    const url = document.getElementById('input-url').value;
    const status = document.getElementById('submit-status');
    status.textContent = 'Submitting...';
    try {
        const res = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        if (!res.ok) throw new Error('Failed');
        status.textContent = 'Success!';
        await fetchGames();
        await fetchSavedPages();
    } catch {
        status.textContent = 'Error!';
    }
};
