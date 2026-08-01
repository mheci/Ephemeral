/**
 * Friendly, clear, simple onboarding for fresh installations.
 * Theme-able via ui.css variables (light/dark via prefers-color-scheme).
 * Extremely clear: 4 steps, plain language, no jargon.
 */

let currentStep = 1;
const totalSteps = 4;

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing onboarding element: ${selector}`);
  return el;
}

function updateProgress(): void {
  const fill = element<HTMLElement>("#progress-fill");
  const text = element<HTMLElement>("#progress-text");
  const percent = (currentStep / totalSteps) * 100;
  fill.style.width = `${percent}%`;
  text.textContent = `Step ${currentStep} of ${totalSteps}`;

  // Update dots
  document.querySelectorAll<HTMLElement>(".dot").forEach((dot) => {
    const step = Number(dot.dataset["step"]);
    dot.classList.toggle("active", step === currentStep);
  });

  // Update buttons
  const prev = element<HTMLButtonElement>("#prev-step");
  const next = element<HTMLButtonElement>("#next-step");
  prev.disabled = currentStep === 1;
  next.textContent = currentStep === totalSteps ? "Done" : "Next";
}

function showStep(step: number): void {
  document.querySelectorAll<HTMLElement>(".onboarding-step").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset["step"]) === step);
  });
  currentStep = step;
  updateProgress();
}

function bind(): void {
  element<HTMLButtonElement>("#prev-step").addEventListener("click", () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });

  element<HTMLButtonElement>("#next-step").addEventListener("click", () => {
    if (currentStep < totalSteps) {
      showStep(currentStep + 1);
    } else {
      // Done – mark onboarding complete and close or go to dashboard
      void browser.storage.local.set({ onboardingCompleted: true }).then(() => {
        window.close();
      });
    }
  });

  element<HTMLButtonElement>("#try-ephemeral").addEventListener("click", () => {
    // Create new ephemeral tab and close onboarding
    void browser.runtime
      .sendMessage({ type: "CREATE_CONTAINER", kind: "one-time", openTab: true })
      .then(() => browser.storage.local.set({ onboardingCompleted: true }))
      .then(() => window.close())
      .catch(() => {
        // Fallback: open dashboard
        window.location.href = "../options/index.html";
      });
  });

  element<HTMLButtonElement>("#open-dashboard").addEventListener("click", () => {
    void browser.storage.local.set({ onboardingCompleted: true }).then(() => {
      window.location.href = "../options/index.html";
    });
  });

  // Keyboard navigation: Arrow keys, Enter, Escape
  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "Enter") {
      if (currentStep < totalSteps) showStep(currentStep + 1);
    } else if (event.key === "ArrowLeft") {
      if (currentStep > 1) showStep(currentStep - 1);
    } else if (event.key === "Escape") {
      void browser.storage.local
        .set({ onboardingCompleted: true })
        .then(() => window.close());
    }
  });
}

// Initialize
try {
  bind();
  updateProgress();
} catch (error) {
  console.error("[ephemeral] Onboarding failed", error);
}
