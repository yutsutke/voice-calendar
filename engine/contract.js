// engine/contract.js — AI 連携の契約（v39・un-park「LLM 解釈」「複数予定一括」）
//
// 「まとめて入力」の入口3つ（JSON 貼り付け / BYOK AI / WebMCP）が共有する**単一の契約**。
// JSON Schema 形のオブジェクトを1箇所に置き、
//   - AI へのプロンプト（engine/batch.js buildPrompt）に**この現物を埋め込む**
//   - WebMCP の inputSchema に**この現物を渡す**（v41）
//   - 検証ゲート（engine/batch.js parseBatch）の規則と**テストで鏡合わせ**にする
// ＝スキーマの description（日本語の意味的制約）がそのまま AI への仕様書になる。二重管理ゼロ。
//
// なぜ .json ファイルでなく .js か:
//   ① <script src="...?v=N"> に乗る＝tests/version.test.js のキャッシュ規律が無改修で効く
//      （fetch で読む .json の ?v= は機械強制できない＝v10 の罠が再発する）
//   ② WebMCP の registerTool({inputSchema}) は JS オブジェクトが要る
//   ③ fetch の読み込み失敗という新しい沈黙点を作らない（v13/v16）
//
// ⚠️ events.items.properties のキーは engine/schema.js の FIELDS と鏡合わせ
//    （tests/batch.test.js が一致を強制）。欄を増やす時は両方＋parser の FIELD_KEYS も見る。
(function (global) {
  'use strict';

  const VERSION = '1.0.0';

  const DATE_DESC = '。「明日」「来週金曜」などの相対表現は、指示にある現在日時を基準に解決する。';
  const OMIT_DESC = '本文で言っていなければキーごと省略する（推測で補わない）。';

  const SCHEMA = {
    type: 'object',
    required: ['events'],
    additionalProperties: false,
    properties: {
      events: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description: '読み取れた予定・記録の一覧。本文に書かれた順に並べる。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: {
              type: 'string',
              description: '予定・記録の要件。本文の言葉をそのまま使う（要約・言い換え・創作をしない）。',
            },
            startDate: {
              type: 'string',
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              description: '開始日 YYYY-MM-DD' + DATE_DESC + OMIT_DESC,
            },
            startTime: {
              type: 'string',
              pattern: '^\\d{2}:\\d{2}$',
              description: '開始時刻 HH:MM（24時間制）。' + OMIT_DESC + '「朝」「夕方」だけなら省略して ambiguities に書く。',
            },
            endDate: {
              type: 'string',
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              description: '終了日 YYYY-MM-DD' + DATE_DESC + OMIT_DESC,
            },
            endTime: {
              type: 'string',
              pattern: '^\\d{2}:\\d{2}$',
              description: '終了時刻 HH:MM（24時間制）。' + OMIT_DESC,
            },
            location: {
              type: 'string',
              description: '場所。' + OMIT_DESC,
            },
            note: {
              type: 'string',
              description: 'メモ。他の欄に入らない補足の受け皿（持ち物・URL・連絡事項など）。' + OMIT_DESC,
            },
            allDay: {
              type: 'boolean',
              description: '終日の予定なら true。明示がなければ省略する。',
            },
            ambiguities: {
              type: 'array',
              items: { type: 'string' },
              description: '確信が持てなかった点を日本語で申告する（例:「17時か17時半か読み取れない」「来週=今週の可能性」）。曖昧なまま値を入れた項目は必ずここに書く。',
            },
          },
        },
      },
      sourceText: {
        type: 'string',
        description: '解釈元の原文（任意・来歴用）。',
      },
    },
  };

  const api = { SCHEMA, VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCContract = api;
})(typeof window !== 'undefined' ? window : globalThis);
