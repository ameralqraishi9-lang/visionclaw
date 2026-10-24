import Foundation

/// Pure decision logic: exact text matters (especially NOT, units and doses).
/// No fuzzy matching that could treat two clinically different questions as one.
struct StudyQuestionGate {
  private(set) var visibleKey: String?
  private(set) var lastObservation: TimeInterval = -.infinity
  private var firstSeen: TimeInterval = 0
  private var observations = 0
  private var handled: Set<String> = []
  private var lastRequest: TimeInterval = -.infinity
  private(set) var requestCount = 0

  static func key(_ text: String) -> String {
    text.lowercased().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
  }

  static func looksLikeQuestion(_ text: String) -> Bool {
    let text = key(text)
    guard (20...6000).contains(text.count) else { return false }
    return text.contains("?") || ["which ", "what ", "select all", "identify ", "calculate ", "how "]
      .contains(where: { text.contains($0) })
  }

  mutating func observe(_ text: String, confidence: Float, at now: TimeInterval) -> String? {
    lastObservation = now
    guard confidence >= 0.8, Self.looksLikeQuestion(text) else {
      visibleKey = nil
      observations = 0
      return nil
    }
    let next = Self.key(text)
    if visibleKey != next {
      visibleKey = next
      firstSeen = now
      observations = 1
      return nil
    }
    observations += 1
    guard observations >= 2, now - firstSeen >= 1.2,
          now - lastRequest >= 8, !handled.contains(next), requestCount < 30 else { return nil }
    return next
  }

  mutating func requested(_ key: String, at now: TimeInterval) {
    handled.insert(key)
    requestCount += 1
    lastRequest = now
  }

  func isCurrent(_ key: String, at now: TimeInterval) -> Bool {
    visibleKey == key && now - lastObservation <= 3
  }

  /// Explicit retry of the visible question; keeps the session's cost limit.
  mutating func retryVisibleQuestion() {
    if let visibleKey { handled.remove(visibleKey) }
    observations = 0
  }

  mutating func invalidateView() {
    visibleKey = nil
    observations = 0
    lastObservation = -.infinity
  }
}

struct StudyAnswer: Codable, Equatable {
  enum Status: String, Codable { case answer, needs_clearer_image, not_practice }
  let status: Status
  let answer: String
  let rationale: String
  let mnemonic: String

  func validated() throws -> StudyAnswer {
    guard answer.count <= 180, !rationale.isEmpty, rationale.count <= 600,
          mnemonic.count <= 200,
          (status != .answer || !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
          (status == .answer || answer.isEmpty) else {
      throw StudyAnswerError.invalidResponse
    }
    return self
  }
}

enum StudyAnswerError: Error, LocalizedError {
  case invalidResponse, http(Int)
  var errorDescription: String? {
    switch self {
    case .invalidResponse: return "The AI response was incomplete. Hold the full question in view and retry."
    case .http(401), .http(403): return "The AI key was not accepted. Check the key and its API access."
    case .http(429): return "The AI service reached its quota. Check your account before retrying."
    case .http(let code): return "The AI service could not answer (HTTP \(code)). Try again later."
    }
  }
}
