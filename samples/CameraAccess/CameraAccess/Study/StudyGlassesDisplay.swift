import Combine
import Foundation
import MWDATCore
import MWDATDisplay

/// Shares the camera's DeviceSession: a second session for the same glasses
/// would contend with the stream. Only the newest card is sent.
@MainActor
final class StudyGlassesDisplay: ObservableObject {
  @Published private(set) var status = "Lens display waiting for camera connection."
  private var display: Display?
  private var listener: AnyListenerToken?
  private var readinessTask: Task<Void, Never>?
  private var sendTask: Task<Void, Never>?
  private var generation = UUID()
  private var ready = false
  private var revision = 0
  private var sentRevision = -1
  private var latest: StudyAnswer?

  func attach(to session: DeviceSession?) {
    detach()
    guard let session else { return }
    let current = generation
    do {
      let cap = try session.addDisplay()
      display = cap
      status = "Connecting the lens display…"
      listener = cap.statePublisher.listen { [weak self] state in
        Task { @MainActor in
          guard let self, self.generation == current else { return }
          self.ready = state == .started
          if self.ready {
            self.readinessTask?.cancel()
            self.status = "Lens display connected."
            self.flush()
          } else if state == .stopped {
            self.status = "Lens display disconnected. Answers remain on the phone."
          }
        }
      }
      readinessTask = Task { [weak self] in
        try? await Task.sleep(for: .seconds(12))
        guard let self, !Task.isCancelled, self.generation == current, !self.ready else { return }
        self.status = "Lens display did not connect. Check glasses updates and developer access."
      }
      cap.start()
    } catch {
      status = "Lens display unavailable for this device/session. Answers remain on the phone."
    }
  }

  func show(_ answer: StudyAnswer?) {
    latest = answer
    revision += 1
    flush()
  }

  func detach() {
    generation = UUID()
    readinessTask?.cancel()
    sendTask?.cancel()
    sendTask = nil
    listener = nil
    display?.stop()
    display = nil
    ready = false
    latest = nil
    revision = 0
    sentRevision = -1
    status = "Lens display waiting for camera connection."
  }

  private func flush() {
    guard ready, let display, sendTask == nil else { return }
    let current = generation
    sendTask = Task { [weak self] in
      guard let self else { return }
      defer { if self.generation == current { self.sendTask = nil } }
      while self.generation == current, self.ready, !Task.isCancelled, self.sentRevision != self.revision {
        let sendingRevision = self.revision
        let value = self.latest
        do {
          let card = FlexBox(direction: .column, spacing: 10) {
            Text("Practice study • Check the explanation", style: .meta)
            Text(value?.status == .answer ? String((value?.answer ?? "").prefix(120)) : "Hold the question steady", style: .heading)
            Text(String((value?.rationale ?? "Show the complete question and every answer choice.").prefix(300)), style: .body)
          }
          .padding(20)
          .background(.card)
          try await display.send(card)
          guard self.generation == current, !Task.isCancelled else { return }
          self.sentRevision = sendingRevision
          self.status = "Lens display connected."
        } catch {
          if self.generation == current { self.status = "Could not update the lens. Read the explanation on the phone." }
          return
        }
      }
    }
  }
}
