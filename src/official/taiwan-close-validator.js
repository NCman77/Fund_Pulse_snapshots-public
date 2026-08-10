import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TWSE_DATED_URL = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

function taipeiDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value).filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildTwseDatedUrl(date) {
  return `${TWSE_DATED_URL}?date=${encodeURIComponent(String(date).replace(/-/g, ''))}&type=ALLBUT0999&response=json`;
}

function officialDate(value) {
  const compact = String(value || '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(compact)) return '';
  return `${Number(compact.slice(0, 3)) + 1911}-${compact.slice(3, 5)}-${compact.slice(5, 7)}`;
}

function numberOrNull(value) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized || normalized === '--') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, fetchImpl, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Fund-Pulse-public-close-check/1.0' },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`Official Taiwan close endpoint failed (${response.status}).`);
      const payload = await response.json();
      if (!Array.isArray(payload) || !payload.length) throw new Error('Official Taiwan close endpoint returned no rows.');
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(attempt * 2_000);
      }
    }
  }
  console.warn(`[taiwan-close-validator] Endpoint ${url} unavailable after ${maxAttempts} attempts: ${lastError?.message}`);
  return null;
}

async function fetchTwseDatedRows(date, fetchImpl, maxAttempts = 3) {
  const url = buildTwseDatedUrl(date);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Fund-Pulse-public-close-check/1.0' },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`Official Taiwan dated close endpoint failed (${response.status}).`);
      const payload = await response.json();
      const compactDate = String(date).replace(/-/g, '');
      const table = (payload?.tables || []).find(({ fields, data }) => Array.isArray(fields) && Array.isArray(data)
        && fields.includes('證券代號') && fields.includes('收盤價'));
      if (payload?.stat !== 'OK' || String(payload?.date || '') !== compactDate || !table) {
        throw new Error('Official Taiwan dated close endpoint returned no matching daily table.');
      }
      const fieldIndex = new Map(table.fields.map((field, index) => [field, index]));
      const rocDate = `${String(Number(compactDate.slice(0, 4)) - 1911).padStart(3, '0')}${compactDate.slice(4)}`;
      return table.data.map((row) => ({
        Date: rocDate,
        Code: row[fieldIndex.get('證券代號')],
        Name: row[fieldIndex.get('證券名稱')],
        ClosingPrice: row[fieldIndex.get('收盤價')],
        TradeVolume: row[fieldIndex.get('成交股數')]
      }));
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(attempt * 2_000);
    }
  }
  console.warn(`[taiwan-close-validator] Endpoint ${url} unavailable after ${maxAttempts} attempts: ${lastError?.message}`);
  return null;
}

async function walkJson(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJson(target);
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  }))).flat();
}

async function latestReferenceSnapshot(root, date) {
  const directory = path.join(root, 'data', 'raw', 'asia', 'tw', date.slice(0, 4), date);
  const candidates = [];
  for (const filePath of await walkJson(directory)) {
    const snapshot = await readJson(filePath);
    const scheduledMs = new Date(snapshot?.scheduledAt || snapshot?.capturedAt || '').getTime();
    if (snapshot?.market !== 'tw' || !Array.isArray(snapshot?.quotes) || !Number.isFinite(scheduledMs)) continue;
    candidates.push({ filePath, snapshot, scheduledMs });
  }
  candidates.sort((left, right) => left.scheduledMs - right.scheduledMs || left.filePath.localeCompare(right.filePath));
  return candidates.at(-1) || null;
}

function officialRowsBySymbol(twseRows = [], tpexRows = []) {
  const rows = new Map();
  (twseRows || []).forEach((row) => rows.set(`${row.Code}.TW`, {
    venue: 'TWSE', date: officialDate(row.Date), name: row.Name,
    close: numberOrNull(row.ClosingPrice), tradeVolume: numberOrNull(row.TradeVolume)
  }));
  (tpexRows || []).forEach((row) => rows.set(`${row.SecuritiesCompanyCode}.TWO`, {
    venue: 'TPEx', date: officialDate(row.Date), name: row.CompanyName,
    close: numberOrNull(row.Close), tradeVolume: numberOrNull(row.TradingShares)
  }));
  return rows;
}

async function validateTaiwanOfficialClose({ root, date = '', fetchImpl = fetch, now = new Date() }) {
  const requestedDate = date || taipeiDate(now);
  const [latestTwseRows, tpexRows, approved, holdingMappings] = await Promise.all([
    fetchJson(TWSE_URL, fetchImpl),
    fetchJson(TPEX_URL, fetchImpl),
    readJson(path.join(root, 'config', 'public-symbols', 'approved-public-tickers.json')),
    readJson(path.join(root, 'config', 'public-holdings', 'approved-holding-symbols.json'), { mappings: [] })
  ]);

  let twseRows = latestTwseRows;
  let twseSourceUrl = TWSE_URL;
  const latestTwseDates = Array.from(new Set((latestTwseRows || []).map((row) => officialDate(row.Date)).filter(Boolean)));
  if (!latestTwseRows || latestTwseDates.length !== 1 || latestTwseDates[0] !== requestedDate) {
    const datedRows = await fetchTwseDatedRows(requestedDate, fetchImpl);
    if (datedRows) {
      twseRows = datedRows;
      twseSourceUrl = buildTwseDatedUrl(requestedDate);
    }
  }

  if (!twseRows || !tpexRows) {
    return { status: 'not_available', requestedDate, officialDates: [] };
  }

  const rows = officialRowsBySymbol(twseRows, tpexRows);
  const sourceDates = Array.from(new Set([...rows.values()].map((row) => row.date).filter(Boolean)));
  if (sourceDates.length !== 1 || sourceDates[0] !== requestedDate) {
    return { status: 'not_available', requestedDate, officialDates: sourceDates };
  }

  const tradeDate = sourceDates[0];
  const target = path.join(root, 'data', 'official-close', 'tw', tradeDate.slice(0, 4), `${tradeDate}.json`);
  const existing = await readJson(target);
  if (existing) return { status: 'already_verified', date: tradeDate, target, record: existing };

  const expectedSymbols = Array.from(new Set([
    ...(approved?.markets?.tw || []).map(({ symbol }) => String(symbol)),
    ...(holdingMappings?.mappings || [])
      .filter(({ market, symbol }) => market === 'tw' && /\.TWO?$/.test(String(symbol)))
      .map(({ symbol }) => String(symbol))
  ])).sort();
  const reference = await latestReferenceSnapshot(root, tradeDate);
  const referenceQuotes = new Map((reference?.snapshot?.quotes || []).map((quote) => [String(quote.symbol), quote]));
  const symbols = expectedSymbols.map((symbol) => {
    const official = rows.get(symbol) || null;
    const quote = referenceQuotes.get(symbol) || null;
    const officialClose = official?.close ?? null;
    const referenceClose = numberOrNull(quote?.close);
    const difference = officialClose !== null && referenceClose !== null ? referenceClose - officialClose : null;
    return {
      symbol,
      venue: official?.venue || (symbol.endsWith('.TWO') ? 'TPEx' : 'TWSE'),
      name: official?.name || '',
      officialClose,
      officialTradeVolume: official?.tradeVolume ?? null,
      publicReferenceClose: referenceClose,
      publicReferenceQuoteAt: quote?.quoteAt || '',
      difference: difference === null ? null : Number(difference.toFixed(6)),
      matchStatus: officialClose === null ? 'official_missing'
        : referenceClose === null ? 'reference_missing'
          : Math.abs(difference) <= 0.0001 ? 'matched' : 'different'
    };
  });
  const officialCompleteCount = symbols.filter(({ officialClose }) => officialClose !== null).length;
  const comparableCount = symbols.filter(({ matchStatus }) => ['matched', 'different'].includes(matchStatus)).length;
  const matchedCount = symbols.filter(({ matchStatus }) => matchStatus === 'matched').length;
  const record = {
    schemaVersion: '1.0',
    market: 'tw',
    date: tradeDate,
    checkedAt: now.toISOString(),
    source: {
      type: 'official_post_close',
      twse: { name: 'Taiwan Stock Exchange OpenAPI', url: twseSourceUrl },
      tpex: { name: 'Taipei Exchange OpenAPI', url: TPEX_URL }
    },
    officialCoverage: {
      complete: expectedSymbols.length > 0 && officialCompleteCount === expectedSymbols.length,
      expectedSymbolCount: expectedSymbols.length,
      availableSymbolCount: officialCompleteCount
    },
    publicReference: reference ? {
      path: path.relative(root, reference.filePath).split(path.sep).join('/'),
      capturedAt: reference.snapshot.capturedAt || '',
      scheduledAt: reference.snapshot.scheduledAt || ''
    } : null,
    comparison: {
      status: !comparableCount ? 'reference_unavailable' : matchedCount === comparableCount ? 'matched' : 'different',
      comparableCount,
      matchedCount,
      differentCount: comparableCount - matchedCount
    },
    symbols
  };
  await writeJsonAtomically(target, record);
  await writeJsonAtomically(path.join(root, 'data', 'status', 'official-close', 'tw.json'), {
    market: 'tw', date: tradeDate, status: record.officialCoverage.complete ? 'verified' : 'partial',
    updatedAt: record.checkedAt, sourceType: record.source.type,
    officialCoverage: record.officialCoverage, comparison: record.comparison,
    archivePath: path.relative(root, target).split(path.sep).join('/')
  });
  return { status: 'verified', date: tradeDate, target, record };
}

export { TPEX_URL, TWSE_URL, buildTwseDatedUrl, officialDate, validateTaiwanOfficialClose };
