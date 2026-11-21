import test from 'node:test';
import assert from 'node:assert/strict';
import {countWorkdays} from './china-workdays.js';

test('工作日扣除休假，计入补班，跨年及闰年按实际日历', () => {
  const cases = [
    ['2024-02-08', '2024-02-09', 1], ['2024-02-09', '2024-02-18', 1],
    ['2024-02-28', '2024-03-01', 2], ['2024-12-31', '2025-01-03', 2],
    ['2025-01-24', '2025-02-05', 3], ['2025-05-30', '2025-06-02', 0],
    ['2026-01-01', '2026-01-04', 1], ['2026-02-13', '2026-02-24', 2],
    ['2026-09-19', '2026-09-20', 1], ['2026-09-30', '2026-10-11', 3],
    ['2026-10-30', '2026-11-01', 0], ['2026-10-30', '2026-11-02', 1],
  ];
  for (const [from, to, count] of cases) {
    assert.deepEqual(countWorkdays(from,to), {count,complete:true}, from+' → '+to);
  }
});

test('交付日差排除起日，核对排期包含起止两日；未收录日历不产生虚假精度', () => {
  assert.deepEqual(countWorkdays('2026-10-10','2026-10-10'), {count:0,complete:true});
  assert.deepEqual(countWorkdays('2026-10-10','2026-10-10',{includeStart:true}), {count:1,complete:true});
  assert.deepEqual(countWorkdays('2026-10-01','2026-10-07',{includeStart:true}), {count:0,complete:true});
  assert.deepEqual(countWorkdays('2026-12-30','2027-01-04'), {count:1,complete:false});
  assert.deepEqual(countWorkdays('2027-01-01','2027-01-04'), {count:0,complete:false});
  assert.deepEqual(countWorkdays('2023-12-31','2024-01-02'), {count:1,complete:true});
});
