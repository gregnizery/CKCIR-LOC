(function () {
  const MAX_MEMBRES = 8;
  let currentStep = 1;
  const membres = []; // { cardEl, locked } — pas de signature individuelle, voir étape 4
  let finalPad = null;
  let finalPadReady = false;

  // ===== Helpers =====

  function resizeCanvas(canvas) {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
  }

  function createSignaturePad(canvas) {
    resizeCanvas(canvas);
    return new SignaturePad(canvas, { penColor: '#1a1a1a' });
  }

  function showError(message) {
    const el = document.getElementById('form-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function clearError() {
    document.getElementById('form-error').classList.add('hidden');
  }

  // ===== Navigation =====

  function updateProgress() {
    document.querySelectorAll('.progress-step').forEach((el) => {
      const step = Number(el.dataset.step);
      el.classList.toggle('active', step === currentStep);
      el.classList.toggle('done', step < currentStep);
    });
    document.querySelectorAll('.progress-labels span').forEach((el) => {
      const step = Number(el.dataset.step);
      el.classList.toggle('current', step === currentStep);
      el.classList.toggle('completed', step < currentStep);
    });
  }

  function goToStep(step) {
    currentStep = step;
    document.querySelectorAll('.step-panel').forEach((panel) => {
      panel.classList.toggle('hidden', Number(panel.dataset.stepPanel) !== step);
    });
    updateProgress();
    clearError();

    if (step === 2) syncRepresentantMembre();
    if (step === 4) prepareRecapStep();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===== Étape 1 =====

  function getRepresentant() {
    return {
      nom: document.getElementById('rep-nom').value.trim(),
      prenom: document.getElementById('rep-prenom').value.trim(),
      adresse: document.getElementById('rep-adresse').value.trim(),
      ville: document.getElementById('rep-ville').value.trim(),
      cp: document.getElementById('rep-cp').value.trim(),
      tel: document.getElementById('rep-tel').value.trim(),
      email: document.getElementById('rep-email').value.trim(),
    };
  }

  function getSourceDecouverte() {
    return Array.from(document.querySelectorAll('.source-cb:checked')).map((cb) => cb.value);
  }

  function validateStep1() {
    const r = getRepresentant();
    if (!r.nom || !r.prenom || !r.adresse || !r.ville || !r.cp || !r.tel || !r.email) {
      showError('Merci de remplir tous les champs obligatoires du représentant.');
      return false;
    }
    return true;
  }

  // ===== Étape 2 : Membres =====

  function renumberMembres() {
    membres.forEach((m, i) => {
      m.cardEl.querySelector('[data-membre-title]').textContent = i === 0 ? 'Membre 1 — Représentant' : `Membre ${i + 1}`;
    });
    document.getElementById('btn-add-membre').disabled = membres.length >= MAX_MEMBRES;
  }

  function addMembre(prefill) {
    if (membres.length >= MAX_MEMBRES) return;

    const template = document.getElementById('membre-template');
    const fragment = template.content.cloneNode(true);
    const cardEl = fragment.querySelector('[data-membre-card]');
    const container = document.getElementById('membres-container');
    container.appendChild(cardEl);

    const entry = { cardEl, locked: false };

    if (prefill) {
      const nomInput = cardEl.querySelector('[data-field="nom"]');
      const prenomInput = cardEl.querySelector('[data-field="prenom"]');
      nomInput.value = prefill.nom || '';
      prenomInput.value = prefill.prenom || '';
      if (prefill.lock) {
        nomInput.readOnly = true;
        prenomInput.readOnly = true;
        entry.locked = true;
      }
    }

    const isFirst = membres.length === 0;
    const removeBtn = cardEl.querySelector('[data-remove-membre]');
    if (isFirst) {
      removeBtn.classList.add('hidden');
    } else {
      removeBtn.addEventListener('click', () => removeMembre(entry));
    }

    membres.push(entry);
    renumberMembres();
  }

  function removeMembre(entry) {
    const index = membres.indexOf(entry);
    if (index === -1) return;
    entry.cardEl.remove();
    membres.splice(index, 1);
    renumberMembres();
  }

  function syncRepresentantMembre() {
    const r = getRepresentant();
    if (membres.length === 0) {
      addMembre({ nom: r.nom, prenom: r.prenom, lock: true });
    } else {
      const first = membres[0];
      first.cardEl.querySelector('[data-field="nom"]').value = r.nom;
      first.cardEl.querySelector('[data-field="prenom"]').value = r.prenom;
    }
  }

  function validateStep2() {
    if (membres.length < 1) {
      showError('Au moins un membre est requis.');
      return false;
    }
    for (let i = 0; i < membres.length; i += 1) {
      const m = membres[i];
      const nom = m.cardEl.querySelector('[data-field="nom"]').value.trim();
      const prenom = m.cardEl.querySelector('[data-field="prenom"]').value.trim();
      const civilite = m.cardEl.querySelector('[data-field="civilite"]').value;
      const dateNaissance = m.cardEl.querySelector('[data-field="date_naissance"]').value;
      if (!nom || !prenom || !civilite || !dateNaissance) {
        showError(`Merci de compléter toutes les informations du membre ${i + 1}.`);
        return false;
      }
    }
    return true;
  }

  function collectMembres() {
    return membres.map((m) => ({
      nom: m.cardEl.querySelector('[data-field="nom"]').value.trim(),
      prenom: m.cardEl.querySelector('[data-field="prenom"]').value.trim(),
      civilite: m.cardEl.querySelector('[data-field="civilite"]').value,
      date_naissance: m.cardEl.querySelector('[data-field="date_naissance"]').value,
    }));
  }

  document.getElementById('btn-add-membre').addEventListener('click', () => addMembre());

  // ===== Étape 3 : Attestation =====

  function validateStep3() {
    if (!document.getElementById('attestation-cb').checked) {
      showError("Merci d'accepter l'attestation sur l'honneur pour continuer.");
      return false;
    }
    return true;
  }

  // ===== Étape 4 : Récapitulatif =====

  function prepareRecapStep() {
    document.getElementById('recap-nb-participants').textContent = membres.length;

    const dateInput = document.getElementById('recap-date');
    const heureInput = document.getElementById('recap-heure');
    if (!dateInput.value) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      dateInput.value = `${y}-${m}-${d}`;
      heureInput.value = now.toTimeString().slice(0, 5);
    }

    if (!finalPadReady) {
      finalPad = createSignaturePad(document.getElementById('sig-final'));
      finalPadReady = true;
    }
  }

  document.querySelector('[data-clear-sig="sig-final"]').addEventListener('click', () => {
    if (finalPad) finalPad.clear();
  });

  function validateStep4() {
    const montant = document.getElementById('recap-montant').value;
    const date = document.getElementById('recap-date').value;
    const heure = document.getElementById('recap-heure').value;

    if (montant === '' || Number(montant) < 0) {
      showError('Merci de renseigner le montant total.');
      return false;
    }
    if (!date || !heure) {
      showError('Merci de renseigner la date et l\'heure.');
      return false;
    }
    if (!finalPad || finalPad.isEmpty()) {
      showError('La signature du représentant est requise.');
      return false;
    }
    return true;
  }

  // ===== Navigation buttons =====

  document.querySelectorAll('[data-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearError();
      if (currentStep === 1 && !validateStep1()) return;
      if (currentStep === 2 && !validateStep2()) return;
      if (currentStep === 3 && !validateStep3()) return;
      goToStep(currentStep + 1);
    });
  });

  document.querySelectorAll('[data-prev]').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(currentStep - 1));
  });

  // ===== Soumission =====

  document.getElementById('btn-submit').addEventListener('click', async () => {
    clearError();
    if (!validateStep4()) return;

    const submitBtn = document.getElementById('btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enregistrement...';

    const r = getRepresentant();
    const payload = {
      representant: r,
      source_decouverte: getSourceDecouverte(),
      membres: collectMembres(),
      attestation_acceptee: document.getElementById('attestation-cb').checked,
      heure_location: document.getElementById('recap-heure').value,
      date_location: document.getElementById('recap-date').value,
      nb_participants: membres.length,
      montant_total: Number(document.getElementById('recap-montant').value),
      type_reglement: document.getElementById('recap-reglement').value,
      signature_representant: finalPad.toDataURL('image/png'),
    };

    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error((data.details && data.details.join(', ')) || data.error || 'Erreur inconnue');
      }

      document.getElementById('form-view').classList.add('hidden');
      document.getElementById('confirmation-numero').textContent = data.numero;
      document.getElementById('confirmation-pdf-link').href = data.pdfUrl;
      document.getElementById('confirmation-view').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showError(`Erreur lors de l'enregistrement : ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Valider et signer le contrat';
    }
  });

  // ===== Init =====
  goToStep(1);
})();
