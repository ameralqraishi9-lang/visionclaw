import AVFoundation
import CoreImage
import CoreVideo
import SwiftUI
import Vision

@MainActor
final class StudyQuestionEngine: ObservableObject {
  @Published private(set) var isActive = false
  @Published private(set) var status = "Start a session, then hold a complete practice question in view."
  @Published private(set) var answer: StudyAnswer?
  @Published private(set) var requests = 0
  @Published private(set) var recognizedText = ""
  var onAnswer: ((StudyAnswer?) -> Void)?
  var speakAnswers = false

  private var gate = StudyQuestionGate()
  private var generation = UUID()
  private var apiKey = ""
  private var model = "gemini-2.5-flash"
  private var lastFrame: TimeInterval = -.infinity
  private var recognizing = false
  private var answering = false
  private var ocrTask: Task<Void, Never>?
  private var answerTask: Task<Void, Never>?
  private var watchdog: Task<Void, Never>?
  private let imageContext = CIContext()
  private let speech = AVSpeechSynthesizer()
  private var now: TimeInterval { ProcessInfo.processInfo.systemUptime }

  func start(apiKey: String, model: String) {
    stop()
    guard !apiKey.isEmpty else { status = "Save your Gemini API key first."; return }
    self.apiKey = apiKey
    self.model = model
    gate = StudyQuestionGate()
    requests = 0
    lastFrame = -.infinity
    isActive = true
    status = "Looking for a steady, complete practice question…"
    let started = now
    watchdog = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        guard let self, !Task.isCancelled, self.isActive else { return }
        if self.now - started >= 1800 {
          self.stop()
          self.status = "Session ended after 30 minutes. Start a new session when ready."
          return
        }
        if self.now - self.gate.lastObservation > 3 {
          self.gate.invalidateView()
          self.clearAnswer()
          self.status = "Waiting for a readable camera view. Keep the app open."
        }
      }
    }
  }

  func stop() {
    generation = UUID()
    isActive = false
    ocrTask?.cancel()
    answerTask?.cancel()
    watchdog?.cancel()
    ocrTask = nil
    answerTask = nil
    watchdog = nil
    recognizing = false
    answering = false
    apiKey = ""
    recognizedText = ""
    gate.invalidateView()
    clearAnswer()
    status = "Study session stopped."
  }

  func retry() {
    guard isActive, !answering else { return }
    gate.retryVisibleQuestion()
    clearAnswer()
    status = "Hold the question steady to retry."
  }

  func cameraUnavailable() {
    gate.invalidateView()
    clearAnswer()
    if isActive { status = "Waiting for the glasses camera…" }
  }

  func accept(_ buffer: CVPixelBuffer) {
    guard isActive, !recognizing, now - lastFrame >= 0.8 else { return }
    lastFrame = now
    let ci = CIImage(cvPixelBuffer: buffer)
    guard let image = imageContext.createCGImage(ci, from: ci.extent) else { return }
    recognizing = true
    let currentGeneration = generation
    ocrTask = Task { [weak self] in
      let observation = await Task.detached(priority: .utility) { () -> (String, Float) in
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        do {
          try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
          let results = (request.results ?? []).compactMap { $0.topCandidates(1).first }
          return (results.map(\.string).joined(separator: "\n"), results.map(\.confidence).min() ?? 0)
        } catch { return ("", 0) }
      }.value
      guard let self, self.generation == currentGeneration, self.isActive, !Task.isCancelled else { return }
      self.recognizing = false
      self.recognizedText = observation.0
      let previousKey = self.gate.visibleKey
      let ready = self.gate.observe(observation.0, confidence: observation.1, at: self.now)
      if self.gate.visibleKey != previousKey {
        self.clearAnswer()
        self.status = "Hold the entire question and every answer choice steady…"
      }
      guard !self.answering, let key = ready else { return }
      guard let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.9) else { return }
      self.requestAnswer(key: key, text: observation.0, jpeg: jpeg)
    }
  }

  private func requestAnswer(key: String, text: String, jpeg: Data) {
    gate.requested(key, at: now)
    requests = gate.requestCount
    answering = true
    status = "Reading the question and checking the choices…"
    let currentGeneration = generation
    let keyForAPI = apiKey
    let modelForAPI = model
    answerTask = Task { [weak self] in
      do {
        let result = try await StudyAIClient().answer(jpeg: jpeg, text: text, apiKey: keyForAPI, model: modelForAPI)
        guard let self, self.generation == currentGeneration, self.isActive, !Task.isCancelled else { return }
        self.answering = false
        guard self.gate.isCurrent(key, at: self.now) else {
          self.status = "The view changed. Hold the new question steady."
          return
        }
        self.answer = result
        self.onAnswer?(result)
        self.status = result.status == .answer ? "Practice explanation ready. Look at the next question to continue." : result.rationale
        if self.speakAnswers, result.status == .answer {
          try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
          try? AVAudioSession.sharedInstance().setActive(true)
          self.speech.speak(AVSpeechUtterance(string: result.answer + ". " + result.rationale))
        }
        if self.requests >= 30 {
          self.status = "Session limit reached (30 AI requests). Stop and start a new session to continue."
        }
      } catch {
        guard let self, self.generation == currentGeneration, self.isActive, !Task.isCancelled else { return }
        self.answering = false
        // No automatic billable retry loop. A retry must be requested explicitly.
        self.status = (error as? StudyAnswerError)?.localizedDescription ?? "Could not reach the AI service. Check your connection, then retry."
      }
    }
  }

  private func clearAnswer() {
    speech.stopSpeaking(at: .immediate)
    if answer != nil {
      answer = nil
      onAnswer?(nil)
    }
  }
}
