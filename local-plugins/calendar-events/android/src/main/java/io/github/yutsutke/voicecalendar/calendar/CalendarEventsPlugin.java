package io.github.yutsutke.voicecalendar.calendar;

import android.Manifest;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * DraftEvent → CalendarContract 保存（永続層アダプタの Android native 側。SPEC §5 / §6）。
 *
 * 契約（adapters/calendar.js の eventKitAdapter と一致させる＝iOS の CalendarEventsPlugin.swift と同じ）:
 *   save({ title, startMs, endMs, allDay, location, note })
 *                     → { id, calendarTitle, calendarSource }
 *   getTarget()       → { authorized, found, title, source, sourceType, id, warning? }
 *   openSettings()    → {}
 *
 * 権限（iOS との違い＝正直にそう作る）:
 * - **Android には iOS17 の「書き込み専用」に当たる権限が無い**。CalendarContract へ直接
 *   INSERT するには WRITE_CALENDAR が要り、書き込み先カレンダーの一覧を得る（＝CALENDAR_ID を
 *   決める）には READ_CALENDAR が要る。よって READ+WRITE の両方を要求する（ゆう決定 2026-07-23・
 *   権限ゼロの Intent 方式は保存のたび OS の編集画面が挟まり背骨②「仲介者を消す」に反するため不採用）。
 * - 読めるのは権限上の話で、**このアプリは既存予定を読まない**（SPEC §3: v0 は書くだけ。
 *   読むのは保存先カレンダーの一覧だけ＝getTarget/save の宛先解決に使う）。
 * - 拒否済みからの復帰導線として openSettings()（iOS v23 と同じ配線。JS は PERMISSION_DENIED を
 *   見てバナー＋「設定を開く」を出す）。getTarget は権限を**要求しない**（設定画面を開いただけで
 *   ダイアログを出さない＝iOS と同じ）。
 *
 * 保存先＝**主カレンダー1本**。iOS の defaultCalendarForNewEvents に当たる OS API が Android には
 * 無いため、機械的に1つへ解決する: ① IS_PRIMARY=1（アカウントの主カレンダー・普通は Google
 * アカウント本体＝Google 同期でライフログ側にもそのまま流れる） ② Google アカウントの書き込み可
 * ③ 書き込み可の先頭。どれをどう選んだかは getTarget が返す＝「今どこへ入るか」を画面で見せる
 * （「保存できたのに見つからない」を防ぐ＝v23 と同じ）。
 * 🚫 アプリ内のカレンダー選択 UI は作らない（iOS v23-v25 で作って実機で外した経緯と同じ線。
 *    Android は読めるので技術的には可能だが、まず iOS と同じ「1本」で実機の実データを見てから）。
 */
@CapacitorPlugin(
    name = "CalendarEvents",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }, alias = "calendar")
    }
)
public class CalendarEventsPlugin extends Plugin {

    /** 端末に在るカレンダー1本の素性（**書き込み不可のものも作る**＝一覧に出して選択の材料にする） */
    private static class Target {
        long id;
        String title = "";
        String account = "";
        String accountType = "";
        long access = 0;
        boolean visible;
        boolean syncEvents;
        boolean primary;
        boolean writable;
        int rank = 9; // 小さいほど優先（0=primary / 1=Google / 2=その他書き込み可）
    }

    private boolean hasCalendarAccess() {
        return getPermissionState("calendar") == PermissionState.GRANTED;
    }

    // ---- JS → native の数値の受け取り（v66 の実バグ。ここを間違えると Android だけ全滅する） ----

    /**
     * JS から来た数値を long で取り出す。
     *
     * 🚨 **ms エポックに `call.getDouble()` を使ってはいけない**（v66 で実機が全滅した場所）:
     * Capacitor 8 の PluginCall#getDouble は値が **Double / Float / Integer の時だけ**通し、
     * それ以外は既定値（null）を返す（node_modules/@capacitor/android/.../PluginCall.java:238）。
     * bridge は JS の JSON を org.json でパースするが、org.json は整数リテラルを
     * **Integer に収まればInteger・収まらなければ Long** で持つ。ms エポック
     * （例 1784812680000）は Integer.MAX_VALUE の 800 倍以上＝**必ず Long**
     * → getDouble は必ず null → 「必須です」で毎回 reject＝**カレンダー保存が一度も成功しない**。
     *
     * iOS(Swift) の同じコードは CAPPluginCall.getDouble が NSNumber 経由なので Long でも通る
     * ＝**同じ契約・同じ引数名なのに Android でだけ壊れる**。JS のテストは 476/476 通っていた
     * （JS ⇄ native の**型**は JS 側からは見えない）＝実機まで誰も気づけない種類の事故。
     *
     * → Number として受けて longValue() に落とす（Integer/Long/Double/Float のどれで来ても同じ）。
     */
    private static Long msOf(PluginCall call, String key) {
        Object v = call.getData().opt(key);
        return (v instanceof Number) ? ((Number) v).longValue() : null;
    }

    /** 実際に何が来たかを人が読める形に（診断＝v15/v16「数字を出す」。toast にそのまま出る） */
    private static String raw(PluginCall call, String key) {
        Object v = call.getData().opt(key);
        if (v == null || v == org.json.JSONObject.NULL) return "なし";
        return v.getClass().getSimpleName() + ":" + v;
    }

    /**
     * 欠けている必須値を人の言葉で返す（揃っていれば null）。
     * 🚨 **3項目を1つの文言にまとめない**: v65 は「title / startMs / endMs は必須です」の一括で、
     * 「タイトルが空」と「JS→native の型で落ちた」が区別できず、症状から原因へ辿れなかった。
     * 型（Long/Integer）と実値まで出す＝次に同じ疑いが出た時、推測でなく数字で判定できる。
     */
    private static String missingMessage(PluginCall call) {
        java.util.List<String> miss = new java.util.ArrayList<>();
        if (call.getString("title") == null) miss.add("タイトルが空です");
        if (msOf(call, "startMs") == null) miss.add("開始が未入力です（startMs=" + raw(call, "startMs") + "）");
        if (msOf(call, "endMs") == null) miss.add("終了を作れませんでした（endMs=" + raw(call, "endMs") + "）");
        return miss.isEmpty() ? null : android.text.TextUtils.join(" / ", miss);
    }

    // ---- save ----

    @PluginMethod
    public void save(PluginCall call) {
        String missing = missingMessage(call);
        if (missing != null) {
            call.reject(missing);
            return;
        }
        if (!hasCalendarAccess()) {
            requestPermissionForAlias("calendar", call, "calendarPermCallback");
            return;
        }
        write(call);
    }

    @PermissionCallback
    private void calendarPermCallback(PluginCall call) {
        if (hasCalendarAccess()) {
            write(call);
        } else {
            // JS 側はこのコードを見て「設定を開く」導線を出す（iOS v23 と同じ配線）
            call.reject("カレンダーへのアクセスが許可されていません", "PERMISSION_DENIED");
        }
    }

    private void write(PluginCall call) {
        // 権限ダイアログを挟んで戻ってくる経路（calendarPermCallback）があるので、値はここで読み直す。
        // 二重の門にしてあるのは、null 束縛のまま unbox すると **NPE でアプリごと落ちる**ため
        // （黙って捨てないの裏＝黙って落ちない）。通常は save() で弾かれている。
        String missing = missingMessage(call);
        if (missing != null) {
            call.reject(missing);
            return;
        }
        String title = call.getString("title");
        long startMs = msOf(call, "startMs");
        long endMs = msOf(call, "endMs");
        boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));
        String location = call.getString("location");
        String note = call.getString("note");

        // v68: 呼び手が保存先を指定できる（詳細設定「保存先カレンダー」）。空＝自動選択（従来）
        java.util.List<Target> all = queryCalendars();
        String wanted = call.getString("calendarId");
        Target cal = resolveTarget(all, wanted);
        if (cal == null) {
            if (wanted != null && !wanted.isEmpty()) {
                // 🚨 **黙って別の暦へ倒さない**（v25 の轍）。選び直せる場所も文言で示す
                call.reject("選んだ保存先カレンダー（id=" + wanted + "）が見つかりません。詳細設定の「保存先カレンダー」で選び直してください。", "TARGET_NOT_FOUND");
            } else {
                call.reject("書き込み先のカレンダーが見つかりません（端末のカレンダーアプリでアカウントを確認）");
            }
            return;
        }

        ContentValues v = new ContentValues();
        v.put(CalendarContract.Events.CALENDAR_ID, cal.id);
        v.put(CalendarContract.Events.TITLE, title);
        if (location != null && !location.isEmpty()) v.put(CalendarContract.Events.EVENT_LOCATION, location);
        if (note != null && !note.isEmpty()) v.put(CalendarContract.Events.DESCRIPTION, note);
        if (allDay) {
            // CalendarContract の終日は「UTC の 0時」で持つ決まり。JS からはローカル 0時の ms が来る
            // （materialize の仕様）ので、ローカルの年月日を取り出して UTC 0時に置き直す。
            // DTEND は排他的＝翌日 0時（.ics アダプタの +1日 と同じ）。
            v.put(CalendarContract.Events.ALL_DAY, 1);
            v.put(CalendarContract.Events.DTSTART, utcMidnightOf(startMs));
            v.put(CalendarContract.Events.DTEND, utcMidnightOf(endMs) + 86400000L);
            v.put(CalendarContract.Events.EVENT_TIMEZONE, "UTC");
        } else {
            v.put(CalendarContract.Events.DTSTART, startMs);
            v.put(CalendarContract.Events.DTEND, endMs);
            v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
        }

        try {
            Uri uri = getContext().getContentResolver().insert(CalendarContract.Events.CONTENT_URI, v);
            if (uri == null) {
                call.reject("カレンダーへの保存に失敗しました");
                return;
            }
            long eventId = ContentUris.parseId(uri);
            // **どこに入れたかを返す**＝JS が保存 toast に出す（「入ったが見つからない」を防ぐ）
            JSObject out = new JSObject();
            out.put("id", String.valueOf(eventId));
            out.put("calendarTitle", cal.title);
            out.put("calendarSource", cal.account);
            // v67: **書いた行を読み返して返す**（下の readBack を参照）
            out.put("verify", readBack(eventId) + " " + requestSync(cal));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("カレンダーへの保存に失敗: " + e.getMessage());
        }
    }

    // ---- v67: 「入ったのに見えない」を推測で語らないための計器 ----

    /**
     * 🚨 **insert が URI を返した ≠ 期待した行がそこに在る**。
     * v66 で「保存は成功したのに Google カレンダーに出ない」に当たった時、
     * 手元にあったのは「成功した」という事実だけで、**行が在るのか・どの暦に入ったのか・
     * 日時が何になったのか・同期待ちなのか**を誰も見られなかった（Mac も PC も繋がっていない実機）。
     * → **書いた直後に自分で読み返す**。READ_CALENDAR は保存先の解決のために既に持っている。
     *
     * v15/v16 の「数字を診断に出す」の永続版＝次に同じ疑いが出た時、推測でなく1行で判定できる。
     * 読めない列（同期系）は端末差があるので**落ちたら狭い projection で再クエリ**（黙って壊れない）。
     */
    private String readBack(long eventId) {
        String[] wide = {
            CalendarContract.Events.CALENDAR_ID, CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART, CalendarContract.Events.ALL_DAY,
            CalendarContract.Events.EVENT_TIMEZONE, CalendarContract.Events.DELETED,
            CalendarContract.Events.DIRTY, CalendarContract.Events._SYNC_ID };
        String[] narrow = {
            CalendarContract.Events.CALENDAR_ID, CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART, CalendarContract.Events.ALL_DAY,
            CalendarContract.Events.EVENT_TIMEZONE };
        String r = readBackWith(eventId, wide);
        if (r == null) r = readBackWith(eventId, narrow);
        // 🚨 読み返せない＝**insert は成功したと言ったのに行が無い**。黙って成功と言い続けない
        return r == null ? ("読返=✗ 行が見つからない id=" + eventId) : r;
    }

    private String readBackWith(long eventId, String[] proj) {
        Uri uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId);
        try (Cursor c = getContext().getContentResolver().query(uri, proj, null, null, null)) {
            if (c == null || !c.moveToFirst()) return null;
            StringBuilder sb = new StringBuilder("読返=✓");
            sb.append(" id=").append(eventId);
            sb.append(" cal=").append(str(c, CalendarContract.Events.CALENDAR_ID));
            sb.append(" 題=").append(str(c, CalendarContract.Events.TITLE));
            sb.append(" 開始=").append(fmt(lng(c, CalendarContract.Events.DTSTART)));
            sb.append(" 終日=").append(str(c, CalendarContract.Events.ALL_DAY));
            sb.append(" tz=").append(str(c, CalendarContract.Events.EVENT_TIMEZONE));
            String deleted = str(c, CalendarContract.Events.DELETED);
            if (deleted != null) sb.append(" 削除=").append(deleted);
            String dirty = str(c, CalendarContract.Events.DIRTY);
            // dirty=1 かつ syncId 無し＝「端末には在るがまだ Google へ上がっていない」＝同期待ち
            if (dirty != null) sb.append(" 未同期=").append(dirty);
            if (hasCol(c, CalendarContract.Events._SYNC_ID)) {
                String sid = str(c, CalendarContract.Events._SYNC_ID);
                sb.append(" syncId=").append(sid == null || sid.isEmpty() ? "なし" : "有");
            }
            return sb.toString();
        } catch (Exception e) {
            return null; // 呼び手が狭い projection で再挑戦
        }
    }

    private static boolean hasCol(Cursor c, String name) { return c.getColumnIndex(name) >= 0; }
    private static String str(Cursor c, String name) {
        int i = c.getColumnIndex(name);
        return (i < 0 || c.isNull(i)) ? null : c.getString(i);
    }
    private static Long lng(Cursor c, String name) {
        int i = c.getColumnIndex(name);
        return (i < 0 || c.isNull(i)) ? null : c.getLong(i);
    }
    private static String fmt(Long ms) {
        if (ms == null) return "なし";
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("MM/dd HH:mm", java.util.Locale.JAPAN);
        return f.format(new java.util.Date(ms));
    }

    /**
     * 直書きした行は「dirty」として置かれ、**そのアカウントの同期アダプタが次に走るまで
     * Google 側へ上がらない**（端末内には在るので端末のカレンダー表示には出る）。
     * 定期同期を待たずに一度つついておく＝「保存したのにしばらく Web に出ない」を減らす。
     * ⚠ これは**仮説への保険であって原因の特定ではない**。効いたかどうかは上の readBack の
     *    `未同期`/`syncId` で見る（推測を事実として書かない）。失敗しても保存は成功のまま。
     */
    private String requestSync(Target cal) {
        try {
            if (cal.account == null || cal.account.isEmpty() || cal.accountType == null || cal.accountType.isEmpty()) {
                return "同期要求=対象不明";
            }
            android.accounts.Account acc = new android.accounts.Account(cal.account, cal.accountType);
            android.os.Bundle b = new android.os.Bundle();
            b.putBoolean(android.content.ContentResolver.SYNC_EXTRAS_MANUAL, true);
            b.putBoolean(android.content.ContentResolver.SYNC_EXTRAS_EXPEDITED, true);
            android.content.ContentResolver.requestSync(acc, CalendarContract.AUTHORITY, b);
            return "同期要求=出した";
        } catch (Exception e) {
            return "同期要求=✗(" + e.getClass().getSimpleName() + ")";
        }
    }

    /**
     * v69: **保存できること と Google に届くことは別**（実機FB第38回で確定）。
     *
     * ゆうの端末では Android が作った予定が1件も Google のサーバに届いていなかった（接続済み
     * Google アカウントを直接照会して 0件を確認）。一方 iPhone から入れた同じ日の予定は届いていた
     * ＝ **CalendarContract への書き込みは成功していて、端末→Google の同期だけが動いていない**。
     *
     * 直書きした行は dirty=1 で置かれ、**そのアカウントの同期アダプタ**が上げる。動くかどうかは
     * カレンダー権限ではなく **アカウントの同期設定**が決める:
     *   - マスター自動同期（端末全体）
     *   - そのアカウント×カレンダーの自動同期
     *   - そもそも syncable か（0 なら何をしても上がらない）
     * → **全部読んで出す**。ここが見えないと「保存はできたのに見つからない」を実機の画面から
     *    説明できない（v23 で「今どこへ入るか」を出したのと同じ理由の、同期版）。
     */
    private String syncInfo(Target cal) {
        try {
            if (cal.account == null || cal.account.isEmpty() || cal.accountType == null || cal.accountType.isEmpty()) {
                return "同期=対象不明";
            }
            android.accounts.Account acc = new android.accounts.Account(cal.account, cal.accountType);
            String auth = CalendarContract.AUTHORITY;
            StringBuilder sb = new StringBuilder();
            sb.append("端末の自動同期=").append(android.content.ContentResolver.getMasterSyncAutomatically() ? "ON" : "OFF");
            sb.append(" このアカウントの暦同期=").append(android.content.ContentResolver.getSyncAutomatically(acc, auth) ? "ON" : "OFF");
            int syncable = android.content.ContentResolver.getIsSyncable(acc, auth);
            sb.append(" 同期可=").append(syncable); // 0＝このアカウントで暦は同期しない設定＝何をしても上がらない
            sb.append(" 実行中=").append(android.content.ContentResolver.isSyncActive(acc, auth) ? 1 : 0);
            sb.append(" 待ち=").append(android.content.ContentResolver.isSyncPending(acc, auth) ? 1 : 0);
            return sb.toString();
        } catch (Exception e) {
            // 権限が無い端末でも黙らない（何が読めなかったかを出す）
            return "同期=読めず(" + e.getClass().getSimpleName() + ")";
        }
    }

    /**
     * v69: その暦に**まだ Google へ上がっていない行**が何件あるか（dirty=1）。
     * 🚨 これが**増えるだけで減らないなら、同期は動いていない**＝1つの数字で判定できる
     *    （保存直後の `未同期=1` は正常なので、それだけでは詰まりを見分けられなかった）。
     * 読めない端末では -1（＝不明。0 と混ぜない＝「無い」と嘘をつかない）。
     */
    private int dirtyCount(long calendarId) {
        String[] proj = { CalendarContract.Events._ID };
        String sel = CalendarContract.Events.CALENDAR_ID + "=? AND " + CalendarContract.Events.DIRTY + "=1";
        try (Cursor c = getContext().getContentResolver().query(
                CalendarContract.Events.CONTENT_URI, proj, sel, new String[]{ String.valueOf(calendarId) }, null)) {
            return c == null ? -1 : c.getCount();
        } catch (Exception e) {
            return -1;
        }
    }

    /** JS のローカル 0時 ms → その年月日の UTC 0時 ms（終日イベント用） */
    private long utcMidnightOf(long localMs) {
        Calendar local = Calendar.getInstance(); // 端末のタイムゾーン
        local.setTimeInMillis(localMs);
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        utc.clear();
        utc.set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH));
        return utc.getTimeInMillis();
    }

    // ---- 保存先の解決 ----

    /**
     * 端末のカレンダーを**全部**取る（書き込み不可も含む）。IS_PRIMARY 列は一部 OEM の Provider が
     * projection に入れると例外を投げることがある → 落ちたら IS_PRIMARY 抜きで再クエリ（黙って壊れない）。
     */
    private java.util.List<Target> queryCalendars() {
        java.util.List<Target> all = tryQuery(true);
        if (all == null) all = tryQuery(false);
        return all == null ? new java.util.ArrayList<Target>() : all;
    }

    /**
     * 🚨 **機械的に1本へ decide できるのは、候補が1本のときだけ**（v68 で実機が教えた）。
     * 「主（IS_PRIMARY）」は**アカウントごとに1つある**ので、Google アカウントが2つ在る端末では
     * rank 0 が2つできる → 下の `t.rank < best.rank` は**先に見つかった方**を残す＝
     * 実質「端末に先に追加されたアカウント」＝ユーザーから見れば**完全に恣意的**。
     * 実機（実機FB第37回）では yahoo と gmail の両方が「主・表示・同期」で並び、
     * アプリは yahoo を選び、ゆうが見ていたのは gmail だった＝**保存は成功しているのに見えない**。
     *
     * iOS にこの問題が無いのは **OS が「新規イベントの既定カレンダー」を1つ持っている**から（v26 は
     * それに乗った）。**Android にその OS 設定は無い**＝自動選択は「候補が1本の時の便宜」でしかない。
     * → 呼び手（JS の詳細設定）が id を指定できる。指定が無い時だけこの自動選択に落ちる。
     */
    private Target pickDefault(java.util.List<Target> all) {
        Target best = null;
        for (Target t : all) {
            if (!t.writable) continue;
            if (best == null || t.rank < best.rank) best = t;
        }
        return best;
    }

    /**
     * 保存先を決める。指定が在ればそれ、無ければ自動選択。
     * 🚨 **指定された暦が見つからない／書き込めない時に、黙って別の暦へ倒さない**（null を返す）。
     * v25（iOS）で「選んだカレンダーになっているのに別のカレンダーに保存される」を踏んでいる＝
     * 選択が効かないより、**効かないことが分かる**方がよい（SPEC §7 silent wrong answer の禁止）。
     */
    private Target resolveTarget(java.util.List<Target> all, String wantedId) {
        if (wantedId == null || wantedId.isEmpty()) return pickDefault(all);
        for (Target t : all) if (String.valueOf(t.id).equals(wantedId) && t.writable) return t;
        return null;
    }

    /** 書き込み可の候補が2本以上あるか＝**自動選択が恣意的になる状況**（JS が注意書きを出す材料） */
    private boolean isAmbiguous(java.util.List<Target> all) {
        int n = 0;
        for (Target t : all) if (t.writable) n++;
        return n > 1;
    }

    /**
     * v67: 列は**番号ではなく名前で引く**（`getColumnIndex`）。v65 は projection の並びと
     * `c.getInt(4)` のような添字を人間が対応させており、**列を1つ足すだけで意味が総崩れになる**
     * （しかも例外は出ず、別の列を読んで黙って違う暦を選ぶ＝v66 と同じ silent wrong answer の形）。
     */
    private java.util.List<Target> tryQuery(boolean withPrimary) {
        java.util.List<String> proj = new java.util.ArrayList<>(java.util.Arrays.asList(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.VISIBLE,
            CalendarContract.Calendars.SYNC_EVENTS));
        if (withPrimary) proj.add(CalendarContract.Calendars.IS_PRIMARY);

        java.util.List<Target> all = new java.util.ArrayList<>();
        try (Cursor c = getContext().getContentResolver().query(
                CalendarContract.Calendars.CONTENT_URI, proj.toArray(new String[0]), null, null, null)) {
            if (c == null) return null;
            while (c.moveToNext()) {
                Long access = lng(c, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL);
                Target t = new Target();
                t.id = or(lng(c, CalendarContract.Calendars._ID), -1L);
                t.title = or(str(c, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME), "");
                t.account = or(str(c, CalendarContract.Calendars.ACCOUNT_NAME), "");
                t.accountType = or(str(c, CalendarContract.Calendars.ACCOUNT_TYPE), "");
                t.access = access == null ? 0 : access;
                t.visible = !"0".equals(str(c, CalendarContract.Calendars.VISIBLE));
                t.syncEvents = !"0".equals(str(c, CalendarContract.Calendars.SYNC_EVENTS));
                t.primary = withPrimary && str(c, CalendarContract.Calendars.IS_PRIMARY) != null
                    && !"0".equals(str(c, CalendarContract.Calendars.IS_PRIMARY));
                t.writable = access != null && access >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR;
                if (t.primary && t.visible) t.rank = 0;
                else if ("com.google".equals(t.accountType) && t.visible) t.rank = 1;
                else if (t.visible) t.rank = 2;
                else t.rank = 3;
                // 🚨 **書き込み不可の暦も捨てない**＝一覧に出す（「在るのに選べない」と「そもそも無い」は別の話）
                all.add(t);
            }
        } catch (Exception e) {
            return null; // withPrimary=true で落ちた時は呼び手が false で再クエリ
        }
        return all;
    }

    /** 候補を JS へ（**表示の文言は JS 側で作る**＝native はデータだけ返す。SPEC §6 の境界） */
    private com.getcapacitor.JSArray candidatesJson(java.util.List<Target> all) {
        java.util.List<JSObject> rows = new java.util.ArrayList<>();
        for (Target t : all) {
            JSObject o = new JSObject();
            o.put("id", String.valueOf(t.id));
            o.put("title", t.title);
            o.put("account", t.account);
            o.put("sourceType", sourceTypeName(t.accountType));
            o.put("access", t.access);
            o.put("writable", t.writable);
            o.put("visible", t.visible);
            o.put("syncEvents", t.syncEvents);
            o.put("primary", t.primary);
            rows.add(o);
        }
        return new com.getcapacitor.JSArray(rows);
    }

    private static String or(String v, String dflt) { return v == null ? dflt : v; }
    private static long or(Long v, long dflt) { return v == null ? dflt : v; }

    /** 保存先の「素性」を人の言葉に（iOS の sourceTypeName と同じ役割） */
    private String sourceTypeName(String accountType) {
        if ("com.google".equals(accountType)) return "Google";
        if (CalendarContract.ACCOUNT_TYPE_LOCAL.equals(accountType)) return "この端末内";
        if (accountType != null && accountType.toLowerCase(java.util.Locale.ROOT).contains("exchange")) return "Exchange";
        return accountType == null ? "" : accountType;
    }

    // ---- getTarget ----

    /** 今どこへ入るかを返す（**権限を要求しない**）。未許可なら authorized:false を返すだけ */
    @PluginMethod
    public void getTarget(PluginCall call) {
        JSObject out = new JSObject();
        if (!hasCalendarAccess()) {
            out.put("authorized", false);
            out.put("found", false);
            call.resolve(out);
            return;
        }
        java.util.List<Target> all = queryCalendars();
        String wanted = call.getString("calendarId");
        Target cal = resolveTarget(all, wanted);
        out.put("authorized", true);
        // v67: 端末に在る暦を**選ばれなかったものも含めて**返す＝「なぜそこに入ったのか」を画面で辿れる。
        // v68: 選択 UI の材料でもある（found でない時も返す＝選び直せないと詰む）
        out.put("candidates", candidatesJson(all));
        out.put("chosen", wanted == null ? "" : wanted);
        // v68: 書き込み可が2本以上＝自動選択が恣意的＝JS が「選んでください」と促す材料
        out.put("ambiguous", isAmbiguous(all));
        if (cal == null) {
            out.put("found", false);
            out.put("warning", (wanted != null && !wanted.isEmpty())
                ? "選んだ保存先カレンダー（id=" + wanted + "）が今は見つかりません。下から選び直してください。"
                : "書き込み先のカレンダーが見つかりません（端末のカレンダーアプリでアカウントを確認）");
            call.resolve(out);
            return;
        }
        out.put("found", true);
        out.put("id", String.valueOf(cal.id));
        out.put("title", cal.title);
        out.put("source", cal.account);
        out.put("sourceType", sourceTypeName(cal.accountType));
        out.put("auto", wanted == null || wanted.isEmpty()); // 自動で決めたのか、選ばれたものか
        // v69: **保存できること と Google に届くことは別**（実機FB第38回）＝同期の素性と滞留件数
        out.put("sync", syncInfo(cal));
        out.put("pending", dirtyCount(cal.id));
        // JS が「保存はできますが Google には上がりません」と言い切れる条件だけを true にする
        // （読めなかった時に false ＝「大丈夫」と嘘をつかない。不明は不明のまま扱う）
        out.put("syncBlocked", isSyncBlocked(cal));
        call.resolve(out);
    }

    /**
     * 「このアカウントは何をしても Google へ上がらない」と**言い切れる**時だけ true。
     * 🚨 読めなかった／判断が付かない時は false（＝警告を出さない）にする。ここで曖昧を true に
     *    倒すと、正常な端末に嘘の警告を出すことになる（v27 の「創作しない」と同じ線）。
     */
    private boolean isSyncBlocked(Target cal) {
        try {
            if (cal.account == null || cal.account.isEmpty() || cal.accountType == null || cal.accountType.isEmpty()) return false;
            android.accounts.Account acc = new android.accounts.Account(cal.account, cal.accountType);
            String auth = CalendarContract.AUTHORITY;
            if (android.content.ContentResolver.getIsSyncable(acc, auth) == 0) return true;   // 暦は同期しない設定
            if (!android.content.ContentResolver.getMasterSyncAutomatically()) return true;   // 端末全体の自動同期がオフ
            if (!android.content.ContentResolver.getSyncAutomatically(acc, auth)) return true; // このアカウントの暦同期がオフ
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /** 拒否済み権限からの復帰導線（設定アプリの本アプリのページを開く） */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
