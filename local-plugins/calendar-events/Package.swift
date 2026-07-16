// swift-tools-version: 5.9
import PackageDescription

// 重要: パッケージ名・プロダクト名は cap sync が npm 名 "calendar-events" から
// 導出する "CalendarEvents" と必ず一致させること。CapApp-SPM 側が
//   .package(name: "CalendarEvents", path: ...)
//   .product(name: "CalendarEvents", package: "CalendarEvents")
// を生成して参照するため、ここが違うと SPM 解決が失敗し
// xcodebuild -showBuildSettings が exit 74 で落ちる（あの日 photo-library で確立した規約）。
let package = Package(
    name: "CalendarEvents",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CalendarEvents",
            targets: ["CalendarEvents"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CalendarEvents",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CalendarEventsPlugin")
    ]
)
