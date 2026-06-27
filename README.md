# CKCIR — Application de contrats de location

Application web pour le **Club de Canoë-Kayak de l'Île Robinson** (CKCIR,
Saint-Grégoire, 35760) : formulaire client multi-étapes pour signer un
contrat de location (avec signatures électroniques), génération automatique
d'un PDF fidèle au contrat papier, et espace staff pour suivre les
locations, préparer les licences FFCK et consulter des statistiques.

## Stack

- Node.js + Express
- PostgreSQL (table `locations` + `membres`)
- Génération PDF : Puppeteer (`puppeteer-core` + `@sparticuz/chromium-min`,
  compatible avec un environnement conteneur classique type Railway/Render)
- Signatures : `signature_pad` (canvas, chargé en CDN)
- Frontend : HTML/CSS/JS vanilla, Chart.js en CDN pour les statistiques
- Hébergement : Render (gratuit) + base PostgreSQL Neon (gratuite) — voir
  aussi la section Railway plus bas si vous préférez cette alternative
  payante

## Démarrage en local

```bash
npm install
cp .env.example .env
# renseigner DATABASE_URL (Postgres local ou Railway), ADMIN_PASSWORD, SESSION_SECRET
npm start
```

L'app écoute par défaut sur `http://localhost:3000`.

- Formulaire client : `/form`
- Espace staff : `/admin` (mot de passe = `ADMIN_PASSWORD`)

Au démarrage, le serveur exécute automatiquement `db/schema.sql` pour créer
les tables si elles n'existent pas encore (`CREATE TABLE IF NOT EXISTS`).

### Génération de PDF en local

Par défaut, en l'absence de `CHROME_EXECUTABLE_PATH`, le serveur télécharge
le pack Chromium distant indiqué par `CHROMIUM_PACK_URL` (cf.
`.env.example`) — cela fonctionne aussi en local mais télécharge ~100 Mo au
premier lancement. Pour aller plus vite en développement, définissez
`CHROME_EXECUTABLE_PATH` dans `.env` avec le chemin d'un Chrome/Chromium déjà
installé sur votre machine, par exemple :

```
CHROME_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

## Déploiement gratuit sur Render + Neon

Cette option ne coûte rien : Render offre un plan gratuit pour le service
web, Neon une base PostgreSQL gratuite et persistante. Contrepartie du plan
gratuit Render : le service "s'endort" après 15 minutes sans trafic, et le
premier visiteur qui le réveille attend ~30-50 secondes de démarrage à froid
(seul le chargement de la page est concerné — la génération du PDF se fait
déjà en arrière-plan après la création du contrat, donc cela ne bloque pas
la confirmation client).

1. **Créer la base PostgreSQL sur Neon**
   - Sur [neon.tech](https://neon.tech), créez un compte (gratuit, pas de
     carte bancaire requise) puis un nouveau projet.
   - Copiez la *Connection string* fournie (commence par
     `postgresql://...`) — c'est la valeur de `DATABASE_URL`.

2. **Pousser le code sur GitHub**
   - Ce dépôt doit être accessible depuis un repo GitHub pour que Render
     puisse s'y connecter (`git remote add origin ...` puis `git push`).

3. **Créer le service web sur Render**
   - Sur [render.com](https://render.com), créez un compte (gratuit), puis
     `New + → Blueprint` et pointez vers ce repo GitHub : Render lit le
     fichier [render.yaml](render.yaml) à la racine et propose
     automatiquement la configuration du service (build `npm install`,
     démarrage `npm start`, plan gratuit).
   - Lors de la validation du Blueprint, Render demande la valeur des
     variables marquées `sync: false` : renseignez `DATABASE_URL` (collée
     depuis Neon à l'étape 1) et `ADMIN_PASSWORD` (mot de passe de l'espace
     staff). `SESSION_SECRET` est généré automatiquement.

4. **Stockage des PDF (filesystem éphémère)**
   - Comme sur Railway, le filesystem d'un service Render gratuit est
     éphémère (perdu à chaque redéploiement/redémarrage). L'application gère
     déjà ce cas : si le PDF n'est plus présent sur disque, il est régénéré à
     la demande au moment du téléchargement (`GET /api/locations/:id/pdf`).
     Aucune action requise, mais ne comptez pas sur `/pdfs` comme stockage
     durable. Les disques persistants Render existent mais nécessitent un
     plan payant.

5. **Déployer et tester**
   - Render build et démarre le service automatiquement après le Blueprint.
     Suivez les logs jusqu'à `CKCIR app demarree sur le port...`.
   - Ouvrez `https://<votre-service>.onrender.com/form` pour tester le
     parcours client, puis `/admin` pour l'espace staff.

## Déploiement sur Railway en 5 étapes

1. **Créer le projet et le service web**
   - Sur [railway.app](https://railway.app), créez un nouveau projet, puis
     déployez ce dépôt (`New Project → Deploy from GitHub repo`). Railway
     détecte le `Procfile` (`web: node server.js`).

2. **Ajouter une base PostgreSQL**
   - Dans le même projet : `New → Database → Add PostgreSQL`.
   - Railway génère automatiquement la variable `DATABASE_URL` et la rend
     disponible au service web si vous reliez les deux services (onglet
     *Variables*, bouton *Add Reference*).

3. **Configurer les variables d'environnement du service web**
   - `ADMIN_PASSWORD` : mot de passe de l'espace staff.
   - `SESSION_SECRET` : chaîne aléatoire longue pour signer les cookies de
     session.
   - `NODE_ENV=production`.
   - `CHROMIUM_PACK_URL` : URL du pack Chromium pré-compilé compatible avec
     la version de `@sparticuz/chromium-min` installée (voir la section
     *Releases* de [github.com/Sparticuz/chromium](https://github.com/Sparticuz/chromium/releases) —
     prenez le fichier `chromium-vX.Y.Z-pack.tar` correspondant à la version
     du package npm utilisée dans `package.json`).
   - `PORT` n'est pas à définir : Railway l'injecte automatiquement.

4. **Vérifier le stockage des PDF (filesystem éphémère)**
   - Le filesystem d'un service Railway est **éphémère** : à chaque
     redéploiement ou redémarrage, le contenu de `/pdfs` est perdu. Deux
     options :
     - **Option recommandée — Railway Volumes** : dans l'onglet *Settings*
       du service, ajoutez un *Volume* monté sur `/app/pdfs`. Les fichiers
       PDF générés survivront alors aux redéploiements.
     - **Option alternative — stockage en base** : modifier la colonne
       `pdf_path` (ou ajouter une colonne `pdf_data BYTEA`) pour stocker le
       contenu binaire du PDF directement en PostgreSQL plutôt qu'un chemin
       de fichier, et adapter la route `GET /api/locations/:id/pdf` pour
       streamer ce contenu. Plus robuste pour la durabilité, mais alourdit
       la base.
   - Sans l'une de ces deux options, les PDF restent accessibles tant que
     le service ne redémarre pas, mais ne doivent pas être considérés comme
     un stockage durable.

5. **Déployer et tester**
   - Lancez le déploiement (`Deploy`), attendez que les logs affichent
     `Schema PostgreSQL initialise.` puis `CKCIR app demarree sur le port...`.
   - Ouvrez `https://<votre-service>.up.railway.app/form` pour tester le
     parcours client, puis `/admin` pour l'espace staff.

## Variables d'environnement

Voir [.env.example](.env.example) :

| Variable | Description |
|---|---|
| `DATABASE_URL` | URL de connexion PostgreSQL (Neon, Railway, ou locale) |
| `ADMIN_PASSWORD` | Mot de passe de l'espace staff `/admin` |
| `SESSION_SECRET` | Clé de signature des cookies de session |
| `NODE_ENV` | `production` en hébergement, `development` en local |
| `PORT` | Port d'écoute (injecté automatiquement par Render/Railway) |
| `CHROMIUM_PACK_URL` | URL du pack Chromium pour la génération PDF |
| `CHROME_EXECUTABLE_PATH` | (local uniquement) chemin vers un Chrome déjà installé |

## Structure du projet

```
config/db.js          Connexion PostgreSQL + initialisation du schéma
middleware/auth.js     Middleware de protection de l'espace staff
routes/public.js       Page client /form
routes/api.js          API contrats (création, lecture, téléchargement PDF)
routes/admin.js        Login staff + API locations/licences/statistiques
lib/pdf-generator.js   Génération du PDF de contrat (Puppeteer)
db/schema.sql          Schéma PostgreSQL (locations, membres)
views/                 Pages HTML (formulaire, login staff, dashboard staff)
public/css/style.css   Charte graphique CKCIR
public/js/form.js      Logique du formulaire client multi-étapes
public/js/admin.js     Logique du dashboard staff
pdfs/                  PDF générés (non versionné, voir étape 4 ci-dessus)
```

## Charte graphique

- Bleu marine `#1B3A6B`, rouge `#C0392B`, fond blanc, gris clair `#F4F6F9`.
- Police Inter (Google Fonts).
- En-tête : logo + "Club de Canoë-Kayak de l'Île Robinson (CKCIR
  Saint-Grégoire)", mention FFCK en italique, séparateur bleu marine.
- Pied de page : "Île Robinson — 35760 Saint-Grégoire — 06 07 89 31 03 —
  infockcir@gmail.com — ckcir.net".
