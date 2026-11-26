import WidgetKit

/// One moment of the widgets' timeline: the day's card and the next day's.
struct TodayEntry: TimelineEntry {
    let date: Date
    let today: DayCard?
    let next: DayCard?
}

/// The week's cards as a timeline with an entry at each midnight, so the
/// widgets move on to the next day without the app (Shared/DayCards.swift).
struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(
            date: Date(),
            today: DayCard(date: "", title: "Upper B", detail: "8 exercises · Easy Run", kind: "both"),
            next: DayCard(date: "", title: "Lower B", detail: "7 exercises", kind: "lift")
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        let cards = DayCards.load()
        completion(context.isPreview && cards.isEmpty ? placeholder(in: context) : Self.entry(at: Date(), cards: cards))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let cards = DayCards.load()
        let now = Date()
        var entries = [Self.entry(at: now, cards: cards)]
        for card in cards {
            guard let start = DayCards.startOfDay(card.date), start > now else { continue }
            entries.append(Self.entry(at: start, cards: cards))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    static func entry(at date: Date, cards: [DayCard]) -> TodayEntry {
        let key = DayCards.dateKey(date)
        guard let index = cards.firstIndex(where: { $0.date == key }) else {
            return TodayEntry(date: date, today: nil, next: nil)
        }
        let next = index + 1 < cards.count ? cards[index + 1] : nil
        return TodayEntry(date: date, today: cards[index], next: next)
    }
}
