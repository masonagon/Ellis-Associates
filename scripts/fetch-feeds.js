const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const NEWS_SOURCES = [
  { name: 'MLive Politics',     url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/politics/',  tag: 'government' },
  { name: 'The Hill Politics',  url: 'https://thehill.com/homenews/feed/',                               tag: 'government' },
  { name: 'Michigan Radio',     url: 'https://www.michiganpublic.org/politics-government/feed',          tag: 'government' },
  { name: 'MLive Crime',        url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/crime/',      tag: 'safety' },
  { name: 'The Hill Defense',   url: 'https://thehill.com/policy/defense/feed/',                         tag: 'safety' },
  { name: 'The Hill Tech',      url: 'https://thehill.com/policy/technology/feed/',                      tag: 'technology' },
  { name: 'Wired',              url: 'https://www.wired.com/feed/rss',                                   tag: 'technology' },
  { name: 'MLive Education',    url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/education/', tag: 'education' },
  { name: 'The Hill Healthcare',url: 'https://thehill.com/policy/healthcare/feed/',                      tag: 'health' },
  { name: 'MLive Health',       url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/health/',     tag: 'health' },
  { name: 'MLive Business',     url: 'https://www.mlive.com/arc/outboundfeeds/rss/category/business/',  tag: 'associations' },
  { name: 'The Hill Finance',   url: 'https://thehill.com/policy/finance/feed/',                         tag: 'associations' },
  { name: 'The Hill Economy',   url: 'https://thehill.com/economy/feed/',                                tag: 'associations' },
];

const BILL_URL = 'http://www.legislature.mi.gov/documents/publications/RssFeeds/billupdate.xml';

function fetchUrl(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
      timeout
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
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
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const get = (tag) => {
      const r = b.match(new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>|<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>'));
      return r ? (r[1] || r[2] || '').trim() : '';
    };
    const getLink = (bl) => {
      const c = bl.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/);
      if (c) return c[1].trim();
      const t = bl.match(/<link>(.*?)<\/link>/);
      if (t) return t[1].trim();
      const a = bl.match(/<link[^>]+href=["']([^"']+)["']/);
      if (a) return a[1].trim();
      return '';
    };
    items.push({ title: get('title'), desc: get('description').replace(/<[^>]*\/?>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim().substring(0, 200), link: getLink(b), date: get('pubDate') || get('dc:date') || '' });
  }
  return items;
}

function fmtDate(d) { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e) { return ''; } }
function isRecent(d) { try { return (Date.now() - new Date(d).getTime()) / 86400000 <= 14; } catch(e) { return true; } }

const TAG_KEYWORDS = {
  government: ['legislature','governor','senate','house','congress','legislation','bill','law','policy','election','budget','appropriation','lawmaker','committee','whitmer','lansing','capitol','democrat','republican','vote','federal','state government'],
  safety: [],
  technology: ['technology','software','cyber','digital','data','ai','artificial intelligence','drone','broadband','internet','procurement','contract','tech','innovation','algorithm','platform','cloud','automation','surveillance','system','network'],
  education: [],
  health: [],
  associations: ['business','economy','market','trade','finance','industry','company','companies','merger','acquisition','economic','commercial','revenue','corporate','sector']
};

async function fetchNews(source) {
  try {
    console.log('  Fetching ' + source.name + '...');
    const xml = await fetchUrl(source.url);
    const items = parseXML(xml);
    let out = items.filter(i => i.title && i.link && isRecent(i.date)).slice(0, 15)
      .map(i => ({ title: i.title, desc: i.desc, link: i.link, date: fmtDate(i.date), rawDate: i.date, source: source.name, tag: source.tag }));
    // For sources with keyword filters, only keep articles that match
    const keywords = TAG_KEYWORDS[source.tag];
    if (keywords && keywords.length) {
      out = out.filter(a => {
        const text = (a.title + ' ' + a.desc).toLowerCase();
        return keywords.some(k => text.includes(k));
      });
    }
    console.log('    Got ' + out.length);
    return out;
  } catch(e) { console.log('    Failed: ' + e.message); return []; }
}

async function fetchBills() {
  try {
    console.log('  Fetching bills...');
    const xml = await fetchUrl(BILL_URL);
    const items = parseXML(xml);
    const out = items.filter(i => i.title && i.link).map(i => {
      const n = i.title.match(/\b([HS]B\s?\d+|[HS]JR\s?\d+)/i);
      const y = i.title.match(/\bof\s+(20\d\d)\b/i);
      return { num: n ? n[0].replace(/\s/g,'').toUpperCase() : 'MI', year: y ? y[1] : '', title: i.title.replace(/^[HS]B\s?\d+[:\-\s]*/i,'').replace(/\bof\s+20\d\d\b/i,'').trim() || i.title, desc: i.desc, link: i.link, date: fmtDate(i.date) };
    });
    console.log('    Got ' + out.length + ' bills');
    return out;
  } catch(e) { console.log('    Bills failed: ' + e.message); return []; }
}

async function main() {
  console.log('Fetching news...');
  const results = await Promise.all(NEWS_SOURCES.map(fetchNews));
  let news = results.flat();
  const seen = new Set();
  news = news.filter(a => { const k = a.title.toLowerCase().replace(/[^a-z0-9]/g,'').substring(0,40); if (seen.has(k)) return false; seen.add(k); return true; });
  news.sort((a,b) => new Date(b.rawDate) - new Date(a.rawDate));

  console.log('\nFetching bills...');
  const bills = await fetchBills();

  const out = { generated: new Date().toISOString(), news, bills };
  fs.writeFileSync(path.join(__dirname, '../data/feed.json'), JSON.stringify(out, null, 2));
  console.log('\nDone: ' + news.length + ' articles, ' + bills.length + ' bills');
}

main().catch(e => { console.error(e); process.exit(1); });
