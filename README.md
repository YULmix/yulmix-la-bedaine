# La Bédaine - React SPA

Une application React moderne pour la gestion d'événements, construite avec Vite, Tailwind CSS v4, et Supabase.

## Fonctionnalités

- 🔐 Authentification avec Google et Facebook via Supabase OAuth
- 📱 Interface responsive adaptée aux mobiles
- 🇫🇷 Interface utilisateur entièrement en français (fr-CA)
- 🎯 Composants réutilisables avec localisation centralisée
- 📅 Modal de détails d'événements avec informations complètes
- 🎨 Design moderne avec Tailwind CSS v4

## Structure du projet

```
.
├── src/
│   ├── components/     # Composants React réutilisables
│   │   ├── Header.jsx  # En-tête avec navigation et authentification
│   │   └── EventModal.jsx # Modal de détails d'événements
│   ├── lib/
│   │   └── supabase.js # Client Supabase configuré
│   ├── locales/
│   │   └── fr.json     # Dictionnaire de localisation français
│   ├── App.jsx         # Composant principal de l'application
│   ├── main.jsx        # Point d'entrée React
│   └── index.css       # Styles Tailwind CSS
├── vite.config.js      # Configuration Vite avec Tailwind CSS v4
├── .env.example        # Variables d'environnement exemple
└── package.json        # Dépendances et scripts
```

## Configuration requise

- Node.js 18+ 
- npm 9+

## Installation

1. Cloner le dépôt
```bash
git clone <repository-url>
cd yulmix-app-bedaine
```

2. Installer les dépendances
```bash
npm install
```

3. Configurer les variables d'environnement
```bash
cp .env.example .env
```
Remplir les valeurs dans `.env`:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

4. Lancer l'application en mode développement
```bash
npm run dev
```

5. Construire pour la production
```bash
npm run build
```

## Technologies utilisées

- **React 19** - Bibliothèque UI
- **Vite** - Build tool et serveur de développement
- **Tailwind CSS v4** - Framework CSS utility-first
- **Lucide React** - Icônes
- **Supabase JS SDK** - Authentification et base de données
- **React Router DOM** - Navigation client-side

## Localisation

Tous les textes de l'interface utilisateur sont centralisés dans `src/locales/fr.json`. Pour ajouter ou modifier des textes :

1. Ajouter une nouvelle clé dans `fr.json` :
```json
"maNouvelleCle": "Mon texte en français"
```

2. Utiliser dans un composant :
```jsx
import fr from './locales/fr.json';
// ...
<p>{fr.maNouvelleCle}</p>
```

## Authentification

L'application utilise Supabase pour l'authentification OAuth avec :
- Connexion avec Google
- Connexion avec Facebook

Les boutons d'authentification sont disponibles dans le menu déroulant de l'en-tête.

## Composants principaux

### Header
- Titre cliquable redirigeant vers l'accueil
- Menu d'authentification avec options Google/Facebook
- Design responsive avec menu mobile

### EventModal
- Affiche les détails complets d'un événement
- Informations sur le lieu, dates, contact, instructions
- Boutons d'action (s'inscrire, partager, directions)

## Scripts disponibles

- `npm run dev` - Lance le serveur de développement
- `npm run build` - Construit l'application pour la production
- `npm run preview` - Prévisualise la build de production

## Conventions de code

- Tous les noms de fichiers en anglais
- Tous les textes UI en français (fr-CA)
- Utilisation de composants fonctionnels React avec hooks
- Styling avec classes Tailwind CSS
- Import des traductions depuis le dictionnaire centralisé

## Support

Pour toute question ou problème, veuillez contacter l'équipe de développement.
