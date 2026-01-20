# Product Requirement Document (PRD): Voice

**Version:** 1.0
**Status:** Approved for Development
**Target Platform:** macOS & Windows
**Architecture:** Electron (Multi-Process)

---

## 1. Project Overview

Voice is a minimalist, globally available voice input assistant. Unlike traditional dictation tools, it utilizes Large Language Models (LLM) to instantly rewrite, polish, and structure spoken audio into high-quality text. The application features a "Capsule" UI that floats on the desktop, offering physics-based animations and immediate feedback.

### 1.1 Core Value Proposition

* **Context-Aware:** Detects input focus for auto-pasting or falls back to a manual copy interface.
* **High-Fidelity Interaction:** Non-linear animations, fluid state transitions, and psychological wait-time compensation.
* **Vendor Agnostic:** Supports custom configuration for ASR (ByteDance/Doubao) and LLM (OpenAI Compatible).

---

## 2. Technical Stack & Architecture

### 2.1 Technology Selection

* **Runtime:** Electron 31.x+ (Must support latest WebGPU/Transparency APIs).
* **Frontend Framework:** React 18 + TypeScript.
* **Styling:** Tailwind CSS v4.
* **Animation:** Framer Motion (for layout transitions), Native Canvas API (for high-performance waveforms).
* **State Management:** Zustand.
* **Native Capabilities:** Node-API, `robotjs`/`nut.js` (for keyboard simulation), `electron-store` (persistence).

### 2.2 Process Architecture

The application runs on a multi-window architecture managed by the Main Process.

1. **Main Process (Node.js):**
* Manages Application Lifecycle.
* Handles Global Shortcuts (`globalShortcut`).
* Manages System Clipboard and Keyboard Simulation.
* Handles Auto-updates (`electron-updater`).
* Orchestrates Window visibility.


2. **Renderer: Capsule Window:**
* Characteristics: Transparent, Frameless, Always-on-top, Resizable (for Popover).
* Role: Core interaction, Recording UI, Thinking UI, Result Preview.


3. **Renderer: Settings Window:**
* Characteristics: Standard OS window.
* Role: Configuration (API Keys), Tutorials, Usage Statistics.



---

## 3. Visual & Interaction Specifications

### 3.1 The Capsule Component

* **Dimensions:** 280px (Width) x 64px (Height).
* **Shape:** Pill-shape (Full radius).
* **Shadow:** `0 12px 40px rgba(0,0,0,0.1)` (Diffuse soft shadow).
* **Border:** `1px solid #F0F0F0` (Visible only in Light Mode).

### 3.2 Animation Physics

All window entries and exits must use spring physics, not linear easing.

* **Spring Config:** Stiffness: 260, Damping: 20.
* **Entry:** Scale 0 -> 1, Opacity 0 -> 1, TranslateY 20px -> 0px.
* **Exit:** Scale 1 -> 0, Opacity 1 -> 0, TranslateY 0px -> 20px (Simulating gravity pull).

### 3.3 State Machine Definition

#### State A: IDLE

* Window is hidden (`hide()`) or fully transparent.
* Resources (Mic/ASR) are released.

#### State B: RECORDING

* **Visuals:** White background (`#FFFFFF`).
* **Elements:**
* **Left:** Cancel Button (Circle `#E0E0E0`, White 'X' Icon).
* **Right:** Confirm Button (Circle `#FFFFFF`, Gray `#888888` Check Icon).
* **Center:** Dynamic Waveform.


* **Waveform Spec:**
* 7 vertical bars, rounded caps.
* Color: `#333333`.
* Animation: Bars respond to audio amplitude. Smooth transitions between height updates are mandatory (interpolate current height to target height).



#### State C: THINKING

* **Trigger:** User confirms input (or Short Mode key release).
* **Transition:** Buttons fade out, Background fades to Black (`#1A1A1A`) over 300ms.
* **Progress Indicator:**
* A Dark Gray (`#3D3D3D`) overlay fills the capsule from Left to Right.
* **Logic:** Progress linearly increases to 95% over 3 seconds and holds. It *only* completes to 100% upon receiving the success signal from the Main Process.


* **Text:** "Thinking..." displayed in center with a Shimmer Effect (Gradient mask moving Left to Right).

#### State D: SUCCESS / PASTE

* **Visuals:** Progress fills to 100% instantly.
* **Action:**
1. Capsule executes Exit Animation.
2. Main Process simulates `Cmd+V` (macOS) or `Ctrl+V` (Windows).
3. Window hides after animation completes.



#### State E: FALLBACK (Paste Failed)

* **Trigger:** System detects focus is not editable or paste fails.
* **Visuals:**
* Capsule morphs/expands upwards (Popover).
* Displays the generated text.
* Shows a primary "Copy" button.
* Background: Dark Glassmorphism.



---

## 4. Functional Requirements

### 4.1 Input Modes

**1. Hold-to-Talk (Short Mode)**

* **Action:** User holds a specific key (e.g., `Right Option`).
* **Behavior:** Recording starts on `keydown`, commits on `keyup`.
* **UI:** No Cancel/Confirm buttons displayed (Waveform only).
* **Timeout:** If holding > 30 seconds, show a Popover hint: "Press [Key] to switch to Hands-free mode."

**2. Toggle-to-Talk (Long Mode)**

* **Action:** User taps a global shortcut (e.g., `Ctrl+Space`).
* **Behavior:** Toggles Recording ON. User must manually click "Check" (Confirm) or "X" (Cancel).
* **UI:** Full UI with buttons.

### 4.2 Audio & Processing Pipeline

1. **Capture:** 16bit, 16kHz, Mono (Raw PCM).
2. **ASR (Speech-to-Text):**
* Connect to ByteDance/Doubao WebSocket API.
* Send audio chunks in real-time.
* Handle `partial_result` for low-latency feedback (optional future feature: display real-time text).


3. **LLM (Text-to-Text):**
* Input: Raw ASR text.
* System Prompt: "You are a text polisher. Remove filler words (uh, um), correct grammar, and format punctuation. Output ONLY the polished text."
* API: OpenAI Compatible endpoint (Configurable in Settings).



### 4.3 Error Handling

* **Network Error:** If ASR/LLM fails, Capsule flashes Red (`#FF5F57`) and shakes (X-axis vibration) before closing.
* **Permission Error:** If Mic access is denied, open Settings Window to the Tutorial page.

---

## 5. Deployment & Updates

### 5.1 Update Mechanism

* **Provider:** GitHub Releases.
* **Library:** `electron-updater`.
* **Flow:**
1. App checks `latest.yml` on startup.
2. If update exists, Capsule displays a non-intrusive indicator.
3. **Action:** Due to likely lack of Apple Code Signing in the open-source version, the "Update" action should trigger `shell.openExternal(github_release_url)` to let the user download the new DMG/Exe manually to avoid OS corruption warnings.



### 5.2 Build Artifacts

* **macOS:** DMG (x64, arm64).
* **Windows:** NSIS Installer (x64).

---

## 6. Implementation Guidelines for Developers

### 6.1 Directory Structure

```
/src
  /main          # Electron Main Process (Node.js)
    index.ts     # Entry point, Window Managers
    ipc.ts       # IPC Event Handlers
    updater.ts   # Update logic
  /renderer      # React Frontend
    /components
      /Capsule   # The main UI component
      /Settings  # The configuration screens
    /hooks       # Custom hooks (useAudioRecorder, useWaveform)
    /store       # Zustand stores
  /shared        # Shared Types & Constants

```

### 6.2 IPC Protocol (Strict)

* **Renderer -> Main:**
* `CAPSULE_RESIZE`: { width, height }
* `START_PROCESSING`: void
* `COPY_TEXT`: { text }
* `OPEN_SETTINGS`: void


* **Main -> Renderer:**
* `SET_STATE`: 'IDLE' | 'RECORDING' | 'THINKING' | 'SUCCESS' | 'FALLBACK'
* `UPDATE_AVAILABLE`: { version }



### 6.3 Code Standards

* **Styles:** Use Tailwind utility classes for layout. Use CSS Modules or `style` props ONLY for dynamic values (e.g., animation coordinates, colors).
* **Optimization:** The Waveform must use `requestAnimationFrame`. Do not use React State for high-frequency layout updates; use Refs or direct DOM manipulation where necessary for performance.
* **Security:** Context Isolation must be enabled (`contextIsolation: true`). Node integration must be disabled in Renderer (`nodeIntegration: false`).

---

## 7. Data Privacy

* **Local Storage:** All API Keys and History logs must be stored locally using `electron-store`.
* **Encryption:** API Keys should be encrypted at rest if possible.
* **Transmission:** Audio data is strictly transient and sent only to the user-configured ASR endpoint. No telemetry data is sent to the developer.

---