import MWDATCore
import SwiftUI

struct StudySessionView: View {
  let wearables: WearablesInterface?
  let openVoiceAssistant: () -> Void
  @StateObject private var stream: StreamSessionViewModel
  @StateObject private var engine = StudyQuestionEngine()
  @StateObject private var lens = StudyGlassesDisplay()
  @Environment(\.scenePhase) private var scenePhase
  @State private var apiKey = StudyKeychain.read()
  @State private var keyMessage = ""
  @State private var registration: RegistrationState = .unavailable
  @State private var startTask: Task<Void, Never>?
  @State private var sessionGeneration = UUID()
  @State private var isStopping = false
  @State private var spokenAnswers = false
  @State private var showSetup = StudyKeychain.read().isEmpty
  @AppStorage("personalStudyModel") private var model = "gemini-2.5-flash"

  init(wearables: WearablesInterface?, openVoiceAssistant: @escaping () -> Void) {
    self.wearables = wearables
    self.openVoiceAssistant = openVoiceAssistant
    _stream = StateObject(wrappedValue: StreamSessionViewModel(wearables: wearables))
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text("Start once. Look at a practice question. An explanation appears automatically when the text stays steady.")
          Text("For permitted, ungraded practice. Keep this app open. AI answers can be wrong; check your study materials.")
            .font(.footnote).foregroundStyle(.secondary)
        }
        Section("Connection") {
          if wearables == nil {
            Text("The Meta glasses toolkit is unavailable on this device.")
          } else if registration != .registered {
            Button(registration == .registering ? "Connecting…" : "Connect Meta glasses") {
              Task {
                do { try await wearables?.startRegistration() }
                catch { keyMessage = "Could not connect the glasses. Check Meta AI Developer Mode." }
              }
            }
            .disabled(registration == .registering)
          } else {
            Label("Glasses registered", systemImage: "checkmark.circle")
          }
          Text(lens.status).font(.footnote)
          if let issue = stream.glassesIssue {
            Text(connectionMessage(issue)).font(.footnote).foregroundStyle(.orange)
          }
        }
        Section("Session") {
          Text(engine.status)
          Text("\(engine.requests) of 30 AI requests this session").font(.caption).foregroundStyle(.secondary)
          Toggle("Speak explanations aloud", isOn: $spokenAnswers)
            .onChange(of: spokenAnswers) { _, value in engine.speakAnswers = value }
          if engine.isActive {
            Button("Stop study session", role: .destructive) { stopSession() }
            Button("Retry visible question") { engine.retry() }
          } else {
            Button("Start study session") { startSession() }
              .disabled(wearables == nil || registration != .registered || StudyKeychain.read().isEmpty || isStopping)
          }
        }
        if let answer = engine.answer {
          Section("Practice explanation") {
            if answer.status == .answer { Text(answer.answer).font(.headline) }
            Text(answer.rationale)
            if !answer.mnemonic.isEmpty { Text("Remember: " + answer.mnemonic) }
          }
        }
        if engine.isActive {
          Section {
            DisclosureGroup("Check recognized text") {
              Text(engine.recognizedText.isEmpty ? "Waiting for readable text…" : engine.recognizedText)
                .font(.footnote).textSelection(.enabled)
            }
          }
        }
        Section {
          DisclosureGroup("AI setup", isExpanded: $showSetup) {
            Text("Each new question sends a camera image and recognized text to Google Gemini. Your API account may be charged. Nothing is sent to VisionClaw's private pilot server.")
              .font(.footnote)
            Link("Get a Gemini API key", destination: URL(string: "https://aistudio.google.com/apikey")!)
            SecureField("Gemini API key", text: $apiKey)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Save key on this iPhone") {
              keyMessage = StudyKeychain.save(apiKey) ? "Key saved on this iPhone." : "Could not save the key. Try again."
            }
            TextField("Gemini model", text: $model)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Remove saved key", role: .destructive) {
              if StudyKeychain.save("") { apiKey = ""; keyMessage = "Saved key removed." }
              else { keyMessage = "Could not remove the key. Try again." }
            }
          }
          .disabled(engine.isActive)
          if !keyMessage.isEmpty { Text(keyMessage).font(.footnote) }
        }
        Section {
          Button("Open original VisionClaw voice assistant") {
            stopSession()
            openVoiceAssistant()
          }
          .disabled(engine.isActive || isStopping)
        }
      }
      .navigationTitle("Hands-free study")
    }
    .onAppear {
      stream.onDecodedFrame = { [weak engine] buffer in engine?.accept(buffer) }
      stream.onStudyDeviceSession = { [weak lens, weak engine] session in
        lens?.attach(to: engine?.isActive == true ? session : nil)
      }
      engine.onAnswer = { [weak lens] answer in lens?.show(answer) }
    }
    .task {
      guard let wearables else { return }
      registration = wearables.registrationState
      for await state in wearables.registrationStateStream() {
        guard !Task.isCancelled else { return }
        registration = state
        if state != .registered, engine.isActive { stopSession() }
      }
    }
    .onChange(of: stream.streamingStatus) { _, status in
      if status != .streaming { engine.cameraUnavailable() }
    }
    .onChange(of: engine.isActive) { _, active in
      UIApplication.shared.isIdleTimerDisabled = active
      if !active { stopSession() }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active, engine.isActive { stopSession() }
    }
    .onDisappear { stopSession() }
  }

  private func startSession() {
    guard !engine.isActive, !isStopping else { return }
    engine.speakAnswers = spokenAnswers
    sessionGeneration = UUID()
    let currentGeneration = sessionGeneration
    engine.start(apiKey: StudyKeychain.read(), model: model)
    startTask = Task {
      await stream.handleStartStreaming()
      guard currentGeneration == sessionGeneration else { return }
      if Task.isCancelled || !engine.isActive { await stream.stopSession() }
    }
  }

  private func stopSession() {
    sessionGeneration = UUID()
    startTask?.cancel()
    startTask = nil
    if engine.isActive { engine.stop() }
    lens.detach()
    UIApplication.shared.isIdleTimerDisabled = false
    guard !isStopping else { return }
    isStopping = true
    Task {
      await stream.stopSession()
      isStopping = false
    }
  }

  private func connectionMessage(_ issue: StreamSessionViewModel.GlassesIssue) -> String {
    switch issue {
    case .sdkUnavailable: return "Meta glasses support could not start."
    case .permissionNeeded: return "Allow camera access in Meta AI, then restart the session."
    case .hingesClosed: return "Open the glasses arms and put the glasses on."
    case .reconnecting: return "Reconnecting to the glasses…"
    }
  }
}
