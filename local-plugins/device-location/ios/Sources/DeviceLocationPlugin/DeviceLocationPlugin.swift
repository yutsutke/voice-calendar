import Foundation
import Capacitor
import CoreLocation

/// DeviceLocation — 位置情報の許可状態と現在地を **CLLocationManager から** 取る（v52）。
///
/// 🔴 なぜ Swift 側が要るのか（実機FB第33回・2026-07-22）:
///   症状（ゆう観察）＝「OS の位置情報をオフでアプリを開く → 録音 → 案内バナーが出る →
///   **OS 設定でオンに戻してアプリへ戻る** → **バナーは出たまま・位置も付かない**。
///   **アプリを開き直すと保存される**」。
///   ＝ WKWebView（WebContent プロセス）は位置情報の許可状態を**プロセス内に握っていて**、
///   OS 側の変更を見に行かない。JS の navigator.geolocation / navigator.permissions は
///   何度聞き直しても古い答えを返す（v49 は聞き直す配線を足したが、**聞く相手が古かった**）。
///   CLLocationManager は常に今の状態を返し、`locationManagerDidChangeAuthorization` で
///   **変わった瞬間**も教えてくれる＝アプリを開き直さずにバナーが消え、位置が付くようになる。
///
/// 設計の約束:
///   - **黙って捨てない（v16）**: requestLocation が返らない・空で返る場合も必ず reject する。
///     呼び出し側を永遠に待たせるのは、握り潰すのと同じ。
///   - **黙って聞かない（v38）**: 許可されていない状態で getCurrent が呼ばれても
///     `requestWhenInUseAuthorization` を勝手に呼ばない（＝不意にダイアログを出さない）。
///     状態をそのまま reject の code に載せて返し、聞くかどうかは web 側が決める。
///   - **prompt と denied を区別する**: web の code 1 は両者を潰してしまう。native は区別できる
///     ＝「まだ答えていない人」に拒否バナーを出さずに済む。
///   - 精度は 100m 相当（web の enableHighAccuracy:false と揃える）。用途はリストの行に残す
///     「どこで保存したか」＝街区レベルで足りる（v38）。
///
/// ⚠️ プラグインのメソッドは Capacitor がバックグラウンドキューで呼ぶ。CLLocationManager は
///    run loop のあるスレッド＝メインで扱う必要があるため、全メソッドの本体をメインへ回す。
@objc(DeviceLocationPlugin)
public class DeviceLocationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceLocationPlugin"
    public let jsName = "DeviceLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrent", returnType: CAPPluginReturnPromise)
    ]

    /// 待たせる上限（秒）。web 側の GEO_OPTS.timeout と同じ数字にしてある
    /// ＝どちらの経路でも「位置が行に付くまで」の最悪待ち時間が揃う。
    private static let locationTimeout: TimeInterval = 8.0
    /// 許可ダイアログは人が答えるまで返らない。放置された時に呼び出し側を待たせ続けない保険。
    private static let permissionTimeout: TimeInterval = 60.0

    private lazy var manager: CLLocationManager = {
        let m = CLLocationManager()
        m.desiredAccuracy = kCLLocationAccuracyHundredMeters
        return m
    }()

    private var locationCalls: [CAPPluginCall] = []
    private var permissionCalls: [CAPPluginCall] = []
    private var lastState: String = "unknown"

    override public func load() {
        // load() はメインで呼ばれる＝ここで manager を実体化し delegate を張る。
        lastState = DeviceLocationPlugin.stateString(manager.authorizationStatus)
        manager.delegate = self
    }

    private static func stateString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "prompt"
        case .denied, .restricted: return "denied"
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        @unknown default: return "unknown"
        }
    }

    private static func isGranted(_ status: CLAuthorizationStatus) -> Bool {
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }

    // MARK: - JS から呼べるメソッド

    /// 今の許可状態を返す。**ダイアログは出さない**（読むだけ）。
    /// raw は CLAuthorizationStatus の生値＝診断パネルに数字で出すため（v16「数字を診断に出す」）。
    @objc func getPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.reject("プラグインが解放されています", "unavailable"); return }
            let status = self.manager.authorizationStatus
            call.resolve([
                "state": DeviceLocationPlugin.stateString(status),
                // Int() で包む: rawValue は Int32 ＝ bridge の JSON 変換が受け取る型に揃える
                "raw": Int(status.rawValue)
            ])
        }
    }

    /// まだ答えていない時だけ OS のダイアログを出す。既に答えている時は今の状態をそのまま返す
    /// （一度答えた後 iOS はダイアログを出さない＝待たせても何も起きない）。
    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.reject("プラグインが解放されています", "unavailable"); return }
            let status = self.manager.authorizationStatus
            guard status == .notDetermined else {
                call.resolve(["state": DeviceLocationPlugin.stateString(status)])
                return
            }
            self.permissionCalls.append(call)
            self.manager.requestWhenInUseAuthorization()
            DispatchQueue.main.asyncAfter(deadline: .now() + DeviceLocationPlugin.permissionTimeout) { [weak self] in
                guard let self = self else { return }
                guard let i = self.permissionCalls.firstIndex(where: { $0.callbackId == call.callbackId }) else { return }
                let pending = self.permissionCalls.remove(at: i)
                pending.resolve(["state": DeviceLocationPlugin.stateString(self.manager.authorizationStatus)])
            }
        }
    }

    /// 現在地を1回だけ取る。**許可されていない時は勝手に聞かない**（v38）。
    @objc func getCurrent(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.reject("プラグインが解放されています", "unavailable"); return }
            let status = self.manager.authorizationStatus
            guard DeviceLocationPlugin.isGranted(status) else {
                // code に state をそのまま載せる＝web 側が prompt と denied を区別できる
                call.reject("位置情報が許可されていません", DeviceLocationPlugin.stateString(status))
                return
            }
            self.locationCalls.append(call)
            self.manager.requestLocation()
            DispatchQueue.main.asyncAfter(deadline: .now() + DeviceLocationPlugin.locationTimeout) { [weak self] in
                guard let self = self, let pending = self.takeLocationCall(call.callbackId) else { return }
                // 返らなかった時に黙って待たせ続けない（v16）
                pending.reject("位置情報の取得が時間切れになりました（\(Int(DeviceLocationPlugin.locationTimeout))秒）", "timeout")
            }
        }
    }

    // MARK: - 待っている呼び出しの始末

    private func takeLocationCall(_ callbackId: String) -> CAPPluginCall? {
        guard let i = locationCalls.firstIndex(where: { $0.callbackId == callbackId }) else { return nil }
        return locationCalls.remove(at: i)
    }

    private func failAllLocationCalls(_ message: String, _ code: String) {
        let calls = locationCalls
        locationCalls = []
        for call in calls { call.reject(message, code) }
    }
}

// MARK: - CLLocationManagerDelegate

extension DeviceLocationPlugin: CLLocationManagerDelegate {
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else {
            // 空配列で何もせず返る＝ v16 の真犯人と同じ形の silent drop。必ずエラーとして表に出す。
            failAllLocationCalls("位置が空で返ってきました", "unavailable")
            return
        }
        let calls = locationCalls
        locationCalls = []
        for call in calls {
            call.resolve(["lat": loc.coordinate.latitude, "lng": loc.coordinate.longitude])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        failAllLocationCalls("位置情報を取得できませんでした（\(error.localizedDescription)）",
                             denied ? "denied" : "unavailable")
    }

    /// 🔑 v52 の肝。OS 設定で許可が変わった瞬間にここへ来る（アプリを開き直さなくても）。
    /// delegate を張った直後にも一度呼ばれるが、load() で lastState を先に読んであるので
    /// 同じ値なら通知しない＝起動のたびに意味のないイベントを web へ投げない。
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let state = DeviceLocationPlugin.stateString(manager.authorizationStatus)
        let waiting = permissionCalls
        permissionCalls = []
        for call in waiting { call.resolve(["state": state]) }

        guard state != lastState else { return }
        lastState = state
        notifyListeners("permissionChange", data: ["state": state])
    }
}
