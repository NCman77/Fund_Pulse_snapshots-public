const BASE_URL = 'https://www.moneydj.com/funddj';

function text(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value) {
  const normalized = text(value).replace(/,/g, '');
  const parsed = Number(normalized.replace(/%$/, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value) {
  const match = text(value).match(/(\d{4})\/(\d{2})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function section(html, startText, endTexts) {
  const start = html.indexOf(startText);
  if (start < 0) return '';
  const end = endTexts.map((endText) => html.indexOf(endText, start + startText.length))
    .filter((index) => index > start)
    .sort((left, right) => left - right)[0];
  return html.slice(start, end || html.length);
}

function weightedRows(sectionHtml, labelField) {
  const rows = [];
  const pattern = /<td[^>]*class=["']?t3t1[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']?t3n1[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']?t3n1[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = pattern.exec(sectionHtml)) !== null) {
    const label = text(match[1]);
    const weightPercent = number(match[3]);
    if (label && weightPercent !== null) rows.push({ [labelField]: label, amount: number(match[2]), weightPercent });
  }
  return rows;
}

async function readMoneyDjHtml(response) {
  if (typeof response.arrayBuffer === 'function') {
    return new TextDecoder('big5').decode(await response.arrayBuffer());
  }
  return response.text();
}

export function parseMoneyDjFundDisclosure({ fundId, configuredName, navHtml, holdingsHtml, basicHtml = '' }) {
  const navMatch = navHtml.match(/淨值日期[\s\S]*?<tr><td[^>]*>(\d{4}\/\d{2}\/\d{2})<\/td>\s*<td[^>]*>([\d,.]+)<\/td>\s*<td[^>]*>([-+]?\d+(?:\.\d+)?)<\/td>/i);
  const holdingSection = section(holdingsHtml, '投資明細', ['自104年6月份起', '基金投資比例彙總表']);
  const industrySection = section(holdingsHtml, '基金投資分佈(依產業)', ['基金投資分佈(依持有類股)']);
  const holdingClassSection = section(holdingsHtml, '基金投資分佈(依持有類股)', ['投資明細']);
  const disclosureDate = date(holdingSection.match(/資料月份[:：]\s*(\d{4}\/\d{2}\/\d{2})/)?.[1]);
  const rowPattern = /<td[^>]*class=["']?t3t1[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']?t3n1[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']?t3n1[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']?t3n1[^>]*>([\s\S]*?)<\/td>/gi;
  const holdings = [];
  let match;
  while ((match = rowPattern.exec(holdingSection)) !== null) {
    const name = text(match[1]);
    const weightPercent = number(match[3]);
    if (!name || weightPercent === null || /投資名稱|自104年/.test(name)) continue;
    holdings.push({ name, shares: number(match[2]), weightPercent, monthlyChangePercent: number(match[4]) });
  }
  const managerField = basicHtml.match(/基金經理人<\/td>\s*<td[^>]*class=t3t2[^>]*>([\s\S]*?)<\/td>/i)?.[1] || '';
  const managerNames = Array.from(managerField.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)).map((item) => text(item[1])).filter(Boolean);
  return {
    schemaVersion: '1.0', fundId, fundName: configuredName, capturedAt: new Date().toISOString(),
    source: {
      name: 'moneydj-public',
      navUrl: `${BASE_URL}/ya/yp010000.djhtm?a=${encodeURIComponent(fundId)}`,
      holdingsUrl: `${BASE_URL}/yp/yp013000.djhtm?a=${encodeURIComponent(fundId)}`,
      basicUrl: `${BASE_URL}/yp/yp011000.djhtm?a=${encodeURIComponent(fundId)}`
    },
    nav: navMatch ? { date: date(navMatch[1]), value: number(navMatch[2]), changeAmount: number(navMatch[3]) } : null,
    fundProfile: { managerNames },
    holdingsDisclosure: {
      date: disclosureDate, holdings,
      industryWeights: weightedRows(industrySection, 'industry'),
      holdingClassWeights: weightedRows(holdingClassSection, 'holdingClass')
    }
  };
}

export async function collectMoneyDjFundDisclosure(fund, fetchImpl = fetch) {
  const fundId = String(fund.fundId || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(fundId)) throw new Error('Invalid public fund identifier.');
  const navUrl = `${BASE_URL}/ya/yp010000.djhtm?a=${encodeURIComponent(fundId)}`;
  const holdingsUrl = `${BASE_URL}/yp/yp013000.djhtm?a=${encodeURIComponent(fundId)}`;
  const [navResponse, holdingsResponse, basicResponse] = await Promise.all([
    fetchImpl(navUrl, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) }),
    fetchImpl(holdingsUrl, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) }),
    fetchImpl(`${BASE_URL}/yp/yp011000.djhtm?a=${encodeURIComponent(fundId)}`, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) })
  ]);
  if (!navResponse.ok || !holdingsResponse.ok || !basicResponse.ok) throw new Error('Public fund disclosure request failed.');
  return parseMoneyDjFundDisclosure({
    fundId, configuredName: fund.name, navHtml: await readMoneyDjHtml(navResponse), holdingsHtml: await readMoneyDjHtml(holdingsResponse),
    basicHtml: await readMoneyDjHtml(basicResponse)
  });
}
