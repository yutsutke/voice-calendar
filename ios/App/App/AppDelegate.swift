import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // v64: ホーム画面の長押し（iOS の Quick Action）で「リスト」を開く。
    // 起動直後は WebView が index.html を実行し終えておらず window.__vcQuickAction が未定義なので、
    // 定義されて受理（true）を返すまで数回リトライして届ける（v31 の起動リトライと同じ発想）。cold/warm 両対応。
    // plugin を新設せず AppDelegate から webView へ直接届ける＝Package.swift / package.json を触らない。
    private var pendingShortcut: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // cold start: 長押しから起動された場合、ここに shortcutItem が渡る（このとき performActionFor は呼ばれない）。
        // 実際の配信は applicationDidBecomeActive（rootViewController / webView が整ってから）に任せる。
        if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            pendingShortcut = item.type
        }
        return true
    }

    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        // warm/background: アプリが既に起動している時に長押し → ここに来る。
        pendingShortcut = shortcutItem.type
        deliverPendingShortcut(attempt: 0)
        completionHandler(true)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        // v64: cold start で didFinishLaunching に載せた Quick Action をここで届ける（nil の時は即 return＝通常起動は無害）。
        deliverPendingShortcut(attempt: 0)
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // v64: 保留中の Quick Action を WebView に届ける。届く（window.__vcQuickAction が true を返す）まで 0.3s 間隔でリトライ。
    private func deliverPendingShortcut(attempt: Int) {
        guard let type = pendingShortcut else { return }
        // 「リストを開く」だけを扱う。未知の type は黙って捨てる（害がない・将来 type を増やす時ここに足す）。
        guard type.hasSuffix(".list") else { pendingShortcut = nil; return }
        // 0.3s×15 ≒ 4.5s で諦める（起動が極端に遅い時の保険＝永久ループにしない）。
        guard attempt < 15 else { pendingShortcut = nil; return }
        guard let vc = window?.rootViewController as? CAPBridgeViewController,
              let webView = vc.bridge?.webView else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.deliverPendingShortcut(attempt: attempt + 1)
            }
            return
        }
        let js = "(typeof window.__vcQuickAction==='function') ? (window.__vcQuickAction('list'), true) : false"
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self else { return }
            if (result as? Bool) == true {
                self.pendingShortcut = nil  // 届いた
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                    self?.deliverPendingShortcut(attempt: attempt + 1)
                }
            }
        }
    }

}
