const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function escapeRegex(s) {
    return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripGameFromName(name, game) {
    if (!name) return '';
    if (!game) return name;
    const g = String(game).trim();
    let n = String(name).trim();

    const lead = new RegExp('^\\s*' + escapeRegex(g) + '\\s*[:\\-–—\\|]\\s*', 'i');
    n = n.replace(lead, '');

    const dup = new RegExp('^\\s*' + escapeRegex(g) + '\\s+', 'i');
    n = n.replace(dup, '');

    return n;
}

function formatDateBadge(isoString) {
    let badge = { month: '???', day: '?' };
    if (isoString) {
        const d = new Date(isoString);
        if (!isNaN(d)) {
            badge.month = MONTH_NAMES[d.getUTCMonth()];
            badge.day = d.getUTCDate();
        }
    }
    return badge;
}

function formatTournament(t, prefix, formatDateRange) {
    const dn = stripGameFromName(t.name, t.game_name);
    const displayName = dn && dn.trim().length ? dn : t.name;
    const isLive = prefix === 'c';

    return {
        ...t,
        viewData: {
            displayName,
            dateBadge: formatDateBadge(t._sd || t.start_date),
            isLive,
            dateRange: formatDateRange ? formatDateRange(t._sd || t.start_date, t._ed || t.end_date) : '',
            hasPrize: t.prizePool && t.prizePool !== 'N/A',
            hasLocation: t.location && t.location !== 'N/A',
            showEta: prefix === 'u' || prefix === 'n',
            idx: `${prefix}-${Math.random().toString(36).substr(2, 5)}` // simplified unique ID or pass index from loop
        }
    };
}

function getSectionConfigs(current, upcoming, next, past) {
    return [
        {
            title: 'Currently live',
            titleClass: 'text-success',
            list: current,
            itemExtraClass: 'highlight-current',
            prefix: 'c'
        },
        {
            title: 'Upcoming',
            titleClass: 'text-info',
            list: upcoming,
            itemExtraClass: 'highlight-upnext',
            prefix: 'u'
        },
        {
            title: 'Next up',
            titleClass: 'text-primary',
            list: next,
            itemExtraClass: '',
            prefix: 'n'
        }
    ];
}

module.exports = {
    formatTournament,
    getSectionConfigs
};
