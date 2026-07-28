import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMoneyDjFundDisclosure } from '../src/collectors/moneydj-fund-collector.js';

test('keeps MoneyDJ disclosures as public raw NAV and holdings fields', () => {
  const disclosure = parseMoneyDjFundDisclosure({
    fundId: 'TEST01', configuredName: '公開測試基金',
    navHtml: '淨值日期<tr><td>2026/07/28</td><td>10.50</td><td>0.25</td>',
    holdingsHtml: '基金投資分佈(依產業)<td class=t3t1>科技</td><td class=t3n1>100</td><td class=t3n1>50</td>基金投資分佈(依持有類股)<td class=t3t1>股票</td><td class=t3n1>100</td><td class=t3n1>50</td>投資明細資料月份：2026/06/30<td class=t3t1>公開公司</td><td class=t3n1>100</td><td class=t3n1>12.5%</td><td class=t3n1>-1.0%</td>自104年6月份起',
    basicHtml: '基金經理人</td><td class=t3t2><a href="#">公開經理人</a></td>'
  });
  assert.deepEqual(disclosure.nav, { date: '2026-07-28', value: 10.5, changeAmount: 0.25 });
  assert.equal(disclosure.holdingsDisclosure.date, '2026-06-30');
  assert.deepEqual(disclosure.holdingsDisclosure.holdings, [{ name: '公開公司', shares: 100, weightPercent: 12.5, monthlyChangePercent: -1 }]);
  assert.deepEqual(disclosure.fundProfile.managerNames, ['公開經理人']);
  assert.deepEqual(disclosure.holdingsDisclosure.industryWeights, [{ industry: '科技', amount: 100, weightPercent: 50 }]);
});
