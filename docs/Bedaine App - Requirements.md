# **“Bedaine App”: La Bédaine**

Phase 1 (Scaffolding & Auth) ↳   
Phase 2 (Database Schema & RLS) ↳   
Phase 3 (Core Pricing Engine) ↳   
Phase 4 (User Registration Flow) ↳   
Phase 5 (Admin Dashboard & Mutex) ↳   
Phase 6 (Feedback, Polish & Vercel Prep) 

# **1\. Project Scaffolding, Tailwind v4 & Layout Shell**

## **Prompt 1**

Scaffold a React SPA using Vite, Tailwind CSS v4, and Lucide React in the current folder. 

Requirements:  
1\. Configure vite.config.js with '@tailwindcss/vite'. Ensure src/index.css uses '@import "tailwindcss";'.  
2\. Configure src/lib/supabase.js using import.meta.env.VITE\_SUPABASE\_URL and import.meta.env.VITE\_SUPABASE\_ANON\_KEY.  
3\. Create a .env.example file containing:  
   VITE\_SUPABASE\_URL=  
   VITE\_SUPABASE\_ANON\_KEY=  
4\. Create a shared Header component with the title 'La Bédaine'.   
\- Clicking the event title in the header must route to the Home view. Include an auth dropdown with Google and Facebook OAuth sign-in triggers (ensuring Supabase client auth flow handles WebAuthn/passkey fallbacks cleanly without redirect loops), plus sign-out. Make sure they are labelled in french: “Connexion avec Facebook”, “Connexion avec Google" and "Se déconnecter"   
\- clicking the active event card or title on the user Home dashboard must open a dedicated modal or sub-view showing full event details (description, venue address, dates, points of contact, and instructions).  
5\. Create an App Shell layout with a clean mobile-responsive layout. All user-facing text must be in French (fr-CA).  
6\. Run 'npm run build' to verify everything compiles cleanly without warnings.  
7\. create a centralized dictionary file (src/locales/fr.json).  Centralize all UI strings, table headers, error notices, and enum translations into the centralized dictionary file  in French (fr-CA). Components must pull their text from this dictionary rather than hardcoding raw strings in JSX.

# **2\. Database Architecture, Triggers & RLS**

## **Prompt 2**

Generate a comprehensive PostgreSQL schema file and save it to supabase/schema.sql.

Schema specifications:

**1\. profiles table:**

* id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE  
* email TEXT NOT NULL UNIQUE  
* full\_name TEXT  
* is\_admin BOOLEAN DEFAULT FALSE  
* created\_at TIMESTAMPTZ DEFAULT now()  
* Root admin rule: Set is\_admin \= TRUE automatically if email \= 'yulmixalabedaine@gmail.com'.  
* Add an automated trigger on auth.users insert to populate this table immediately upon account creation, extracting display name metadata where available.

**2\. events table:**

* id UUID PRIMARY KEY DEFAULT gen\_random\_uuid()  
* theme TEXT NOT NULL  
* description TEXT  
* venue\_address TEXT  
* duration\_days INT DEFAULT 2  
* points\_of\_contact TEXT DEFAULT 'Registration (Simon), Volunteering (Dave), Food/Special Activities (Melina / MC / Gary), Neighbors / Parking (Khaled), Pharma / First Aid / Bed Assignments (Mach)'  
* z\_intent\_months INT DEFAULT 2  
* x\_reg\_close\_weeks INT DEFAULT 1  
* reg\_start\_date DATE DEFAULT '2026-05-01'  
* status TEXT CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')) DEFAULT 'DRAFT'  
* is\_active BOOLEAN DEFAULT FALSE  
* is\_reg\_open BOOLEAN DEFAULT FALSE  
* total\_cost NUMERIC(10,2) DEFAULT 0.00  
* cost\_breakdown JSONB DEFAULT '\[\]'::jsonb  
* expense\_category TEXT CHECK (expense\_category IN ('Chalet', 'Food', 'Music', 'Tech', 'Accessories'))  
* selling\_price\_whole\_event NUMERIC(10,2) DEFAULT 0.00  
* estimated\_individual\_cost\_whole\_event NUMERIC(10,2) DEFAULT 0.00  
* max\_attendees INT DEFAULT 90  
* external\_links JSONB DEFAULT '\[\]'::jsonb (must support custom labels and links, including "Liste d'achats")  
* instructions TEXT  
* created\_at TIMESTAMPTZ DEFAULT now()  
* Deletion constraint: Enforce a strict "No Delete Method" rule or trigger on this table so records can be archived but never removed.  
* Mutex constraint: Add a conditional unique constraint or partial index on is\_active (WHERE is\_active \= TRUE) ensuring no two events can ever be active at the same time.

**3\. user\_parties table:**

* id UUID PRIMARY KEY DEFAULT gen\_random\_uuid()  
* user\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE  
* event\_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE  
* attendees JSONB NOT NULL DEFAULT '\[\]'::jsonb  
  *(Array of objects: \[{"name": "...", "tier": "adult\_whole" | "adult\_main" | "teen\_whole" | "teen\_main" | "kids", "is\_new\_member": boolean}\])*  
  counts JSONB NOT NULL DEFAULT '{"adult\_whole":0,"adult\_main":0,"teen\_whole":0,"teen\_main":0,"kids":0}'::jsonb *(Auto-computed on insert/update from attendees)*  
* logistics JSONB NOT NULL DEFAULT '{"sleeping":{"pref":"","reason":"","assigned":""},"food\_requests":{"requests":"","notes":""},"volunteering":\[\]}'::jsonb  
* transport JSONB NOT NULL DEFAULT '{"type":"None","seats":0,"arrival":"","departure":""}'::jsonb  
* music\_requests TEXT  
* message\_to\_organizers TEXT  
* confirmation\_message TEXT  
* status TEXT DEFAULT 'Enregistré'  
* calculated\_amount\_owed NUMERIC(10,2) DEFAULT 0.00  
* payment\_status TEXT CHECK (payment\_status IN ('Impayé', 'Payé')) DEFAULT 'Impayé'  
* is\_waitlisted BOOLEAN DEFAULT FALSE  
* admin\_notes TEXT (private notes reserved for organizers)  
* created\_at TIMESTAMPTZ DEFAULT now()  
* Constraint: UNIQUE(user\_id, event\_id)

**4\. app\_feedback table:**

* id UUID PRIMARY KEY DEFAULT gen\_random\_uuid()  
* user\_id UUID REFERENCES profiles(id) ON DELETE SET NULL  
* content TEXT NOT NULL  
* screenshot\_url TEXT  
* is\_resolved BOOLEAN DEFAULT FALSE  
* created\_at TIMESTAMPTZ DEFAULT now()  
* resolved\_at TIMESTAMPTZ

**5\. Views & Relational History:**

* Create a dedicated view user\_event\_history joining profiles, user\_parties, and events so the Admin User List can drill down into any user's past registrations, balances, and participation history on click.


## **Prompt 3**

Add to the schema file and save it to supabase/schema.sql.

**6\. Row Level Security (RLS):**

* Enable RLS across profiles, events, user\_parties, and app\_feedback.  
* Define a secure, non-recursive helper function (is\_admin()) checking whether auth.uid() matches an admin profile or yulmixalabedaine@gmail.com.  
* profiles: Users can view and edit their own record; admins have full read/write access.  
* events: Authenticated and public users can read ACTIVE and ARCHIVED events; DRAFT events are visible exclusively to admins; only admins have insert/update permissions.  
* user\_parties: Users can read, create, and modify their own registration; admins have unrestricted access.  
* app\_feedback: Authenticated users can insert records and read their own submissions; admins have full triage permissions.

Write clear, safe PostgreSQL migrations with IF NOT EXISTS checks.

# **3\. Pure Pricing Engine & Unit Verification** 

## **Prompt 4**

Create a modular pricing calculation utility in 'src/lib/pricingEngine.js'.

Implement these exact business rules:  
1\. Weighting scale:  
   \- Adult (Whole Event): 2.0 pts  
   \- Adult (Main Event): 1.5 pts  
   \- Teenager (Whole Event): 1.0 pt  
   \- Teenager (Main Event): 0.5 pts  
   \- Kids / After-Party: 0.0 pts

2\. Base unit price calculation:  
   \- Formula: Contingency Cost \= Total Event Cost \* 1.20  
\- this is the internal **estimated base cost per point/attendee**, serving as a break-even metric for organizers.   
   \- Base Price per Point \= Contingency Cost / Total Points across all attendees.   
\- include an explicit zero-point guard clauses that return a base price of zero CAD   
   \- Rounding constraint: The computed Base Price per Point must ALWAYS round UP to the nearest multiple of ten CAD (e.g., $71 \-\> $80, $70.01 \-\> $80, $70.00 \-\> $70).

3\. Individual Attendee Costing:

\- For each person in attendees:

\- If is\_new\_member is false: Base Points \= Tier Points (Adult Whole \= 2.0, Adult Main \= 1.5, Teen Whole \= 1.0, Teen Main \= 0.5, Kids \= 0.0). Individual Cost \= Base Points \* Base Price per Point.

\- If is\_new\_member is true: Points default to Main Event equivalent (Adult Whole becomes 1.5, Teen Whole becomes 0.5; Adult Main remains 1.5, Teen Main remains 0.5; Kids remain 0.0). Individual Cost \= (Points \* Base Price per Point) \* 0.70.

\- Sum all individual attendee costs to determine total calculated\_amount\_owed. It must derive strictly from the admin-maintained **selling price** (and its relative tier discounts), rather than fluctuating automatically whenever attendees join or leave   
\- It’s important to distinguish the base cost from the selling price of an event, they are not related. The selling price is maintained by an admin, the base cost is an estimation of the event’s cost. The base cost isn’t visible to attendees.

4\. Grandfathering Check:  
   \- If party is\_paid is TRUE, preserve their historical calculated\_amount\_owed regardless of global total\_cost adjustments.

5\. Export a scenario simulation function 'simulateEventPricing(attendeeParties, totalCost, priceOverride)' that runs test calculations without modifying state.

Write an automated verification script 'src/lib/pricingEngine.test.js' containing 4 edge cases (including zero points, single adult, fractional new members, and nearest-ten rounding). Run 'node src/lib/pricingEngine.test.js' to verify the logic.

# **4\. User Registration Flow (User Party Engine)**

## **Prompt 5**

Build the user registration flow in 'src/components/RegistrationForm.jsx' and integrate it into 'src/views/HomeView.jsx'.

UI & Functional requirements (fr-CA):  
1\. Home View state:  
   \- If no event is ACTIVE, display: "Aucun événement en cours".  
   \- If an event is in Intent Phase (current date between reg\_start\_date \- z\_intent\_months and reg\_start\_date), display banner: "Indiquez votre intention de participer et la composition de votre groupe pour aider à la planification."  
   \- If registered: Display registration status, waitlist status, and Amount Owed ("Montant dû : XX,XX $ CAD"). Do NOT show a redundant "Votre Inscription" box.  
   \- If pending payment, display alert: "Envoyez votre virement Interac à \[admin\_email\]"  
\- Include a dedicated link to the "Liste d'achats" under event resources.

2\. Registration Form ('User Party'):

\- Participant details: Dynamic attendee builder where each row contains:

- Text input for full name (name).  
- Tier selector (tier: "Adulte \- Fin de semaine complète", "Adulte \- Événement principal", "Ado \- Fin de semaine complète", "Ado \- Événement principal", "Enfant").  
- Checkbox for new member status (is\_new\_member: \[ \] Nouveau membre).  
- Auto-calculate and display total party points and estimated balance dynamically as rows are added or edited.

## **Prompt 6**

Continue the Registration Form ('User Party'):

   \- Granular Logistics: Per-individual selector for Accommodation (Camping, Plancher, Lit, Sofa) and Food requirements, with a "Même chose pour tout le monde" master toggle.  
\- Logistics structure: Ensure the accommodation selector stores { pref, reason, assigned } where assigned remains reserved for admin modification.  
   \- If "Bed" is selected, require reason selection: "Santé", "Jeunes enfants", or "Confort".  
   \- Volunteering: Multi-select checkboxes (Achat nourriture, Cuisiner un repas, DJ après-midi, DJ soirée, Montage vendredi, Ménage dimanche, Gestion voisinage, Stationnement, Initiative artistique/spéciale, Pharmacie, Autre).  
   \- Logistics notice: Display disclaimer: "Les chambres peuvent être partagées avec d'autres personnes, il n'y a pas de chambres privées."  
   \- Food notice: Display: "Les repas sont inclus, nous tentons d'accommoder les vég. mais si vous avez des besoins uniques, considérez complémenter votre alimentation".  
   \- Transport: Type ('Offre' or 'Besoin'), seat count, arrival and departure time text.  
   \- Music requests: 3-line textarea.  
\- Message to Organizers: 3-line textarea.  
   \- Action buttons: "Sauvegarder", "Annuler", "Se désinscrire". Then the records is marked as Cancelled, not deleted.  
\- place individual logistics (sleeping preference, dietary needs, bed reasons) inside each object within the attendees array, keeping the top-level logistics field strictly for party-wide details like transport.

3\. Capacity checks:  
   \- If active event registrations exceed max\_attendees, do NOT block submission. Set is\_waitlisted to TRUE and display message: "L'événement est malheureusement complet, mais vous serez ajouté à la liste d'attente."

4\. Pop-up messages:  
   \- All toast messages and alerts must auto-dismiss after 5 seconds or close manually via an "X" button.

# **5\. Admin Controls, Mutex & God-Mode**

## **Prompt 7**

Build the Admin Dashboard at 'src/views/AdminView.jsx' with administrative controls.

Features:  
**1\. Activation Mutex:** Validate both in the UI state and catch database constraint errors from one\_active\_event\_idx with: *"Un événement est déjà actif. Veuillez l'archiver avant d'en activer un nouveau."*

2\. Real-time Aggregate Dashboard:  
   \- Display aggregate totals for all attendee tiers (adults, teens, kids).  
   \- Display breakdown counts for sleeping options and dietary/food preferences.  
   \- Allow editing event metadata inline (theme, total\_cost, duration\_days, points\_of\_contact, dates).

3\. Admin User & Party Management:  
   \- Render user table with columns: User Name, Email, Admin Checkbox (toggle updates profile directly), Payment Status inline toggle ('Payé' / 'Impayé'). Display these fields in french: "Nom", "Courriel", and "Statut de paiement".  
\- God-Mode editing: Clicking any user party opens the full RegistrationForm pre-filled with the exact attendees array, enabling admins to modify names, switch individual attendee tiers, or toggle the is\_new\_member checkbox per attendee on their behalf.

## **Prompt 8**

Admin User & Party Management continued:  
   \- Dedicated Logistics View: Admin panel to assign official sleeping spots and save private internal admin\_notes.  
\- Clicking a User Name must open a slide-over/modal showing their full profile and cumulative **event history** across all past events.  
\- In the Dedicated Logistics View, add an assignment interface allowing admins to write directly to logistics.sleeping.assigned.  
\- admins can update and format points\_of\_contact and instructions directly via a rich text/multi-line text field in the metadata manager.  
\- display “Coût de revient estimé par participant" vs. "Prix de vente fixé” side by side 

4\. Scenario Simulator:  
   \- Provide an admin sandbox where the admin inputs mock attendee numbers and cost overrides to see real-time price-per-point calculations using 'simulateEventPricing'.

5\. Data Export:  
   \- Add a button to export all registered attendees, counts, logistics, and balance totals to a CSV file as well as clipboard/formatted copy compatible with direct pasting into Google Sheets, or integrate Google Sheets API/OAuth export. 

# **6\. Feedback Module, Account Deletion & Production Build**

## **Prompt 9**

Finalize system feedback, account deletion options, and production optimizations.

Tasks:  
1\. Feedback Modal:  
   \- Create a floating "Commentaires / App Feedback" module.  
   \- Support rich text input and clipboard image paste (convert pasted images to base64 or upload to Supabase storage bucket 'feedback').  
   \- In the Admin Dashboard, allow admins to toggle feedback status as 'Resolved'.  
   \- When feedback is marked resolved, trigger a dismissible global banner across all user home screens: "Des ajustements ont été apportés à l'application. Veuillez rafraîchir la page."  
\- Store dismissal state in localStorage keyed by feedback update timestamp so the banner displays **only once** per resolution cycle. 

2\. Account Deletion:  
   \- Add an explicit "Supprimer mon compte" button in the user profile menu.  
   \- Prompt confirmation before invoking Supabase client account deletion and removing user records.

~~3\. Reinforce Architecture:~~

- ~~restrict updates so users cannot modify their own is\_admin column, or explicitly separate administrative roles into a dedicated table.~~   
- ~~enforce capacity and waitlist checks inside a database trigger or transactional function during insertion.~~   
- ~~enforce capacity and waitlist checks inside a database trigger or transactional function during insertion~~   
- ~~offer a confirmation modal in the admin UI that archives the currently active event and activates the new one in a single step.~~   
- ~~return $0.00 for the estimated base cost when registrations total zero points, avoiding runtime crashes on newly drafted events.~~   
- ~~Generic form actions such as loading states ("Saving...", "Deleting..."), empty state fallbacks ("No records found"), and confirmation dialogs ("Are you sure?") need to be translated to French.~~

~~4\. Clean up & Verification:~~  
   ~~\- Ensure all console errors, broken hooks, and missing Tailwind utility warnings are fixed.~~  
   ~~\- Run 'npm run build' and confirm the Vite production build succeeds.~~

Updated  
3\. Reinforce Architecture:

- restrict updates so users cannot modify their own is\_admin column, or explicitly separate administrative roles into a dedicated table.   
- enforce capacity and waitlist checks inside a database trigger or transactional function during insertion. Provide the sql to update the database if necessary.  
- enforce capacity and waitlist checks inside a database trigger or transactional function during insertion. Provide the sql to update the database if necessary.  
- return $0.00 for the estimated base cost when registrations total zero points, avoiding runtime crashes on newly drafted events. 

4\. Clean up & Verification:  
   \- Ensure all console errors, broken hooks, and missing Tailwind utility warnings are fixed.  
   \- Run 'npm run build' and confirm the Vite production build succeeds.

\_\_

# **Bédaine info**

Messages todo  
messenger: bouffe: équipe étendue avec Susa, gary, melina  
48 lits : floor plans. Lits

intention 2 mois pour calculer le prix  
prix 1 mois avant  
paiements in 1 semaine avant max

décors german sparkle party. 

MÃ©tadonnÃ©es de l\\'Ã©vÃ©nement  
Ã

Ã‰vÃ©nement  
archivÃ©

Ã‰d  
Ã©  
✕ 

> The **Fixes TODO**, **Backlog**, and **Investigation TODO** sections that used to live here have
> been filed as GitHub Issues instead (#22, #30–45) — see
> [Contributing → Tracking work](./08-contributing.md#tracking-work). This file stays a historical
> record of intent; don't append new work items to it.

\_\_\_

# **Done Issues**

### 

### Entity

public.user\_event\_history

### Issue

View public.user\_event\_history is defined with the SECURITY DEFINER property

### Description

Detects views defined with the SECURITY DEFINER property. These views enforce Postgres permissions and row level security policies (RLS) of the view creator, rather than that of the querying user

\_\_\_

**Selling Price**

Please fix the user party pricing calculation in 'src/lib/pricingEngine.js' and wherever party dues are computed (such as 'src/components/RegistrationForm.jsx' or 'src/views/HomeView.jsx'):

1\. Problem:  
The user party's amount due (\`calculated\_amount\_owed\`) is currently calculated from \`total\_cost\` (the overall event cost). This is incorrect. \`total\_cost\` should only be used for the internal estimated break-even cost.

2\. Required Business Logic:  
\- Base Unit Price Baseline:  
  The baseline for attendee pricing must strictly be \`events.selling\_price\_whole\_event\` (set by the admin).  
\- Point-to-Baseline Mapping:  
  An Adult attending the Whole Event has a weight of 2.0 points and must pay exactly \`selling\_price\_whole\_event\`.  
  Therefore:  
  \`price\_per\_point \= selling\_price\_whole\_event / 2.0\`  
\- Weighted Tier Pricing:  
  Every attendee's price is calculated based on their tier weight relative to that unit rate:  
  \- Adult (Whole Event): 2.0 pts \-\> 100% of selling\_price\_whole\_event  
  \- Adult (Main Event): 1.5 pts \-\> (1.5 \* price\_per\_point) \= 75% of selling\_price\_whole\_event  
  \- Teenager (Whole Event): 1.0 pt \-\> (1.0 \* price\_per\_point) \= 50% of selling\_price\_whole\_event  
  \- Teenager (Main Event): 0.5 pts \-\> (0.5 \* price\_per\_point) \= 25% of selling\_price\_whole\_event  
  \- Kids / After-Party: 0.0 pts \-\> 0.00 $ CAD  
\- New Member Rule:  
  If \`is\_new\_member\` is true for an attendee, apply the existing business rule:  
  Default points to Main Event equivalent (Adult Whole becomes 1.5 pts, Teen Whole becomes 0.5 pts; Adult Main remains 1.5 pts, Teen Main remains 0.5 pts), then apply the 30% reduction:  
  \`attendee\_cost \= (points \* price\_per\_point) \* 0.70\`  
\- Party Total:  
  Sum all individual attendee costs to get the total \`calculated\_amount\_owed\`.

3\. Tasks:  
\- Inspect 'src/lib/pricingEngine.js' using \`read\_file\`.  
\- Refactor the party balance calculation function to accept \`selling\_price\_whole\_event\` instead of \`total\_cost\`.  
\- Update 'src/lib/pricingEngine.test.js' to match this logic and verify all unit tests pass with \`node src/lib/pricingEngine.test.js\`.  
\- Update the registration form calculation and submission handlers so saved records in \`public.user\_parties\` store the correct \`calculated\_amount\_owed\`.  
\- Run \`npm run build\` to verify compilation.

