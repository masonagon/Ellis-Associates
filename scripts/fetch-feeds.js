const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── SOURCES ──────────────────────────────────────────────────────────────────

const NEWS_SOURCES = [
  // Government
  { name: 'MLive Politics',    url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/politics/',  tag: 'government' },
  { name: 'The Hill',          url: 'https://thehill.com/feed/',                                        tag: 'government' },
  { name: 'Michigan Radio',    url: 'https://www.michiganpublic.org/politics-government/feed',          tag: 'government' },
  // Public Safety
  { name: 'MLive Crime',       url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/crime/',      tag: 'safety' },
  { name: 'The Hill Defense',  url: 'https://thehill.com/policy/defense/feed/',                         tag: 'safety' },
  // Technology
  { name: 'The Hill Tech',     url: 'https://thehill.com/technology/feed/',                             tag: 'technology' },
  { name: 'Michigan MEDC',     url: 'https://www.michiganbusiness.org/feed/',                           tag: 'technology' },
  // Education
  { name: 'MLive Education',   url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/education/', tag: 'education' },
  // Healthcare
  { name: 'The Hill Health',   url: 'https://thehill.com/policy/healthcare/feed/',                      tag: 'health' },
  { name: 'MLive Health',      url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/health/',     tag: 'health' },
  // Business & Industry
  { name: 'MLive Business',    url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/business/',  tag: 'associations' },
  { name: 'The Hill Finance',  url: 'https://thehill.com/policy/finance/feed/',                         tag: 'associations' },
  { name: 'The Hill Economy',  url: 'https://thehill.com/economy/feed/',                                tag: 'associations' },
];

const BILL_URL = 'http://www.legislature.mi.gov/documents/publications/RssFeeds/billupdate.xml';

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fetchUrl(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseXML(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const getLinkFromBlock = (b) => {
      const cdataMatch = b.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/);
      if (cdataMatch) return cdataMatch[1].trim();
      const tagMatch = b.match(/<link>(.*?)<\/link>/);
      if (tagMatch) return tagMatch[1].trim();
      const atomMatch = b.match(/<link[^>]+href=["']([^"']+)["']/);
      if (atomMatch) return atomMatch[1].trim();
      return '';
    };
    items.push({
      title: get('title'),
      desc: get('description').replace(/<[^>]+>/g, '').substring(0, 200),
      link: getLinkFromBlock(block),
      date: get('pubDate') || get('dc:date') || ''
    });
  }
  return items;
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) { return ''; }
}

function isRecent(dateStr, days = 14) {
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
    return diff <= days;
  } catch(e) { return true; }
}

// ── FETCH NEWS ────────────────────────────────────────────────────────────────

async function fetchNewsSource(source) {
  try {
    console.log(`  Fetching ${source.name}...`);
    const xml = await fetchUrl(source.url);
    const items = parseXML(xml);
    const articles = items
      .filter(i => i.title && i.link && isRecent(i.date))
      .slice(0, 10)
      .map(i => ({
        title: i.title,
        desc: i.desc,
        link: i.link,
        date: formatDate(i.date),
        rawDate: i.date,
        source: source.name,
        tag: source.tag
      }));
    console.log(`    Got ${articles.length} articles`);
    return articles;
  } catch(e) {
    console.log(`    Failed: ${e.message}`);
    return [];
  }
}

// ── FETCH BILLS ───────────────────────────────────────────────────────────────

async function fetchBills() {
  try {
    console.log(`  Fetching bills...`);
    const xml = await fetchUrl(BILL_URL);
    const items = parseXML(xml);
    const bills = items
      .filter(i => i.title && i.link)
      .map(i => {
        const numMatch = i.title.match(/\b([HS]B\s?\d+|[HS]JR\s?\d+)/i);
        const yearMatch = i.title.match(/\bof\s+(20\d\d)\b/i);
        return {
          num: numMatch ? numMatch[0].replace(/\s/g, '').toUpperCase() : 'MI',
          year: yearMatch ? yearMatch[1] : '',
          title: i.title.replace(/^[HS]B\s?\d+[:\-\s]*/i, '').replace(/\bof\s+20\d\d\b/i, '').trim() || i.title,
          desc: i.desc,
          link: i.link,
          date: formatDate(i.date)
        };
      });
    console.log(`    Got ${bills.length} bills`);
    return bills;
  } catch(e) {
    console.log(`    Bills failed: ${e.message}`);
    return [];
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching news sources...');
  const newsResults = await Promise.all(NEWS_SOURCES.map(fetchNewsSource));
  let news = newsResults.flat();

  // Deduplicate by title
  const seen = new Set();
  news = news.filter(a => {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date
  news.sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));

  console.log('\nFetching bills...');
  const bills = await fetchBills();

  const output = {
    generated: new Date().toISOString(),
    news,
    bills
  };

  const outPath = path.join(__dirname, '../data/feed.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${news.length} articles and ${bills.length} bills to data/feed.json`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
