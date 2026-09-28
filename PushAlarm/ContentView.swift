import SwiftUI
import UIKit

struct ContentView: View {
    @ObservedObject var model: AppModel
    @State private var showingStatus = false

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()

            DitheredBell(color: model.isConfigured ? .ditherBlue : .ditherRed)
                .contentShape(Rectangle())
                .onTapGesture { showingStatus = true }
                .popover(isPresented: $showingStatus, arrowEdge: .bottom) {
                    StatusPopup(model: model)
                        .presentationCompactAdaptation(.popover)
                }
                .contextMenu {
                    if let token = model.deviceToken {
                        Button("Copy device token", systemImage: "doc.on.doc") {
                            UIPasteboard.general.string = token
                        }
                    }
                    Button("Test alarm (10 s)", systemImage: "alarm") {
                        Task { await model.testAlarm() }
                    }
                    .disabled(!model.isConfigured)
                }
                .accessibilityLabel(model.isConfigured ? "Ready" : "Not configured")
                .accessibilityHint("Double-tap to see status")
        }
        .preferredColorScheme(.light)
        .task { await model.askForMissingPermissions() }
    }
}

/// Shows whether alarms and push notifications are ready.
struct StatusPopup: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            row("Alarms", status: alarmStatus)
            row("Push notifications", status: pushStatus)
        }
        .padding(20)
        .frame(minWidth: 260)
        .task { await model.refresh() }
    }

    private var alarmStatus: Status {
        switch model.alarmAuth {
        case .authorized: .ok("Allowed")
        case .denied: .problem("Not allowed")
        default: .problem("Not set up")
        }
    }

    private var pushStatus: Status {
        switch model.notificationStatus {
        case .authorized, .provisional, .ephemeral:
            if model.deviceToken != nil { .ok("Allowed") }
            else if model.registrationError != nil { .problem("Couldn't register") }
            else { .problem("Waiting for token") }
        case .denied: .problem("Not allowed")
        default: .problem("Not set up")
        }
    }

    private enum Status {
        case ok(String), problem(String)
        var text: String { switch self { case .ok(let t), .problem(let t): t } }
        var isOK: Bool { if case .ok = self { true } else { false } }
    }

    /// A red row can be tapped to ask again (or open Settings if it was refused).
    private func row(_ title: String, status: Status) -> some View {
        Button {
            Task { await model.configure() }
        } label: {
            rowContent(title, status: status)
        }
        .buttonStyle(.plain)
        .disabled(status.isOK)
    }

    private func rowContent(_ title: String, status: Status) -> some View {
        HStack(spacing: 12) {
            Text(title)
            Spacer(minLength: 24)
            Image(systemName: status.isOK ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(status.isOK ? .green : .red)
                .font(.title3)
        }
        .font(.body)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title): \(status.text)")
    }
}

/// A big bell drawn as animated ordered-dither dots: solid at the bottom, fading out toward the top.
struct DitheredBell: View {
    var color: Color
    var size: CGFloat = 240
    var cell: CGFloat = 4

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date.now

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            bell(time: context.date.timeIntervalSince(start))
        }
    }

    private func bell(time: TimeInterval) -> some View {
        Image(systemName: "bell.fill")
            .font(.system(size: size))
            .foregroundStyle(
                LinearGradient(
                    stops: [
                        .init(color: .black.opacity(0.12), location: 0),
                        .init(color: .black.opacity(0.55), location: 0.45),
                        .init(color: .black, location: 1),
                    ],
                    startPoint: .topTrailing,
                    endPoint: .bottomLeading
                )
            )
            .padding(cell * 2)
            .layerEffect(
                ShaderLibrary.dither(.float(cell), .float(cell * 0.25), .color(color), .float(time)),
                maxSampleOffset: CGSize(width: cell, height: cell)
            )
    }
}

extension Color {
    static let ditherBlue = Color(red: 0.12, green: 0.36, blue: 1.0)
    static let ditherRed = Color(red: 0.90, green: 0.20, blue: 0.20)
}

#Preview("Configured") {
    DitheredBell(color: .ditherBlue).padding().background(.white)
}

#Preview("Not configured") {
    DitheredBell(color: .ditherRed).padding().background(.white)
}
