import Foundation
import UIKit
import Capacitor
import EventKit

/// DraftEvent → EventKit 保存（永続層アダプタの native 側。SPEC §5 永続層 / §6）。
///
/// 契約（adapters/calendar.js の eventKitAdapter と一致させる）:
///   save({ title, startMs, endMs, allDay, location, note })
///                     → { id, calendarTitle, calendarSource }
///   getTarget()       → { authorized, found, title, source, sourceType, id, warning? }
///   openSettings()    → {}
///
/// 権限:
/// - iOS 17+ は **書き込み専用アクセス**（requestWriteOnlyAccessToEvents）＝「追加のみ」の軽い
///   ダイアログで、既存予定の読み取り権限を要求しない（SPEC §3: v0 は書くだけ。読みは v1）。
///   Info.plist: NSCalendarsWriteOnlyAccessUsageDescription
/// - iOS 16 以前は従来の requestAccess(to: .event)。Info.plist: NSCalendarsUsageDescription
/// - 拒否済みからの復帰導線として openSettings()（あの日 v215 のカメラ権限の教訓:
///   「拒否が残ると回復導線がない」を塞ぐ。JS 側の配線は v23）。
///
/// 保存先＝**OS の既定カレンダー1本**（defaultCalendarForNewEvents）。v26 でアプリ内の選択を撤去した。
/// 🚫 **アプリ内カレンダー選択を作り直さないこと**（v23-v25 で作って実機で外した経緯）:
/// - write-only では **アプリはカレンダー一覧を読めない**（既存イベントもリストも不可）＝自前の一覧 UI は不可能。
/// - `EKCalendarChooser`（EventKitUI）は write-only でも開くが、**選択を次の起動へ持ち越せない**:
///   保存できるのは識別子だけで、`calendar(withIdentifier:)` が write-only で機能しない
///   （実機FB第17回「選んだカレンダーになっているのに iOS のカレンダーに保存される」）。
///   チューザーが渡す EKCalendar の現物をプロセス内で保持すれば当座は書けるが（v25）、
///   **アプリを再起動するたび選び直し**＝実用に耐えない。
/// - 「常に別のカレンダーへ」の正解は **OS 設定 → カレンダー → デフォルトカレンダー**。
///   defaultCalendarForNewEvents は write-only で確実に動く（WWDC23 のコード例）＝実機でも成立済み。
///   Google も iOS にアカウントを足して既定にすれば OS が同期する（アプリは Google と直接通信しない＝SPEC §1-6）。
/// - 作り直すなら full access への格上げが要る＝「追加のみ」の軽さ（v0 の売り）とのトレードオフ。
@objc(CalendarEventsPlugin)
public class CalendarEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CalendarEventsPlugin"
    public let jsName = "CalendarEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTarget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private let store = EKEventStore()

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

    // MARK: - カレンダーの素性

    private func describe(_ cal: EKCalendar) -> [String: Any] {
        return [
            "id": cal.calendarIdentifier,
            "title": cal.title,
            "source": cal.source?.title ?? "",
            "sourceType": sourceTypeName(cal.source?.sourceType)
        ]
    }

    /// 保存先の「素性」を人の言葉に。**「Google に出たか」を画面で見るための語**
    /// （既定が Google なら source.title が Gmail アカウント名・sourceType が calDAV になる。
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

        // 保存先は OS の既定カレンダー1本（v26）。ここを変えたい人は OS 設定のデフォルトカレンダーを変える
        // ＝アプリ内選択は write-only では次の起動へ持ち越せず実用にならなかった（上のコメント参照）。
        guard let calendar = store.defaultCalendarForNewEvents else {
            call.reject("書き込み先のカレンダーが見つかりません（OS のカレンダー設定を確認）")
            return
        }
        event.calendar = calendar

        do {
            try store.save(event, span: .thisEvent, commit: true)
            // **どこに入れたかを返す**＝JS が保存 toast に出す（「入ったが見つからない」を防ぐ）
            call.resolve([
                "id": event.eventIdentifier ?? "",
                "calendarTitle": calendar.title,
                "calendarSource": calendar.source?.title ?? ""
            ])
        } catch {
            call.reject("カレンダーへの保存に失敗: \(error.localizedDescription)")
        }
    }

    // MARK: - getTarget

    /// 今どこへ入るかを返す（**権限を要求しない**）。設定画面を開いただけでダイアログを出さないため、
    /// 未許可なら authorized:false を返すだけにする（JS は「保存するときに聞きます」と出す）。
    @objc func getTarget(_ call: CAPPluginCall) {
        guard hasWriteAccess() else {
            call.resolve(["authorized": false, "found": false])
            return
        }
        guard let cal = store.defaultCalendarForNewEvents else {
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
        call.resolve(out)
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
