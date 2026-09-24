# La Bédaine

Application web qui coordonne le weekend annuel de La Bédaine — un chalet loué pour un grand
groupe d'amis (environ 90 personnes), organisé depuis deux décennies. L'app remplace le classeur
Google Sheets/Excel utilisé pour la majeure partie de cette histoire : elle gère les inscriptions,
le calcul de ce que chaque groupe doit payer, l'hébergement, les besoins alimentaires, le transport
et le bénévolat.

Interface 100 % en français (fr-CA); code, base de données et noms de fichiers en anglais.

## Documentation

La documentation technique complète (architecture, modèle de données, règles de tarification,
sécurité/RLS, contribution, dette technique, feuille de route) se trouve dans
**[`docs/`](./docs/README.md)**.

- [`docs/README.md`](./docs/README.md) — l'index, à lire en premier
- [Vue d'ensemble du produit](./docs/01-product-overview.md) — ce que l'app remplace et pour qui
- [Architecture](./docs/02-architecture.md) — la forme du système et ses frontières de confiance
- [Modèle de données](./docs/03-data-model.md) — tables, JSONB, triggers, RLS
- [Tarification et règles d'affaires](./docs/04-pricing-and-business-rules.md) — la logique monétaire
- [Contribuer](./docs/08-contributing.md) — conventions, branches, revues
- [État du code](./docs/09-state-of-the-code.md) — anomalies confirmées et dette technique
- [Décisions d'architecture (ADR)](./docs/adr/) — pourquoi le système est fait ainsi

Un agent (ou un humain) qui commence à travailler sur ce dépôt devrait d'abord lire
**[`AGENTS.md`](./AGENTS.md)**.

## Fonctionnalités

- 🔐 Authentification Google et Facebook via Supabase OAuth
- 📝 Inscription au weekend : composition du groupe, hébergement, alimentation, transport, bénévolat
- 💰 Moteur de tarification par points, avec rabais pour les nouveaux membres
- 🛠️ Admin : gestion des événements, suivi des paiements, assignation des places,
  simulateur de scénarios de prix, export CSV/presse-papier
- 🔒 Sécurité au niveau des lignes (RLS) dans Postgres — chaque membre ne voit que ses propres données
- 📱 Interface responsive, mobile d'abord
- 🇫🇷 Interface entièrement en français (fr-CA), dictionnaire de traduction centralisé

## Stack technique

- **React 19** + **Vite 6** — SPA, sans rendu serveur
- **Tailwind CSS v4** (plugin Vite, sans `tailwind.config.js`)
- **Supabase** — Postgres, Auth OAuth, Realtime; c'est le seul backend de l'application
- **React Router 7** — routage côté client
- Aucune bibliothèque de gestion d'état, pas de TypeScript

Détails et justification dans [Architecture](./docs/02-architecture.md) et
[ADR 0001](./docs/adr/0001-supabase-as-the-only-backend.md).

## Structure du projet

```
.
├── AGENTS.md               # point d'entrée pour travailler sur ce dépôt (agents et humains)
├── CLAUDE.md               # symlink vers AGENTS.md
├── docs/                   # documentation technique complète
├── src/
│   ├── App.jsx             # routage, session, statut admin, chargement de l'événement actif
│   ├── main.jsx            # point d'entrée React
│   ├── index.css           # '@import "tailwindcss";' — rien d'autre
│   ├── components/         # Header, EventModal, RegistrationForm
│   ├── views/              # HomeView, AdminView, EventDetailsView, RegistrationSummary
│   ├── lib/
│   │   ├── supabase.js         # client Supabase — instance unique
│   │   ├── pricingEngine.js    # règles de tarification, pur, testé
│   │   └── registrationOptions.js  # valeurs stockées ↔ libellés français
│   └── locales/fr.json     # tous les textes de l'interface
├── supabase/
│   ├── schema.sql          # tables, triggers, RLS (voir les mises en garde dans docs/)
│   └── tests/              # données de seed pour les tests RLS
└── vercel.json             # configuration de déploiement (production tourne sur Vercel)
```

## Démarrage rapide

```bash
git clone <repository-url>
cd YULMixLaBedaine
npm install
cp .env.example .env        # puis remplir les deux valeurs VITE_SUPABASE_*
npm run dev                 # http://localhost:5173
```

Détails complets (y compris les pièges actuels vérifiés — lockfile, schéma SQL, suite de tests) dans
[Développement](./docs/07-development-setup.md).

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de développement Vite |
| `npm run build` | Build de production dans `dist/` |
| `npm run preview` | Prévisualise le build de production |
| `npm run test:pricing` | Vérifie le moteur de tarification (`src/lib/pricingEngine.js`) |
| `npm test` | Suite Jest complète |
| `npm run test:rls` | Tests des politiques RLS (nécessite une instance Supabase locale) |

## Déploiement

**La production tourne sur Vercel.** `vercel.json` configure la commande de build, le dossier
`dist/`, et les réécritures SPA. Les variables d'environnement (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) se configurent dans les paramètres du projet Vercel.

Un fichier `netlify.toml` subsiste dans le dépôt d'une période où l'hébergeur n'était pas encore
fixé; il n'est plus utilisé. Le déploiement n'est pour l'instant pas conditionné par la CI — voir
[l'état du code](./docs/09-state-of-the-code.md) et la [feuille de route](./docs/10-roadmap.md)
pour le plan visant à corriger cela.

## Contribuer

Voir [`docs/08-contributing.md`](./docs/08-contributing.md) pour les règles de base, le processus
de revue, et comment travailler avec des agents de codage sur ce dépôt. Le travail en cours se
suit via les *issues* GitHub (ou des tâches beads, si adoptées) — pas dans un fichier Markdown.

## Support

Pour toute question, contactez l'équipe d'organisation de La Bédaine.
