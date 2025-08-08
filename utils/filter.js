function applyFilterRule(t, rule) {
    const val = (t.name || '').toLowerCase();
    const ruleVal = (rule.value || '').toLowerCase();
    if (rule.type === 'has') return val.includes(ruleVal);
    if (rule.type === 'starts') return val.startsWith(ruleVal);
    if (rule.type === 'ends') return val.endsWith(ruleVal);
    if (rule.type === 'hasnot') return !val.includes(ruleVal);
    return false;
}

function filterTournaments(tournaments, filters) {
    if (!filters) return tournaments.map(t => ({...t, included: true}));
    const include = Array.isArray(filters.include) ? filters.include : [];
    const exclude = Array.isArray(filters.exclude) ? filters.exclude : [];
    return tournaments.map(t => {
        let included = true;
        if (include.length) {
            included = include.some(f => applyFilterRule(t, f));
        }
        if (exclude.length) {
            if (exclude.some(f => applyFilterRule(t, f))) included = false;
        }
        return {...t, included};
    });
}

module.exports = {filterTournaments};

