const cheerio = require('cheerio');
const querystring = require('querystring');
const exec = require('child_process').execFile;
const execSync = require('child_process').execSync;
const fs = require('fs');
const { convertArrayToCSV } = require('convert-array-to-csv');
const htmlToText = require('html-to-text');
const _cliProgress = require('cli-progress');

// Configuration constants
const WGET_PATH = '/usr/local/bin/wget';
const MAX_RESULTS = 100;

// Read search terms from file
let terms = fs.readFileSync("./search-terms.txt", "utf-8")
              .split("\n")
              .filter(s => !s.match(/^\s*$|^\s*#/));

//////////////////////////////////////////////////////////////////////////

/*
 * Data structure that allows for a list of unique objects.
 */
class CustomSet {
    constructor(equalsFunc){
        this.equals = equalsFunc;
        this.list = [];
    }

    add(obj){
        for(let el of this.list){
            if(this.equals(obj, el))
                return;
        }

        this.list.push(obj);
    }

    addAll(array){
        for(let item of array)
            this.add(item);
    }

    toArray(){
        return this.list;
    }
}


// Main code

let funcs = new Array(terms.length);
funcs[funcs.length-1] = r => fetchResultsFullText(r.toArray());
for(let i=funcs.length-2; i>=0; i--){
    funcs[i] = r => {
        process.stderr.write(`${terms[i+1]}\n`);
        fetch(terms[i+1], funcs[i+1] ,r);
    }
}

process.stderr.write(`${terms[0]}\n`);
fetch(terms[0], funcs[0]);

//////

// let json = fs.readFileSync("resultado.json", "utf-8");
// fetchResultsFullText(JSON.parse(json));

//////

// Functions

/*
 * Fetch next page from LinkedIn
 */
function fetch(searchTerm, callback, results = new CustomSet(resultsAreEqual), start = 0){

    process.stderr.write(`\tFetching ${start}-${start+25}... `);

    let params = {
        keywords: searchTerm,
        location: 'Brasília, Federal District, Brazil',
        trk: 'homepage-jobseeker_jobs-search-bar_search-submit',
        redirect: 'false',
        position: 1,
        pageNum: 0
    };

    if(start != 0)
        params.start = start;

    const url = 'https://br.linkedin.com/jobs/search?' + querystring.stringify(params);

    const wgetArgs = [url, '-O', 'result.html'];
    exec(
        WGET_PATH, wgetArgs,
        error => {
            if (error) {
                process.stderr.write("error\n");
                start = MAX_RESULTS;
            }
            else{
                start += 25;
                results.addAll( parseHTML(searchTerm) );
                process.stderr.write("ok\n");
            }

            if(start < MAX_RESULTS)
                fetch(searchTerm, callback, results, start);
            else
                callback(results);
        }
    );
}

/*
 * Parse HTML file and return array of objects.
 */
function parseHTML(searchTerm){
    let filename = 'result.html';
    let htmlContents = fs.readFileSync(filename, 'utf-8');

    let $ = cheerio.load(  htmlContents  );

    let titles = $('.result-card__title');
    let subtitles = $('.result-card__subtitle');
    let locations = $('.job-result-card__location');
    let snippets = $('.job-result-card__snippet');
    let links = $('.result-card__full-card-link');

    let size = titles.length;
    for(let el of [subtitles, locations, snippets, links]){
        if(el.length != size) throw Error('Mismatched array sizes while parsing');
    }

    let partialResults = [];

    titles.each((i,el) => {
        partialResults[i] = {
            search: searchTerm,
            title: $(el).text()
        };
    });
    subtitles.each((i,el) => { partialResults[i].subtitle = $(el).text();       });
    locations.each((i,el) => { partialResults[i].location = $(el).text();       });
    snippets.each((i,el)  => { partialResults[i].snippet  = $(el).text();       });
    links.each((i,el)     => { partialResults[i].link     = $(el).attr('href'); });

    return partialResults;
}

/*
 * Returns true if two result objects have the same contents.
 */
function resultsAreEqual(o1, o2){
    if(o1.title    !== o2.title)    return false;
    if(o1.subtitle !== o2.subtitle) return false;
    if(o1.location !== o2.location) return false;
    if(o1.snippets !== o2.snippets) return false;
    return true;
}

/*
 * Fetch results full text;
 */
function fetchResultsFullText (searchResults){
    process.stderr.write("\nFetching full text of results...\n");

    const b1 = new _cliProgress.SingleBar(
        {}, _cliProgress.Presets.shades_classic
    );

    b1.start(searchResults.length, 0);

    for(let result of searchResults){

        execSync(`${WGET_PATH} '${result.link}' -O indresult.html 2> /dev/null`);

        let htmlContents = fs.readFileSync('indresult.html', 'utf-8');
        let $ = cheerio.load(  htmlContents  );

        let txt = htmlToText.fromString(
            $('.description__text').html(),
            {
                wordwrap: false,
                uppercaseHeadings: false,
                singleNewLineParagraphs: true,
                unorderedListItemPrefix: ''
            }
        ).replace(/\n+/g, ' ');

        result.fulltext = txt;
        b1.increment();
    }
    b1.stop();
    process.stderr.write("\nDone!\n");

    console.log( convertArrayToCSV(searchResults) );

}
