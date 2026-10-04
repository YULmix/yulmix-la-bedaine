import { createContext, useContext } from 'react';

// Who is in the admin, as the admin shell (src/views/AdminView.jsx) decided it (#217, ADR 0023):
//   role:    their role on the active event ('committee' | 'organiser' | 'admin'), what the
//            sections show and allow (can() in src/lib/editionRoles.ts);
//   isAdmin: an admin's account, on every edition;
//   roles:   their edition roles by event id, for the screens that pick an edition.
// The database enforces the same; this only decides what is on screen.
export const AdminAccessContext = createContext({ role: null, isAdmin: false, roles: {} });

export const useAdminAccess = () => useContext(AdminAccessContext);
