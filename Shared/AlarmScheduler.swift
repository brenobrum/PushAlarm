import AlarmKit
import Foundation
import SwiftUI

/// Payload the server puts at the top level of the APNs JSON, next to "aps":
///
///   "alarm": { "id": "<uuid>", "date": "2026-09-28T14:30:00Z", "note": "Server X went down" }
///
/// `id` is optional (used to avoid creating the same alarm twice),
/// `date` is optional (missing or in the past → alarm rings ~2 seconds from now).
struct AlarmRequest: Codable, Hashable {
    var id: UUID
    var date: Date
    var note: String

    init(id: UUID = UUID(), date: Date, note: String) {
        self.id = id
        self.date = date
        self.note = note
    }

    init?(userInfo: [AnyHashable: Any]) {
        guard let alarm = userInfo["alarm"] as? [String: Any] else { return nil }
        let note = (alarm["note"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let note, !note.isEmpty else { return nil }

        self.note = note
        self.id = (alarm["id"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let raw = alarm["date"] as? String ?? ""
        let parsed = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        self.date = parsed ?? .now
    }
}

struct PushAlarmMetadata: AlarmMetadata {
    var note: String
}

enum AlarmScheduler {
    static let appGroup = "group.com.brenobrum.pushalarm"
    private static let processedKey = "processedAlarmIDs"
    private static let pendingKey = "pendingAlarmRequests"
    private static let historyKey = "alarmHistory"

    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    enum Outcome { case scheduled, alreadyScheduled, notAuthorized }

    /// Creates a system alarm for the request. Safe to call more than once for the same id.
    @discardableResult
    static func schedule(_ request: AlarmRequest) async throws -> Outcome {
        if processedIDs.contains(request.id) { return .alreadyScheduled }

        let manager = AlarmManager.shared
        guard manager.authorizationState == .authorized else {
            enqueuePending(request)
            return .notAuthorized
        }

        // AlarmKit needs a future date; ring shortly if the event time already passed.
        let fireDate = max(request.date, .now.addingTimeInterval(2))

        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) {
            alert = AlarmPresentation.Alert(title: "\(request.note)")
        } else {
            alert = AlarmPresentation.Alert(
                title: "\(request.note)",
                stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
            )
        }

        let attributes = AlarmAttributes<PushAlarmMetadata>(
            presentation: AlarmPresentation(alert: alert),
            metadata: PushAlarmMetadata(note: request.note),
            tintColor: .orange
        )

        _ = try await manager.schedule(
            id: request.id,
            configuration: .alarm(schedule: .fixed(fireDate), attributes: attributes)
        )

        markProcessed(request, fireDate: fireDate)
        return .scheduled
    }

    /// Schedules anything the notification extension couldn't (e.g. before permission was granted).
    static func flushPending() async {
        let pending = pendingRequests
        guard !pending.isEmpty else { return }
        defaults.removeObject(forKey: pendingKey)
        for request in pending {
            _ = try? await schedule(request)
        }
    }

    // MARK: - Persistence (shared between app and extension through the App Group)

    struct HistoryEntry: Codable, Identifiable, Hashable {
        var id: UUID
        var note: String
        var fireDate: Date
        var receivedAt: Date
    }

    static var history: [HistoryEntry] {
        decode([HistoryEntry].self, forKey: historyKey) ?? []
    }

    private static var processedIDs: Set<UUID> {
        Set(decode([UUID].self, forKey: processedKey) ?? [])
    }

    private static var pendingRequests: [AlarmRequest] {
        decode([AlarmRequest].self, forKey: pendingKey) ?? []
    }

    private static func enqueuePending(_ request: AlarmRequest) {
        var pending = pendingRequests
        guard !pending.contains(where: { $0.id == request.id }) else { return }
        pending.append(request)
        encode(pending, forKey: pendingKey)
    }

    private static func markProcessed(_ request: AlarmRequest, fireDate: Date) {
        var ids = Array(processedIDs)
        ids.append(request.id)
        encode(Array(ids.suffix(500)), forKey: processedKey)

        var entries = history
        entries.insert(HistoryEntry(id: request.id, note: request.note, fireDate: fireDate, receivedAt: .now), at: 0)
        encode(Array(entries.prefix(200)), forKey: historyKey)
    }

    private static func decode<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(type, from: $0) }
    }

    private static func encode<T: Encodable>(_ value: T, forKey key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
}
