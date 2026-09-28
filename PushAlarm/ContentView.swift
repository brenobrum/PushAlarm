import AlarmKit
import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationStack {
            List {
                Section("Setup") {
                    status("Alarms", ok: model.alarmAuth == .authorized)
                    status("Notifications", ok: model.notificationsAllowed)
                    if model.alarmAuth != .authorized || !model.notificationsAllowed {
                        Button("Allow alarms & notifications") {
                            Task { await model.requestPermissions() }
                        }
                    }
                    Button("Test alarm (rings in 10 s)") {
                        Task { await model.testAlarm() }
                    }
                    .disabled(model.alarmAuth != .authorized)
                }

                Section {
                    if let token = model.deviceToken {
                        Text(token)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                        ShareLink(item: token) { Label("Share token", systemImage: "square.and.arrow.up") }
                    } else if let error = model.registrationError {
                        Text(error).foregroundStyle(.red)
                    } else {
                        Text("Waiting for push token…").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Device push token")
                } footer: {
                    Text("Your server sends pushes to this token.")
                }

                Section("Alarms created") {
                    if model.history.isEmpty {
                        Text("None yet").foregroundStyle(.secondary)
                    }
                    ForEach(model.history) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.note).font(.body)
                            Text("Rings \(entry.fireDate.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("PushAlarm")
            .refreshable { await model.refresh() }
            .task { await model.refresh() }
        }
    }

    private func status(_ title: String, ok: Bool) -> some View {
        LabeledContent(title) {
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(ok ? .green : .red)
        }
    }
}
