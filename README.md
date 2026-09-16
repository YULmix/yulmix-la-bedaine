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

### Configuration Supabase OAuth

Pour que l'authentification OAuth fonctionne en production, vous devez configurer les URLs de redirection dans le tableau de bord Supabase :

1. Accédez à **Authentication > URL Configuration** dans votre projet Supabase
2. Ajoutez les URLs de redirection suivantes :
   - URL de développement : `http://localhost:5173`
   - URL de production : `https://votre-domaine.com`
3. Assurez-vous que les fournisseurs OAuth (Google, Facebook) sont activés et configurés

L'application utilise `redirectTo: window.location.origin` pour gérer le retour OAuth.
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

## Déploiement

L'application est prête pour le déploiement sur Vercel, Netlify, ou toute autre plateforme prenant en charge les SPAs React.

### Vercel
1. Poussez le code sur GitHub, GitLab ou Bitbucket
2. Connectez votre dépôt à Vercel
3. Configurez les variables d'environnement :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Vercel détectera automatiquement le projet Vite et configurera les réécritures SPA

### Netlify
1. Poussez le code sur votre dépôt Git
2. Créez un nouveau site sur Netlify et connectez votre dépôt
3. Configurez les variables d'environnement dans les paramètres du site
4. Netlify utilisera automatiquement le fichier `netlify.toml` pour la configuration

### Variables d'environnement de production
Assurez-vous de configurer les mêmes variables d'environnement que en développement :
- `VITE_SUPABASE_URL` - URL de votre projet Supabase
- `VITE_SUPABASE_ANON_KEY` - Clé anonyme Supabase

### Configuration SPA
Pour le routage côté client, assurez-vous que toutes les routes redirigent vers `index.html`. Les fichiers `vercel.json` et `netlify.toml` inclus configurent déjà ces redirections.
## Support

Pour toute question ou problème, veuillez contacter l'équipe de développement.
