(function () {
  // Toute donnee saisie par un client (nom, adresse, etc.) doit passer par
  // ici avant d'etre injectee via innerHTML : sinon un client malveillant
  // peut stocker du HTML/JS qui s'executerait dans la session admin.
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const todayStr = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // ===== Tabs =====
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ===== Onglet 1 : Locations du jour =====
  const jourDateInput = document.getElementById('jour-date');
  jourDateInput.value = todayStr();

  function fmtMontant(v) {
    return `${Number(v).toFixed(2).replace('.', ',')} €`;
  }

  const REGLEMENT_LABELS = { cb: 'CB', especes: 'Espèces', cheque: 'Chèque', virement: 'Virement' };

  async function loadJour() {
    const date = jourDateInput.value;
    const res = await fetch(`/admin/api/locations?date=${date}`);
    const data = await res.json();

    const tbody = document.getElementById('jour-tbody');
    tbody.innerHTML = '';

    data.locations.forEach((loc) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(loc.heure_location)}</td>
        <td>${esc(loc.representant_prenom)} ${esc(loc.representant_nom)}</td>
        <td>${esc(loc.nb_participants)}</td>
        <td>${fmtMontant(loc.montant_total)}</td>
        <td>${esc(REGLEMENT_LABELS[loc.type_reglement] || loc.type_reglement)}</td>
        <td>
          <button class="btn btn-secondary btn-voir" data-id="${loc.id}" style="padding:4px 10px; font-size:12px;">👁 Voir</button>
          <a class="btn btn-secondary" href="/api/locations/${loc.id}/pdf" style="padding:4px 10px; font-size:12px;">📄 PDF</a>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const totalsBar = document.getElementById('jour-totals');
    const repartition = Object.entries(data.totals.parReglement)
      .map(([type, montant]) => `${esc(REGLEMENT_LABELS[type] || type)} : <strong>${fmtMontant(montant)}</strong>`)
      .join(' &nbsp;|&nbsp; ');

    totalsBar.innerHTML = `
      <div>Total encaissé : <strong>${fmtMontant(data.totals.montant)}</strong></div>
      <div>${repartition || 'Aucune location'}</div>
    `;

    tbody.querySelectorAll('.btn-voir').forEach((b) => {
      b.addEventListener('click', () => openDetail(b.dataset.id));
    });
  }

  jourDateInput.addEventListener('change', loadJour);

  // Export des locations sur une periode (par defaut : le mois en cours)
  const exportStartInput = document.getElementById('locations-export-start');
  const exportEndInput = document.getElementById('locations-export-end');
  const today = new Date();
  exportStartInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  exportEndInput.value = todayStr();

  document.getElementById('locations-export').addEventListener('click', () => {
    window.location.href = `/admin/api/locations/export?start=${exportStartInput.value}&end=${exportEndInput.value}`;
  });

  // ===== Modal detail =====
  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-close').addEventListener('click', () => modal.classList.add('hidden'));

  async function openDetail(id) {
    const res = await fetch(`/api/locations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    const loc = data.location;

    const membresHtml = data.membres.map((m) => `
      <tr><td>${esc(m.civilite)}</td><td>${esc(m.nom)}</td><td>${esc(m.prenom)}</td><td>${new Date(m.date_naissance).toLocaleDateString('fr-FR')}</td></tr>
    `).join('');

    document.getElementById('detail-content').innerHTML = `
      <p><strong>N° contrat :</strong> ${esc(data.numero)}</p>
      <p><strong>Représentant :</strong> ${esc(loc.representant_prenom)} ${esc(loc.representant_nom)}<br/>
        ${esc(loc.representant_adresse)}, ${esc(loc.representant_cp)} ${esc(loc.representant_ville)}<br/>
        ${esc(loc.representant_tel)} — ${esc(loc.representant_email)}</p>
      <p><strong>Date / heure :</strong> ${new Date(loc.date_location).toLocaleDateString('fr-FR')} à ${esc(loc.heure_location)}</p>
      <p><strong>Participants :</strong> ${esc(loc.nb_participants)} — <strong>Montant :</strong> ${fmtMontant(loc.montant_total)} — <strong>Règlement :</strong> ${esc(REGLEMENT_LABELS[loc.type_reglement] || loc.type_reglement)}</p>
      <table class="data-table">
        <thead><tr><th>Civilité</th><th>Nom</th><th>Prénom</th><th>Naissance</th></tr></thead>
        <tbody>${membresHtml}</tbody>
      </table>
      <p style="margin-top:14px;"><a class="btn btn-primary" href="/api/locations/${loc.id}/pdf">📄 Télécharger le PDF</a></p>
    `;
    modal.classList.remove('hidden');
  }

  // ===== Onglet 2 : Licences FFCK =====
  const licencesDateInput = document.getElementById('licences-date');
  licencesDateInput.value = todayStr();

  async function loadLicences() {
    const date = licencesDateInput.value;
    const res = await fetch(`/admin/api/licences?date=${date}`);
    const data = await res.json();

    const tbody = document.getElementById('licences-tbody');
    tbody.innerHTML = '';

    data.rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.className = 'copyable';
      const dob = new Date(row.date_naissance).toLocaleDateString('fr-FR');

      const uuidTd = document.createElement('td');
      const uuidInput = document.createElement('input');
      uuidInput.type = 'text';
      uuidInput.placeholder = 'UUID QR code';
      uuidInput.value = row.qr_uuid || '';
      uuidInput.style.width = '100%';
      uuidInput.addEventListener('click', (e) => e.stopPropagation());
      uuidInput.addEventListener('change', async () => {
        const res = await fetch(`/admin/api/membres/${row.id}/qr-uuid`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qr_uuid: uuidInput.value }),
        });
        if (res.ok) {
          const updated = await res.json();
          row.qr_uuid = updated.qr_uuid;
          uuidTd.classList.add('row-flash');
          setTimeout(() => uuidTd.classList.remove('row-flash'), 600);
        }
      });
      uuidTd.appendChild(uuidInput);

      const carteTd = document.createElement('td');
      carteTd.style.textAlign = 'center';
      const carteCheckbox = document.createElement('input');
      carteCheckbox.type = 'checkbox';
      carteCheckbox.checked = !!row.carte_prise;
      carteCheckbox.addEventListener('click', (e) => e.stopPropagation());
      carteCheckbox.addEventListener('change', async () => {
        const res = await fetch(`/admin/api/membres/${row.id}/carte-prise`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carte_prise: carteCheckbox.checked }),
        });
        if (res.ok) {
          const updated = await res.json();
          row.carte_prise = updated.carte_prise;
          carteTd.classList.add('row-flash');
          setTimeout(() => carteTd.classList.remove('row-flash'), 600);
        }
      });
      carteTd.appendChild(carteCheckbox);

      tr.appendChild(uuidTd);
      tr.appendChild(carteTd);
      tr.insertAdjacentHTML('beforeend', `
        <td>${esc(row.civilite)}</td><td>${esc(row.nom)}</td><td>${esc(row.prenom)}</td><td>${dob}</td><td>${esc(row.email)}</td>
      `);
      tr.addEventListener('click', () => {
        const text = [row.qr_uuid || '', row.carte_prise ? 'Oui' : 'Non', row.civilite, row.nom, row.prenom, dob, row.email].join('\t');
        navigator.clipboard.writeText(text);
        tr.classList.add('row-flash');
        setTimeout(() => tr.classList.remove('row-flash'), 600);
      });
      tbody.appendChild(tr);
    });
  }

  licencesDateInput.addEventListener('change', loadLicences);

  // Export des licences sur une periode (par defaut : le mois en cours)
  const licencesExportStartInput = document.getElementById('licences-export-start');
  const licencesExportEndInput = document.getElementById('licences-export-end');
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  licencesExportStartInput.value = monthStart;
  licencesExportEndInput.value = todayStr();

  document.getElementById('licences-export').addEventListener('click', () => {
    window.location.href = `/admin/api/licences/export?start=${licencesExportStartInput.value}&end=${licencesExportEndInput.value}`;
  });
  document.getElementById('licences-export-xlsx').addEventListener('click', () => {
    window.location.href = `/admin/api/licences/export.xlsx?start=${licencesExportStartInput.value}&end=${licencesExportEndInput.value}`;
  });

  // ===== Onglet 3 : Statistiques =====
  let currentPeriod = 'week';
  let chartFreq, chartReglement, chartSources;

  document.querySelectorAll('.stats-period').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stats-period').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      loadStats();
    });
  });

  document.getElementById('stats-export').addEventListener('click', () => {
    window.location.href = `/admin/api/stats/export?period=${currentPeriod}`;
  });

  function destroyChart(c) {
    if (c) c.destroy();
  }

  async function loadStats() {
    const res = await fetch(`/admin/api/stats?period=${currentPeriod}`);
    const data = await res.json();

    document.getElementById('stat-nb-locations').textContent = data.totals.nbLocations;
    document.getElementById('stat-nb-participants').textContent = data.totals.nbParticipants;
    document.getElementById('stat-ca').textContent = fmtMontant(data.totals.chiffreAffaires);
    document.getElementById('stat-panier').textContent = fmtMontant(data.totals.panierMoyen);

    destroyChart(chartFreq);
    chartFreq = new Chart(document.getElementById('chart-frequentation'), {
      type: 'bar',
      data: {
        labels: data.frequentationParJour.map((d) => new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
        datasets: [{ label: 'Locations', data: data.frequentationParJour.map((d) => d.count), backgroundColor: '#1B3A6B' }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });

    destroyChart(chartReglement);
    chartReglement = new Chart(document.getElementById('chart-reglement'), {
      type: 'pie',
      data: {
        labels: data.repartitionReglement.map((d) => REGLEMENT_LABELS[d.type] || d.type),
        datasets: [{ data: data.repartitionReglement.map((d) => d.count), backgroundColor: ['#1B3A6B', '#C0392B', '#7f9cc4', '#e0a499'] }],
      },
    });

    destroyChart(chartSources);
    chartSources = new Chart(document.getElementById('chart-sources'), {
      type: 'pie',
      data: {
        labels: data.sourcesDecouverte.map((d) => d.source),
        datasets: [{ data: data.sourcesDecouverte.map((d) => d.count), backgroundColor: ['#1B3A6B', '#C0392B', '#7f9cc4', '#e0a499', '#F4F6F9'] }],
      },
    });

    const creneauxTbody = document.getElementById('creneaux-tbody');
    creneauxTbody.innerHTML = data.topCreneaux.map((c) => `<tr><td>${esc(c.heure)}</td><td>${esc(c.count)}</td></tr>`).join('');
  }

  // ===== Init =====
  loadJour();
  loadLicences();
  loadStats();
})();
