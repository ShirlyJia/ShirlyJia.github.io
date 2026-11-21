// Mainland China. Add each year's State Council notice here before counting it.
// Each holiday range includes both dates. Makeup shifts take precedence over weekends.
const schedules = [
  {year: 2024, // https://app.www.gov.cn/govdata/gov/202310/25/508678/article.html
    holidays: [['01-01'], ['02-10', '02-17'], ['04-04', '04-06'], ['05-01', '05-05'], ['06-10'], ['09-15', '09-17'], ['10-01', '10-07']],
    shifts: ['02-04', '02-18', '04-07', '04-28', '05-11', '09-14', '09-29', '10-12']},
  {year: 2025, // https://big5.www.gov.cn/gate/big5/www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm
    holidays: [['01-01'], ['01-28', '02-04'], ['04-04', '04-06'], ['05-01', '05-05'], ['05-31', '06-02'], ['10-01', '10-08']],
    shifts: ['01-26', '02-08', '04-27', '09-28', '10-11']},
  {year: 2026, // https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html
    holidays: [['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'], ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'], ['10-01', '10-07']],
    shifts: ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10']},
];

const dayMs = 86_400_000;
const calendars = schedules.map(({year, holidays, shifts}) => {
  const start = Date.UTC(year, 0, 1) / dayMs;
  const end = Date.UTC(year + 1, 0, 1) / dayMs - 1;
  const prefix = [0];
  for (let day = start; day <= end; day++) {
    const date = new Date(day * dayMs);
    const md = date.toISOString().slice(5, 10);
    const weekday = date.getUTCDay();
    const holiday = holidays.some(([first, last = first]) => first <= md && md <= last);
    const working = shifts.includes(md) || (weekday > 0 && weekday < 6 && !holiday);
    prefix.push(prefix.at(-1) + Number(working));
  }
  return {start, end, prefix};
});

/** Calendar dates in (from, to], or [from, to] for a scheduled work window.
 * count is a lower bound when an annual schedule is missing. */
export function countWorkdays(from, to, {includeStart = false} = {}) {
  const first = Date.parse(from + 'T00:00:00Z') / dayMs + (includeStart ? 0 : 1);
  const last = Date.parse(to + 'T00:00:00Z') / dayMs;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return {count: 0, complete: false};
  if (first > last) return {count: 0, complete: true};
  let covered = 0, count = 0;
  for (const {start, end, prefix} of calendars) {
    const low = Math.max(first, start), high = Math.min(last, end);
    if (low > high) continue;
    covered += high - low + 1;
    count += prefix[high - start + 1] - prefix[low - start];
  }
  return {count, complete: covered === last - first + 1};
}
