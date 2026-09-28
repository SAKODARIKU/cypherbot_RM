import { readFileSync } from 'fs';
import { WebClient } from '@slack/web-api';

const {
  SLACK_BOT_TOKEN,
  RM_CHANNEL_ID,
  MINUTES_URL,
  MEET_URL,
  MEETING_LABEL,
  MEETING_TIME_RANGE,
  SCHEDULE_CSV_URL,
  DRY_RUN,
} = process.env;

const isDryRun = DRY_RUN === '1' || DRY_RUN === 'true';

// ---- 必須環境変数チェック ----
if (!isDryRun) {
  const missing = [];
  if (!SLACK_BOT_TOKEN) missing.push('SLACK_BOT_TOKEN');
  if (!RM_CHANNEL_ID) missing.push('RM_CHANNEL_ID');
  if (missing.length > 0) {
    console.error(`必要な環境変数(${missing.join(', ')})が設定されていません`);
    process.exit(1);
  }
}

if (!MINUTES_URL || !MEET_URL) {
  console.error('必要な環境変数(MINUTES_URL, MEET_URL)が設定されていません');
  process.exit(1);
}

// ---- 日付ユーティリティ(JST基準) ----
// 注意: Date同士のタイムゾーン変換を2回重ねるとズレるバグを踏んだことがあるため、
// 「今の瞬間」から直接Intl.DateTimeFormatでJSTの年月日を1回だけ取り出す方式にしている。
const JST_WEEKDAY_JA = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土', Sun: '日' };

function getJstDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

function toYmd(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatJstDateLabel(parts) {
  const weekday = JST_WEEKDAY_JA[parts.weekday] || parts.weekday;
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日(${weekday})`;
}

// ---- 当番表(Googleスプレッドシートを「ウェブに公開」したCSV)を取得 ----
function parseCsv(text) {
  // ダブルクォート対応の簡易CSVパーサ(コメント欄にカンマが入っていても壊れないように)
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // skip
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseDateCell(raw, fallbackYear) {
  if (!raw) return null;
  const s = raw.trim();

  // YYYY-MM-DD / YYYY/MM/DD
  let m = s.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  // YYYY年M月D日
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  // M/D や M月D日 のように年が省略されている場合は、実行時点のJSTの年を補って解釈する
  // (当番表が年をまたぐ場合だけは、年を明記した行を混ぜてもらえれば優先されます)
  m = s.match(/^(\d{1,2})[/\-](\d{1,2})$/);
  if (!m) m = s.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (m && fallbackYear) {
    return `${fallbackYear}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }

  return null;
}

async function fetchTodaysAssignment(todayYmd) {
  if (!SCHEDULE_CSV_URL) {
    return { found: false, reason: 'no-url' };
  }

  const fallbackYear = todayYmd.slice(0, 4);

  try {
    const res = await fetch(SCHEDULE_CSV_URL);
    if (!res.ok) {
      console.error(`当番表CSVの取得に失敗しました: HTTP ${res.status}`);
      return { found: false, reason: 'fetch-failed' };
    }
    const text = await res.text();
    const rows = parseCsv(text);
    if (rows.length === 0) return { found: false, reason: 'empty' };

    const header = rows[0].map((h) => h.trim());
    const idx = {
      date: header.findIndex((h) => h.includes('日付')),
      main: header.findIndex((h) => h.includes('主担当')),
      deputy: header.findIndex((h) => h.includes('副担当')),
    };

    if (idx.date === -1 || idx.main === -1 || idx.deputy === -1) {
      console.error('当番表のヘッダー(日付/主担当/副担当)が見つかりませんでした');
      return { found: false, reason: 'bad-header' };
    }

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      const ymd = parseDateCell(cells[idx.date], fallbackYear);
      if (ymd === todayYmd) {
        return {
          found: true,
          main: (cells[idx.main] || '').trim(),
          deputy: (cells[idx.deputy] || '').trim(),
        };
      }
    }

    return { found: false, reason: 'no-match' };
  } catch (err) {
    console.error('当番表CSVの取得中にエラーが発生しました:', err.message);
    return { found: false, reason: 'error' };
  }
}

// ---- 名前 -> SlackメンバーID ----
function loadMembers() {
  try {
    const raw = readFileSync(new URL('./members.json', import.meta.url), 'utf8');
    const json = JSON.parse(raw);
    delete json._readme;
    return json;
  } catch {
    return {};
  }
}

function normalizeName(name) {
  return (name || '').trim().replace(/(さん|様)$/u, '');
}

function resolveMention(name, members) {
  const cleaned = normalizeName(name);
  if (!cleaned) return null;
  const id = members[cleaned];
  if (id && /^U[A-Z0-9]+$/.test(id)) {
    return `<@${id}>`;
  }
  return `${cleaned}（Slack ID未登録）`;
}

// ---- メイン処理 ----
async function main() {
  const jstParts = getJstDateParts();
  const todayYmd = toYmd(jstParts);
  const dateLabel = formatJstDateLabel(jstParts);
  const label = MEETING_LABEL || '定例会';
  const timeRange = MEETING_TIME_RANGE || '21:00-21:30';

  const assignment = await fetchTodaysAssignment(todayYmd);
  const members = loadMembers();

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 ${label} 本日の議事録・Meetリンク`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<!channel> お疲れ様です！\n本日（${dateLabel}）の議事録とMeetリンクをお送りします。`,
      },
    },
  ];

  if (assignment.found) {
    const mainMention = resolveMention(assignment.main, members) || '未定';
    const deputyMention = resolveMention(assignment.deputy, members) || '未定';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*本日の進行担当*\n主担当: ${mainMention}　／　副担当: ${deputyMention}`,
      },
    });
  } else if (SCHEDULE_CSV_URL) {
    console.warn(`本日(${todayYmd})の担当が当番表から見つかりませんでした(reason: ${assignment.reason})`);
  }

  blocks.push(
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*議事録:*\n<${MINUTES_URL}|議事録を開く>` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${label}*\n${dateLabel}　${timeRange}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📹 Meetに参加する', emoji: true },
          url: MEET_URL,
          style: 'primary',
        },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `自動投稿 by rm-slack-bot ・ ${dateLabel}` }],
    }
  );

  const payload = {
    channel: RM_CHANNEL_ID,
    text: `${label} 本日の議事録・Meetリンクです`,
    blocks,
  };

  if (isDryRun) {
    console.log('=== DRY RUN: 実際には投稿しません ===');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const client = new WebClient(SLACK_BOT_TOKEN);
  const result = await client.chat.postMessage(payload);
  console.log('Slackへの投稿に成功しました:', result.ts);
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
