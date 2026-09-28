import UserNotifications

/// Runs for every alert push that has "mutable-content": 1, even when the app is not running.
/// This is the main path that turns a push into an alarm.
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        bestAttempt = content

        guard let alarm = AlarmRequest(userInfo: request.content.userInfo) else {
            contentHandler(content)
            return
        }

        Task {
            let time = alarm.date.formatted(date: .abbreviated, time: .shortened)
            do {
                switch try await AlarmScheduler.schedule(alarm) {
                case .scheduled, .alreadyScheduled:
                    content.subtitle = "⏰ Alarm set for \(time)"
                case .notAuthorized:
                    content.subtitle = "Open PushAlarm to set the alarm for \(time)"
                }
            } catch {
                content.subtitle = "Couldn't set alarm – open PushAlarm"
            }
            contentHandler(content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler, let bestAttempt { contentHandler(bestAttempt) }
    }
}
