(() => {
  "use strict";

  const copy = {
    es: {
      "preview.badge": "Vista previa · Sin envíos", "preview.stageEyebrow": "Una propuesta para tu enlace",
      "preview.stageTitle": "Recibir oportunidades con contexto.",
      "preview.explanation": "No es un buscador. Es una ficha para que quien visite tu currículum te presente una oportunidad y revise el mensaje antes de contactarte.",
      "preview.open": "Ver demostración", "preview.unchanged": "Esta vista previa no modifica tu currículum actual.", "preview.back": "Volver al currículum",
      "preview.title": "Presentar una oportunidad", "preview.subtitle": "No busca ofertas: prepara un mensaje con la oportunidad que quieres presentarme.",
      "preview.stepsLabel": "Pasos de la propuesta", "preview.step1": "La oportunidad", "preview.step2": "Revisar mensaje", "preview.step3": "Contactar",
      "preview.formTitle": "Cuéntame la oportunidad", "preview.example": "Ejemplo editable", "preview.draft": "Borrador local",
      "preview.company": "Empresa u organización", "preview.role": "Cargo o proyecto", "preview.description": "Descripción de la oportunidad",
      "preview.review": "Revisar propuesta", "preview.reset": "Restablecer ejemplo", "preview.messageEyebrow": "Así llegaría tu propuesta",
      "preview.messageTitle": "Un mensaje, todo el contexto.", "preview.recipient": "Para Paulina Contreras", "preview.continue": "Continuar en WhatsApp",
      "preview.disclaimer": "Modo demostración: no se abre WhatsApp ni se envía información.", "preview.local": "La propuesta permanece en esta vista previa.",
      "preview.required": "Completa este campo.", "preview.tooShort": "Escribe al menos 15 caracteres.",
      "preview.empty": "Completa los tres campos para preparar una propuesta.", "preview.ready": "Propuesta lista para revisar. Todavía no se ha enviado nada.",
      "preview.simulated": "Demostración completada: no se abrió WhatsApp ni se envió ningún mensaje.",
      "preview.exampleCompany": "Empresa de ejemplo", "preview.exampleRole": "Jefatura de Ventas",
      "preview.exampleDescription": "Buscamos una profesional para liderar un equipo comercial y desarrollar nuevas oportunidades de negocio.",
      "preview.greeting": "Hola, Paulina:", "preview.messageIntro": "Me gustaría presentarte una oportunidad profesional.",
      "preview.messageEnd": "¿Te interesaría conversar sobre esta propuesta?"
    },
    en: {
      "preview.badge": "Preview · Nothing is sent", "preview.stageEyebrow": "A proposal for your link",
      "preview.stageTitle": "Receive opportunities with context.",
      "preview.explanation": "This is not a search tool. Visitors describe an opportunity and review their message before contacting you.",
      "preview.open": "Open demonstration", "preview.unchanged": "This preview does not change your current CV.", "preview.back": "Back to the CV",
      "preview.title": "Present an opportunity", "preview.subtitle": "This does not search for jobs: it prepares a message about the opportunity you want to share.",
      "preview.stepsLabel": "Proposal steps", "preview.step1": "The opportunity", "preview.step2": "Review message", "preview.step3": "Get in touch",
      "preview.formTitle": "Describe the opportunity", "preview.example": "Editable example", "preview.draft": "Local draft",
      "preview.company": "Company or organisation", "preview.role": "Position or project", "preview.description": "Opportunity description",
      "preview.review": "Review proposal", "preview.reset": "Restore example", "preview.messageEyebrow": "How your proposal would arrive",
      "preview.messageTitle": "One message, all the context.", "preview.recipient": "To Paulina Contreras", "preview.continue": "Continue to WhatsApp",
      "preview.disclaimer": "Demonstration only: WhatsApp is not opened and no information is sent.", "preview.local": "Your proposal stays in this preview.",
      "preview.required": "Complete this field.", "preview.tooShort": "Enter at least 15 characters.",
      "preview.empty": "Complete all three fields to prepare a proposal.", "preview.ready": "Your proposal is ready to review. Nothing has been sent yet.",
      "preview.simulated": "Demonstration complete: WhatsApp was not opened and no message was sent.",
      "preview.exampleCompany": "Example company", "preview.exampleRole": "Sales Manager",
      "preview.exampleDescription": "We are looking for a professional to lead a sales team and develop new business opportunities.",
      "preview.greeting": "Hello, Paulina:", "preview.messageIntro": "I would like to share a professional opportunity with you.",
      "preview.messageEnd": "Would you be interested in discussing this proposal?"
    }
  };
  const root = document.documentElement;
  const dialog = document.getElementById("opportunity-dialog");
  const form = document.getElementById("opportunity-form");
  const company = document.getElementById("opportunity-company");
  const role = document.getElementById("opportunity-role");
  const description = document.getElementById("opportunity-description");
  const fields = [company, role, description];
  const output = document.getElementById("preview-message");
  const continueButton = document.getElementById("preview-continue");
  const status = document.getElementById("preview-status");
  const openButton = document.getElementById("open-preview");
  let language = "es";
  let exampleActive = true;

  try { language = localStorage.getItem("paulina-language") === "en" ? "en" : "es"; } catch { /* Preview also works without storage. */ }
  const t = (key) => copy[language][key] ?? window.CV_TRANSLATIONS[language][key] ?? key;

  function setStep(step) {
    document.querySelectorAll("[data-preview-step]").forEach((element) => {
      const number = Number(element.dataset.previewStep);
      element.classList.toggle("is-complete", number < step);
      if (number === step) element.setAttribute("aria-current", "step");
      else element.removeAttribute("aria-current");
    });
  }

  function renderMessage() {
    const values = fields.map((field) => field.value.trim());
    output.textContent = values.every(Boolean)
      ? `${t("preview.greeting")}\n\n${t("preview.messageIntro")}\n\n${t("preview.company")}: ${values[0]}\n${t("preview.role")}: ${values[1]}\n\n${t("preview.description")}:\n${values[2]}\n\n${t("preview.messageEnd")}`
      : t("preview.empty");
    document.getElementById("preview-data-badge").textContent = t(exampleActive ? "preview.example" : "preview.draft");
    continueButton.disabled = true;
    status.textContent = "";
    setStep(1);
  }

  function restoreExample() {
    exampleActive = true;
    fields.forEach((field) => field.setCustomValidity(""));
    company.value = t("preview.exampleCompany");
    role.value = t("preview.exampleRole");
    description.value = t("preview.exampleDescription");
    renderMessage();
  }

  function updateTheme() {
    const dark = root.dataset.theme === "dark";
    const button = document.getElementById("preview-theme");
    button.setAttribute("aria-label", t(dark ? "theme.activateLight" : "theme.activateDark"));
    button.querySelector(".icon").className = `icon icon--${dark ? "sun" : "moon"}`;
    document.querySelector('meta[name="theme-color"]').content = dark ? "#201d22" : "#f4eee9";
  }

  function setLanguage() {
    root.lang = language;
    document.title = `${t("preview.title")} · ${t("preview.badge")}`;
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-aria]").forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAria)); });
    const button = document.getElementById("preview-language");
    button.textContent = language === "es" ? "ES / EN" : "EN / ES";
    button.setAttribute("aria-label", t("language.switch"));
    fields.forEach((field) => field.setCustomValidity(""));
    updateTheme();
    if (exampleActive) restoreExample();
    else renderMessage();
  }

  form.addEventListener("input", (event) => {
    event.target.setCustomValidity("");
    exampleActive = false;
    renderMessage();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    fields.forEach((field) => field.setCustomValidity(field.value.trim() ? "" : t("preview.required")));
    if (description.value.trim() && description.value.trim().length < 15) description.setCustomValidity(t("preview.tooShort"));
    if (!form.reportValidity()) return;
    setStep(2);
    continueButton.disabled = false;
    status.textContent = t("preview.ready");
    output.focus();
  });
  continueButton.addEventListener("click", () => {
    setStep(3);
    continueButton.disabled = true;
    status.textContent = t("preview.simulated");
  });
  document.getElementById("reset-preview").addEventListener("click", restoreExample);
  document.getElementById("preview-language").addEventListener("click", () => { language = language === "es" ? "en" : "es"; setLanguage(); });
  document.getElementById("preview-theme").addEventListener("click", () => { root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark"; updateTheme(); });
  openButton.addEventListener("click", () => { if (!dialog.open) dialog.showModal(); });
  document.querySelectorAll("[data-preview-close]").forEach((button) => { button.addEventListener("click", () => dialog.close()); });
  dialog.addEventListener("close", () => openButton.focus({ preventScroll: true }));
  setLanguage();
  dialog.showModal();
})();
