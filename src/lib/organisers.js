// The organisers' inbox: where members send their Interac transfer. The same address is the
// reply-to and Interac recipient in supabase/functions/send-party-email/index.ts, which can't
// import from src/, so keep the two in step.
export const ORGANISERS_EMAIL = 'yulmixalabedaine@gmail.com';
