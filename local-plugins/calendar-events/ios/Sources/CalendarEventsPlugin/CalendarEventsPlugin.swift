import Foundation
import UIKit
import Capacitor
import EventKit
import EventKitUI

/// DraftEvent → EventKit 保存（永続層アダプタの native 側。SPEC §5 永続層 / §6）。
///
/// 契約（adapters/calendar.js の eventKitAdapter と一致させる）:
///   save({ title, startMs, endMs, allDay, location, note, calendarId })
///                                   → { id, calendarTitle, calendarSource, resolvedById, warning? }
///   getTarget({ calendarId })       → { authorized, found, title, source, sourceType, id, resolvedById, warning? }
///   chooseCalendar()                → { cancelled } | { id, title, source, sourceType, cancelled:false }
///   openSettings()                  → {}
///
/// 権限:
/// - iOS 17+ は **書き込み専用アクセス**（requestWriteOnlyAccessToEvents）＝「追加のみ」の軽い
///   ダイアログで、既存予定の読み取り権限を要求しない（SPEC §3: v0 は書くだけ。読みは v1）。
///   Info.plist: NSCalendarsWriteOnlyAccessUsageDescription
/// - iOS 16 以前は従来の requestAccess(to: .event)。Info.plist: NSCalendarsUsageDescription
/// - 拒否済みからの復帰導線として openSettings() を用意（あの日 v215 のカメラ権限の教訓:
///   「拒否が残ると回復導線がない」を最初から塞ぐ）。※ v23 で JS 側の導線を実際に配線した
///   ——それまでこのメソッドは**誰からも呼ばれていないデッドコード**だった。
///
/// 保存先カレンダー（v23）:
/// - write-only では **アプリはカレンダー一覧を読めない**（既存イベントもカレンダーリストも不可）。
///   → 一覧を自前 UI で見せる設計は不可能。**EKCalendarChooser（システム側の UI）**を出し、
///   ユーザーが選んだ1件だけを受け取る＝「追加のみ」の軽い権限のまま選べる（Apple 明記:
///   "EKEventEditViewController and EKCalendarChooser require write-only or full access"）。
///   アプリが一覧を覗かない形はローカル完結の思想（SPEC §2）とも噛み合う。
@objc(CalendarEventsPlugin)
public class CalendarEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CalendarEventsPlugin"
    public let jsName = "CalendarEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTarget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chooseCalendar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private let store = EKEventStore()

    /// EKCalendarChooser は delegate で結果が返る＝その間 call を保持する
    /// （Capacitor の Camera プラグインと同じ流儀）。
    private var pendingChooserCall: CAPPluginCall?

    // MARK: - 権限

    /// 現在の権限を**要求せずに**見る。設定画面を開いただけで権限ダイアログが出るのを避ける
    /// （SPEC §2「仲介者を消す」＝頼んでいないのに出るダイアログは仲介者）。
    private func hasWriteAccess() -> Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            return status == .writeOnly || status == .fullAccess
        }
        return status == .authorized
    }

    private func requestWriteAccess(_ completion: @escaping (Bool, Error?) -> Void) {
        if #available(iOS 17.0, *) {
            store.requestWriteOnlyAccessToEvents(completion: completion)
        } else {
            store.requestAccess(to: .event, completion: completion)
        }
    }

    /// 権限を確認してから body を main スレッドで走らせる。拒否は PERMISSION_DENIED で返す
    /// （JS 側はこのコードを見て「設定を開く」導線を出す＝v23 で配線済み）。
    private func withWriteAccess(_ call: CAPPluginCall, _ body: @escaping () -> Void) {
        requestWriteAccess { granted, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject("カレンダー権限の確認に失敗: \(error.localizedDescription)")
                    return
                }
                guard granted else {
                    call.reject("カレンダーへのアクセスが許可されていません", "PERMISSION_DENIED")
                    return
                }
                body()
            }
        }
    }

    // MARK: - 保存先の解決

    /// 保存先を決める。
    ///
    /// 🔴 **write-only で calendar(withIdentifier:) が動くかは Apple のドキュメントに記述が無い**
    /// （カレンダー一覧の読み取りは write-only では禁止＝識別子1件の解決も弾かれる可能性がある）。
    /// → **どちらに転んでも壊れない形**にして実機で判定する（v22 の「起動Nms」と同じ手＝憶測で終わらせない）:
    ///     解決できた   → その保存先を使う
    ///     解決できない → 既定カレンダーへ倒し、**warning を返して画面に出す**
    ///                    ＝**黙って別のカレンダーに保存しない**（v16「黙って捨てない」の保存版。
    ///                      予定が意図と違う場所に静かに入るのは、入らないことより悪い）
    /// resolvedById は診断に出す＝実機で1回見れば可否が確定する。
    private func resolveCalendar(preferredId: String?) -> (calendar: EKCalendar?, warning: String?, resolvedById: Bool) {
        if let id = preferredId, !id.isEmpty {
            if let cal = store.calendar(withIdentifier: id) {
                return (cal, nil, true)
            }
            return (store.defaultCalendarForNewEvents,
                    "選んだカレンダーが見つからないため、既定のカレンダーに保存しました",
                    false)
        }
        return (store.defaultCalendarForNewEvents, nil, false)
    }

    private func describe(_ cal: EKCalendar) -> [String: Any] {
        return [
            "id": cal.calendarIdentifier,
            "title": cal.title,
            "source": cal.source?.title ?? "",
            "sourceType": sourceTypeName(cal.source?.sourceType)
        ]
    }

    /// 保存先の「素性」を人の言葉に。**明日の検証で「Google に出たか」を画面で見るための語**
    /// （OS の既定が Google なら source.title が Gmail アカウント名・sourceType が calDAV になる。
    ///  アプリは Google と直接通信しない＝SPEC §1-6 の証明が画面に出る）。
    private func sourceTypeName(_ t: EKSourceType?) -> String {
        guard let t = t else { return "" }
        switch t {
        case .local: return "この iPhone 内"
        case .exchange: return "Exchange"
        case .calDAV: return "CalDAV（Google / iCloud など）"
        case .mobileMe: return "iCloud"
        case .subscribed: return "購読カレンダー"
        case .birthdays: return "誕生日"
        @unknown default: return "不明"
        }
    }

    // MARK: - save

    @objc func save(_ call: CAPPluginCall) {
        guard let title = call.getString("title"),
              let startMs = call.getDouble("startMs"),
              let endMs = call.getDouble("endMs") else {
            call.reject("title / startMs / endMs は必須です")
            return
        }

        withWriteAccess(call) { [weak self] in
            self?.write(call, title: title, startMs: startMs, endMs: endMs)
        }
    }

    private func write(_ call: CAPPluginCall, title: String, startMs: Double, endMs: Double) {
        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = Date(timeIntervalSince1970: startMs / 1000)
        event.endDate = Date(timeIntervalSince1970: endMs / 1000)
        event.isAllDay = call.getBool("allDay") ?? false
        if let location = call.getString("location"), !location.isEmpty { event.location = location }
        if let note = call.getString("note"), !note.isEmpty { event.notes = note }

        // 保存先: 選択済みがあればそこへ。無ければ既定カレンダーへ
        // （OS 設定で Google を既定にしていれば OS が Google へ同期する。アプリは Google と直接通信しない＝SPEC §1-6）
        let target = resolveCalendar(preferredId: call.getString("calendarId"))
        guard let calendar = target.calendar else {
            call.reject("書き込み先のカレンダーが見つかりません（OS のカレンダー設定を確認）")
            return
        }
        event.calendar = calendar

        do {
            try store.save(event, span: .thisEvent, commit: true)
            // **どこに入れたかを返す**＝JS が保存 toast に出す（「入ったが見つからない」を防ぐ）
            var out: [String: Any] = [
                "id": event.eventIdentifier ?? "",
                "calendarTitle": calendar.title,
                "calendarSource": calendar.source?.title ?? "",
                "resolvedById": target.resolvedById
            ]
            if let w = target.warning { out["warning"] = w }
            call.resolve(out)
        } catch {
            call.reject("カレンダーへの保存に失敗: \(error.localizedDescription)")
        }
    }

    // MARK: - getTarget

    /// 現在の保存先を返す（**権限を要求しない**）。設定画面を開いただけでダイアログを出さないため、
    /// 未許可なら authorized:false を返すだけにする（JS は「保存するときに聞きます」と出す）。
    @objc func getTarget(_ call: CAPPluginCall) {
        guard hasWriteAccess() else {
            call.resolve(["authorized": false, "found": false])
            return
        }
        let target = resolveCalendar(preferredId: call.getString("calendarId"))
        guard let cal = target.calendar else {
            call.resolve([
                "authorized": true,
                "found": false,
                "warning": "書き込み先のカレンダーが見つかりません（OS のカレンダー設定を確認）"
            ])
            return
        }
        var out = describe(cal)
        out["authorized"] = true
        out["found"] = true
        out["resolvedById"] = target.resolvedById
        if let w = target.warning { out["warning"] = w }
        call.resolve(out)
    }

    // MARK: - chooseCalendar

    /// カレンダーを選ぶ＝**システム側の UI（EKCalendarChooser）**を出す。
    /// write-only のままで動く（アプリは一覧を読まない・選ばれた1件だけが返る）。
    /// write-only では displayStyle は無視され .writableCalendarsOnly として振る舞う（Apple 明記）が、
    /// 意図を明示するため .writableCalendarsOnly を渡す（書けないカレンダーを選ばせても保存に失敗するだけ）。
    @objc func chooseCalendar(_ call: CAPPluginCall) {
        withWriteAccess(call) { [weak self] in
            guard let self = self else { return }
            guard self.pendingChooserCall == nil else {
                call.reject("カレンダー選択が既に開いています")
                return
            }
            guard let host = self.bridge?.viewController else {
                call.reject("カレンダー選択の画面を出せませんでした")
                return
            }

            let chooser = EKCalendarChooser(
                selectionStyle: .single,
                displayStyle: .writableCalendarsOnly,
                entityType: .event,
                eventStore: self.store
            )
            chooser.showsDoneButton = true
            chooser.showsCancelButton = true
            chooser.delegate = self

            self.pendingChooserCall = call
            // Done / Cancel は navigation bar に出る＝UINavigationController に包む必要がある
            let nav = UINavigationController(rootViewController: chooser)
            host.present(nav, animated: true, completion: nil)
        }
    }

    /// 拒否済み権限からの復帰導線（設定アプリの本アプリのページを開く）
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }
}

// MARK: - EKCalendarChooserDelegate

extension CalendarEventsPlugin: EKCalendarChooserDelegate {
    public func calendarChooserDidFinish(_ calendarChooser: EKCalendarChooser) {
        finishChooser(calendarChooser.selectedCalendars.first)
    }

    public func calendarChooserDidCancel(_ calendarChooser: EKCalendarChooser) {
        finishChooser(nil)
    }

    /// selected が nil = キャンセル、または何も選ばずに Done。
    /// どちらも **cancelled:true ＝ 保存先を変更しない**（黙って既定に戻したりしない）。
    private func finishChooser(_ selected: EKCalendar?) {
        DispatchQueue.main.async {
            self.bridge?.viewController?.dismiss(animated: true, completion: nil)
            guard let call = self.pendingChooserCall else { return }
            self.pendingChooserCall = nil
            if let cal = selected {
                var out = self.describe(cal)
                out["cancelled"] = false
                call.resolve(out)
            } else {
                call.resolve(["cancelled": true])
            }
        }
    }
}
