import { WebClient } from '@slack/web-api';

// ==== 設定値(すべてGitHub ActionsのSecretsから読み込みます) ====
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const token = process.env.SLACK_BOT_TOKEN;
const rmChannelId = process.env.RM_CHANNEL_ID; // 投稿先(本番RMチャンネル)のチャンネルID
const minutesUrl = process.env.MINUTES_URL;    // 固定の議事録URL
const meetUrl = process.env.MEET_URL;          // 固定のMeet URL(使い回し)
const meetingLabel = process.env.MEETING_LABEL || '定例会21:00-21:30';
const meetingTimeRange = process.env.MEETING_TIME_RANGE || '21:00–21:30';

if (!minutesUrl || !meetUrl) {
  console.error('必要な環境変数(MINUTES_URL, MEET_URL)が設定されていません');
  process.exit(1);
}

// DRY_RUN=1 のときは、SLACK_BOT_TOKENやRM_CHANNEL_IDがなくても
// 組み立てたメッセージの中身だけを確認できます(実際には投稿しません)
if (!dryRun && (!token || !rmChannelId)) {
  console.error(
    '必要な環境変数(SLACK_BOT_TOKEN, RM_CHANNEL_ID)が設定されていません(確認だけしたい場合は DRY_RUN=1 を付けて実行してください)'
  );
  process.exit(1);
}

// 今日の日付を「Thursday, Aug 27」のような形式にする(JST基準)
function formatTodayJst() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(now);
}

function buildBlocks() {
  const today = formatTodayJst();

  // <!channel> は Slack上で実際に「@channel」としてチャンネル全員に通知を飛ばすための書き方です
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📋 RM定例のお知らせ', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '<!channel>\nお疲れ様です！\n本日の議事録と会議リンクです',
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📝 *議事録*\n<${minutesUrl}|議事録を開く>` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🗓 *${meetingLabel}*\n${today} · ${meetingTimeRange}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🎥 Meetに参加する', emoji: true },
          url: meetUrl,
          style: 'primary',
        },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Google Meet joining info ・ ${meetUrl}` }],
    },
  ];
}

async function main() {
  const blocks = buildBlocks();

  if (dryRun) {
    console.log('=== DRY RUN: 実際には投稿していません ===');
    console.log(JSON.stringify({ blocks }, null, 2));
    return;
  }

  const client = new WebClient(token);
  await client.chat.postMessage({
    channel: rmChannelId,
    text: 'RM定例のお知らせ',
    blocks,
  });

  console.log('投稿しました');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
