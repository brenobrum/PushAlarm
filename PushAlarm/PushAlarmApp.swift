import AlarmKit
import SwiftUI
import UIKit
import UserNotifications

@main
struct PushAlarmApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(model: appDelegate.model)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await appDelegate.model.refresh() } }
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var deviceToken: String?
    @Published var registrationError: String?
    @Published var alarmAuth: AlarmManager.AuthorizationState = AlarmManager.shared.authorizationState
    @Published var notificationStatus: UNAuthorizationStatus = .notDetermined

    /// Ready to turn pushes into alarms.
    var isConfigured: Bool {
        alarmAuth == .authorized && notificationStatus == .authorized && deviceToken != nil
    }

    /// Asks for whatever is missing; if the user already said no, sends them to Settings.
    func configure() async {
        if alarmAuth == .denied || notificationStatus == .denied {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                await UIApplication.shared.open(url)
            }
            return
        }
        await askForMissingPermissions()
    }

    /// Shows the system prompts for anything never asked before. Safe to call on every launch.
    func askForMissingPermissions() async {
        await refresh()
        if alarmAuth == .notDetermined {
            _ = try? await AlarmManager.shared.requestAuthorization()
        }
        if notificationStatus == .notDetermined {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            UIApplication.shared.registerForRemoteNotifications()
        }
        await refresh()
    }

    func refresh() async {
        await AlarmScheduler.flushPending()
        alarmAuth = AlarmManager.shared.authorizationState
        notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func testAlarm() async {
        let request = AlarmRequest(date: .now.addingTimeInterval(10), note: "Test alarm from PushAlarm")
        _ = try? await AlarmScheduler.schedule(request)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @MainActor let model = AppModel()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        print("APNs device token: \(token)")
        Task { @MainActor in model.deviceToken = token }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in model.registrationError = error.localizedDescription }
    }

    /// Backup path: "content-available": 1 wakes the app in the background.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let request = AlarmRequest(userInfo: userInfo) else { return completionHandler(.noData) }
        Task {
            let outcome = try? await AlarmScheduler.schedule(request)
            await model.refresh()
            completionHandler(outcome == .scheduled ? .newData : .noData)
        }
    }

    // Show the banner even when the app is open.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        if let request = AlarmRequest(userInfo: notification.request.content.userInfo) {
            _ = try? await AlarmScheduler.schedule(request)
            await model.refresh()
        }
        return [.banner, .sound, .list]
    }

    // User tapped the notification: make sure the alarm exists.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if let request = AlarmRequest(userInfo: response.notification.request.content.userInfo) {
            _ = try? await AlarmScheduler.schedule(request)
        }
        await model.refresh()
    }
}
