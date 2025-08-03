const fs = require('fs');
const cheerio = require('cheerio');

const $ = cheerio.load(html);

const yearHeader = $('span.mw-headline#2025');
const tournamentRows = yearHeader.parent().nextAll('.gridRow');

const tournaments = [];

tournamentRows.each((i, el) => {
    const row = $(el);

    const name = row.find('.gridCell.Tournament.Header a').last().text().trim();
    const date = row.find('.gridCell.EventDetails.Date.Header').text().trim();
    const prize = row.find('.gridCell.EventDetails.Prize.Header').text().trim();
    const location = row.find('.gridCell.EventDetails.Location.Header').text().trim();

    if (name && date && location) {
        tournaments.push({
            name,
            date,
            prizePool: prize || 'N/A',
            location
        });
    }
});

console.log(tournaments);
