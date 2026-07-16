import Foundation
import UIKit
import Capacitor
import EventKit

/// DraftEvent → EventKit 保存（永続層アダプタの native 側。SPEC §5 永続層 / §6）。
///
/// 契約（adapters/calendar.js の eventKitAdapter と一致させる）:
///   save({ title, startMs, endMs, allDay, location, note }) → { id }
///
/// 権限:
/// - iOS 17+ は **書き込み専用アクセス**（requestWriteOnlyAccessToEvents）＝「追加のみ」の軽い
///   ダイアログで、既存予定の読み取り権限を要求しない（SPEC §3: v0 は書くだけ。読みは v1）。
///   Info.plist: NSCalendarsWriteOnlyAccessUsageDescription
/// - iOS 16 以前は従来の requestAccess(to: .event)。Info.plist: NSCalendarsUsageDescription
/// - 拒否済みからの復帰導線として openSettings() を用意（あの日 v215 のカメラ権限の教訓:
///   「拒否が残ると回復導線がない」を最初から塞ぐ）。
@objc(CalendarEventsPlugin)
public class CalendarEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CalendarEventsPlugin"
    public let jsName = "CalendarEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private let store = EKEventStore()

    @objc func save(_ call: CAPPluginCall) {
        guard let title = call.getString("title"),
              let startMs = call.getDouble("startMs"),
              let endMs = call.getDouble("endMs") else {
            call.reject("title / startMs / endMs は必須です")
            return
        }

        let onPermission: (Bool, Error?) -> Void = { [weak self] granted, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let error = error {
                    call.reject("カレンダー権限の確認に失敗: \(error.localizedDescription)")
                    return
                }
                guard granted else {
                    // JS 側はこのコードを見て「設定から許可」の導線を出す
                    call.reject("カレンダーへのアクセスが許可されていません", "PERMISSION_DENIED")
                    return
                }
                self.write(call, title: title, startMs: startMs, endMs: endMs)
            }
        }

        if #available(iOS 17.0, *) {
            store.requestWriteOnlyAccessToEvents(completion: onPermission)
        } else {
            store.requestAccess(to: .event, completion: onPermission)
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

        // 既定カレンダーへ（OS 設定で Google カレンダーを既定にしていれば OS が Google へ同期する。
        // アプリは Google と直接通信しない＝SPEC §1-6）
        guard let calendar = store.defaultCalendarForNewEvents else {
            call.reject("書き込み先のカレンダーが見つかりません（OS のカレンダー設定を確認）")
            return
        }
        event.calendar = calendar

        do {
            try store.save(event, span: .thisEvent, commit: true)
            call.resolve(["id": event.eventIdentifier ?? ""])
        } catch {
            call.reject("カレンダーへの保存に失敗: \(error.localizedDescription)")
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
