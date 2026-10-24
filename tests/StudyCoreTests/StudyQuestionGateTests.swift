import XCTest
@testable import StudyCore

final class StudyQuestionGateTests: XCTestCase {
  let question = "Which action is appropriate? A. Read the directions. B. Ignore the directions."

  func testRequiresStableRepeatedObservation() {
    var gate = StudyQuestionGate()
    XCTAssertNil(gate.observe(question, confidence: 0.99, at: 0))
    XCTAssertNil(gate.observe(question, confidence: 0.99, at: 0.5))
    XCTAssertEqual(gate.observe(question, confidence: 0.99, at: 1.3), StudyQuestionGate.key(question))
  }

  func testNormalizesWhitespaceAndCaseOnly() {
    XCTAssertEqual(StudyQuestionGate.key("WHAT\n is  0.5 mg?"), "what is 0.5 mg?")
    XCTAssertNotEqual(StudyQuestionGate.key("Which is safe?"), StudyQuestionGate.key("Which is NOT safe?"))
    XCTAssertNotEqual(StudyQuestionGate.key("Give 0.5 mg?"), StudyQuestionGate.key("Give 5 mg?"))
    XCTAssertNotEqual(StudyQuestionGate.key("Give 5 mg?"), StudyQuestionGate.key("Give 5 mcg?"))
  }

  func testLowConfidenceResetsStability() {
    var gate = StudyQuestionGate()
    _ = gate.observe(question, confidence: 1, at: 0)
    XCTAssertNil(gate.observe(question, confidence: 0.5, at: 2))
    XCTAssertNil(gate.visibleKey)
    XCTAssertNil(gate.observe(question, confidence: 1, at: 3))
    XCTAssertNotNil(gate.observe(question, confidence: 1, at: 4.3))
  }

  func testMissingQuestionResetsStability() {
    var gate = StudyQuestionGate()
    _ = gate.observe(question, confidence: 1, at: 0)
    XCTAssertNil(gate.observe("A blank wall", confidence: 1, at: 2))
    XCTAssertNil(gate.visibleKey)
    XCTAssertNil(gate.observe(question, confidence: 1, at: 3))
  }

  func testDoesNotRequestSameQuestionAfterLookingAway() {
    var gate = StudyQuestionGate()
    _ = gate.observe(question, confidence: 1, at: 0)
    let key = gate.observe(question, confidence: 1, at: 1.3)!
    gate.requested(key, at: 1.3)
    gate.invalidateView()
    _ = gate.observe(question, confidence: 1, at: 10)
    XCTAssertNil(gate.observe(question, confidence: 1, at: 12))
    XCTAssertEqual(gate.requestCount, 1)
  }

  func testAChangedChoiceIsANewQuestion() {
    var gate = StudyQuestionGate()
    _ = gate.observe(question, confidence: 1, at: 0)
    let key = gate.observe(question, confidence: 1, at: 1.3)!
    gate.requested(key, at: 1.3)
    let changed = question.replacingOccurrences(of: "Ignore", with: "Follow")
    _ = gate.observe(changed, confidence: 1, at: 10)
    XCTAssertEqual(gate.observe(changed, confidence: 1, at: 12), StudyQuestionGate.key(changed))
  }

  func testCooldownAlsoAppliesToDifferentQuestions() {
    var gate = StudyQuestionGate()
    _ = gate.observe(question, confidence: 1, at: 0)
    let key = gate.observe(question, confidence: 1, at: 1.3)!
    gate.requested(key, at: 1.3)
    let changed = "What is the next step? A. Review. B. Reflect."
    _ = gate.observe(changed, confidence: 1, at: 2)
    XCTAssertNil(gate.observe(changed, confidence: 1, at: 4))
    XCTAssertNotNil(gate.observe(changed, confidence: 1, at: 10))
  }

  func testStaleOrDifferentViewCannotReceiveAnAnswer() {
    var gate = StudyQuestionGate()
    _ = gate.observe(question, confidence: 1, at: 0)
    let key = gate.observe(question, confidence: 1, at: 1.3)!
    XCTAssertTrue(gate.isCurrent(key, at: 2))
    XCTAssertFalse(gate.isCurrent(key, at: 5))
    _ = gate.observe("Which different option is right?", confidence: 1, at: 5)
    XCTAssertFalse(gate.isCurrent(key, at: 5))
    gate.invalidateView()
    XCTAssertFalse(gate.isCurrent(key, at: 5))
  }

  func testExplicitRetryPreservesRequestBudgetAndCooldown() {
    var gate = StudyQuestionGate()
    _ = gate.observe(question, confidence: 1, at: 0)
    let key = gate.observe(question, confidence: 1, at: 1.3)!
    gate.requested(key, at: 1.3)
    gate.retryVisibleQuestion()
    XCTAssertNil(gate.observe(question, confidence: 1, at: 2))
    XCTAssertNotNil(gate.observe(question, confidence: 1, at: 10))
    XCTAssertEqual(gate.requestCount, 1)
  }

  func testThirtyRequestSessionLimit() {
    var gate = StudyQuestionGate()
    for index in 0..<30 {
      let text = "\(question) Version \(index)."
      let start = Double(index * 10)
      _ = gate.observe(text, confidence: 1, at: start)
      let key = gate.observe(text, confidence: 1, at: start + 2)!
      gate.requested(key, at: start + 2)
    }
    _ = gate.observe(question, confidence: 1, at: 400)
    XCTAssertNil(gate.observe(question, confidence: 1, at: 402))
    XCTAssertEqual(gate.requestCount, 30)
  }

  func testUnrelatedAndOversizedTextIsRejected() {
    XCTAssertFalse(StudyQuestionGate.looksLikeQuestion("Question?"))
    XCTAssertFalse(StudyQuestionGate.looksLikeQuestion(String(repeating: "text ", count: 2000) + "?"))
    XCTAssertFalse(StudyQuestionGate.looksLikeQuestion("A tree in a field with no question to read."))
  }

  func testRequiresValidCompleteAnswer() throws {
    let value = StudyAnswer(status: .answer, answer: "A. Read the directions.",
                            rationale: "The directions explain the task.", mnemonic: "")
    XCTAssertEqual(try value.validated(), value)
    XCTAssertThrowsError(try StudyAnswer(status: .answer, answer: "", rationale: "Why", mnemonic: "").validated())
    XCTAssertThrowsError(try StudyAnswer(status: .answer, answer: "A", rationale: "", mnemonic: "").validated())
  }

  func testUnclearImageCannotContainAnAnswer() throws {
    XCTAssertThrowsError(try StudyAnswer(status: .needs_clearer_image, answer: "A",
                                        rationale: "Cannot read it", mnemonic: "").validated())
    XCTAssertNoThrow(try StudyAnswer(status: .needs_clearer_image, answer: "",
                                    rationale: "Move closer to show all choices.", mnemonic: "").validated())
  }

  func testUnknownStatusAndMissingFieldsAreRejected() {
    let unknown = Data(#"{"status":"probably","answer":"A","rationale":"Why","mnemonic":""}"#.utf8)
    XCTAssertThrowsError(try JSONDecoder().decode(StudyAnswer.self, from: unknown))
    let incomplete = Data(#"{"status":"answer","answer":"A"}"#.utf8)
    XCTAssertThrowsError(try JSONDecoder().decode(StudyAnswer.self, from: incomplete))
  }
}
