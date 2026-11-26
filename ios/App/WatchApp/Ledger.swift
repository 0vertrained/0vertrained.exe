import SwiftUI

/// The app's Ledger look on the watch: its dark palette ("Negative"), which
/// suits the black screen, with hue kept for status and earned moments. Names
/// are in the voice face (serif), numbers in the data face (monospaced).
enum Ledger {
    static let ink = Color(hex: 0xF1EEE7)
    static let ink2 = Color(hex: 0xB9B4AA)
    static let surface = Color(hex: 0x1D1C1A)
    static let line = Color(hex: 0x34322E)
    static let onAccent = Color(hex: 0x141412)
    static let good = Color(hex: 0x7FD1A3)
    static let stop = Color(hex: 0xFF8A80)
    static let earned = Color(hex: 0xE3BD5F)

    static let corner: CGFloat = 8
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// The one filled button on a screen: ink on dark, like the app's primary.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PrimaryButtonBody(configuration: configuration)
    }

    private struct PrimaryButtonBody: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(isEnabled ? Ledger.onAccent : Ledger.ink2)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(
                    isEnabled ? Ledger.ink.opacity(configuration.isPressed ? 0.75 : 1) : Ledger.surface,
                    in: RoundedRectangle(cornerRadius: Ledger.corner, style: .continuous)
                )
                .contentShape(RoundedRectangle(cornerRadius: Ledger.corner, style: .continuous))
        }
    }
}

/// A quieter button: outlined, for the actions beside the main one.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Ledger.ink)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(
                configuration.isPressed ? Ledger.line : Ledger.surface,
                in: RoundedRectangle(cornerRadius: Ledger.corner, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Ledger.corner, style: .continuous)
                    .strokeBorder(Ledger.line, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: Ledger.corner, style: .continuous))
    }
}

/// One number of a set, turned with the Digital Crown when it has focus.
struct ValueTile: View {
    let field: PlanField
    let value: Double
    let focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Text(Format.number(value))
                .font(.title2.weight(.semibold))
                .fontDesign(.monospaced)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(field.unit)
                .font(.footnote)
                .foregroundStyle(Ledger.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(Ledger.ink)
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, minHeight: 60)
        .background(Ledger.surface, in: RoundedRectangle(cornerRadius: Ledger.corner, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Ledger.corner, style: .continuous)
                .strokeBorder(focused ? Ledger.ink : Ledger.line, lineWidth: focused ? 2 : 1)
        )
    }
}
