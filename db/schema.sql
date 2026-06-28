CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  representant_nom TEXT NOT NULL,
  representant_prenom TEXT NOT NULL,
  representant_adresse TEXT NOT NULL,
  representant_ville TEXT NOT NULL,
  representant_cp TEXT NOT NULL,
  representant_tel TEXT NOT NULL,
  representant_email TEXT NOT NULL,
  source_decouverte JSONB NOT NULL DEFAULT '[]',
  attestation_acceptee BOOLEAN NOT NULL DEFAULT FALSE,
  heure_location TEXT NOT NULL,
  date_location DATE NOT NULL,
  nb_participants INTEGER NOT NULL,
  montant_total NUMERIC(10, 2) NOT NULL,
  type_reglement TEXT NOT NULL,
  signature_representant TEXT NOT NULL,
  pdf_path TEXT,
  statut TEXT NOT NULL DEFAULT 'actif',
  access_token TEXT,
  motif_annulation TEXT,
  annule_le TIMESTAMPTZ,
  reactive_le TIMESTAMPTZ
);

-- Seul le representant signe le contrat (signature_representant sur
-- locations), au nom de l'ensemble du groupe : les membres n'ont pas de
-- signature individuelle.
CREATE TABLE IF NOT EXISTS membres (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  civilite TEXT NOT NULL,
  date_naissance DATE NOT NULL,
  ordre INTEGER NOT NULL,
  qr_uuid TEXT,
  carte_prise BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_locations_date ON locations (date_location);
CREATE INDEX IF NOT EXISTS idx_membres_location ON membres (location_id);

-- Migration : les anciennes installations ont pu creer la colonne avant
-- qu'on decide que seul le representant signe le contrat.
ALTER TABLE membres DROP COLUMN IF EXISTS signature;

-- Migration : UUID du QR code FFCK saisi par le staff pour l'export licences.
ALTER TABLE membres ADD COLUMN IF NOT EXISTS qr_uuid TEXT;

-- Migration : le club prend une carte FFCK "1 jour" pour chaque locataire ;
-- on note si c'est fait pour pouvoir suivre les oublis.
ALTER TABLE membres ADD COLUMN IF NOT EXISTS carte_prise BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration : jeton d'acces non-devinable pour telecharger son propre PDF
-- de contrat sans etre connecte en admin. L'id sequentiel seul ne doit
-- jamais suffire (cf. audit securite : IDOR sur /api/locations/:id/pdf).
ALTER TABLE locations ADD COLUMN IF NOT EXISTS access_token TEXT;
UPDATE locations SET access_token = md5(random()::text || clock_timestamp()::text || id::text)
  WHERE access_token IS NULL;

-- Migration : annulation tracee d'une location par le staff (cas d'erreur de
-- saisie, doublon...) sans perdre l'historique - on garde le motif et les
-- dates plutot que de supprimer la ligne.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS motif_annulation TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS annule_le TIMESTAMPTZ;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS reactive_le TIMESTAMPTZ;
