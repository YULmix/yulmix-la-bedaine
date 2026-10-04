import { createContext, useContext } from 'react';

// « Voir comme » (#267): what the impersonated tab's shell (src/components/VoirCommeTab.jsx) tells
// the app it runs, null in every ordinary tab:
//   targetName: whose session this is, for the banner;
//   endsAt:     when it ends (ISO), for the banner's countdown;
//   quit():     « Quitter », ending the session (the header's « Se déconnecter » in that tab);
//   quitting:   « Quitter » is running.
export const VoirCommeContext = createContext(null);

export const useVoirComme = () => useContext(VoirCommeContext);
