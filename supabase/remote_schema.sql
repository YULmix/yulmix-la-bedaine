object_type,entity_name,details
FUNCTION,admin_set_is_admin,"target_user_id uuid, new_is_admin boolean"
FUNCTION,enforce_capacity_and_waitlist,
FUNCTION,handle_new_user,
FUNCTION,increment_edit_count,
FUNCTION,is_admin,
FUNCTION,log_registration_edit,
FUNCTION,prevent_event_deletion,
FUNCTION,prevent_self_privilege_escalation,
FUNCTION,protect_root_admin,
FUNCTION,update_attendee_counts,
RLS_POLICY,app_feedback,App Feedback: Admins can delete feedback [DELETE]
RLS_POLICY,app_feedback,App Feedback: Users can insert own feedback [INSERT]
RLS_POLICY,app_feedback,App Feedback: Users can read own feedback [SELECT]
RLS_POLICY,app_feedback,App Feedback: Users can update own feedback [UPDATE]
RLS_POLICY,events,Events: Admin full access [ALL]
RLS_POLICY,events,Events: Public read active/archived [SELECT]
RLS_POLICY,profiles,Profiles: User can read own profile [SELECT]
RLS_POLICY,profiles,Profiles: User can update own profile [UPDATE]
RLS_POLICY,profiles,Profiles: Users can insert own profile [INSERT]
RLS_POLICY,registration_edits,Registration Edits: System can insert edit records [INSERT]
RLS_POLICY,registration_edits,Registration Edits: Users can see their own edit history [SELECT]
RLS_POLICY,user_parties,User Parties: User can create own registrations [INSERT]
RLS_POLICY,user_parties,User Parties: User can delete own registrations [DELETE]
RLS_POLICY,user_parties,User Parties: User can read own registrations [SELECT]
RLS_POLICY,user_parties,User Parties: User can update own registrations [UPDATE]
TABLE_COLUMN,app_feedback,content (text NOT NULL)
TABLE_COLUMN,app_feedback,created_at (timestamp with time zone)
TABLE_COLUMN,app_feedback,id (uuid NOT NULL)
TABLE_COLUMN,app_feedback,is_resolved (boolean)
TABLE_COLUMN,app_feedback,resolved_at (timestamp with time zone)
TABLE_COLUMN,app_feedback,screenshot_url (text)
TABLE_COLUMN,app_feedback,user_id (uuid)
TABLE_COLUMN,events,cost_breakdown (jsonb)
TABLE_COLUMN,events,created_at (timestamp with time zone)
TABLE_COLUMN,events,description (text)
TABLE_COLUMN,events,duration_days (integer)
TABLE_COLUMN,events,estimated_individual_cost_whole_event (numeric)
TABLE_COLUMN,events,expense_category (text)
TABLE_COLUMN,events,external_links (jsonb)
TABLE_COLUMN,events,id (uuid NOT NULL)
TABLE_COLUMN,events,instructions (text)
TABLE_COLUMN,events,is_active (boolean)
TABLE_COLUMN,events,is_reg_open (boolean)
TABLE_COLUMN,events,max_attendees (integer)
TABLE_COLUMN,events,points_of_contact (text)
TABLE_COLUMN,events,reg_start_date (date)
TABLE_COLUMN,events,selling_price_whole_event (numeric)
TABLE_COLUMN,events,status (text)
TABLE_COLUMN,events,theme (text NOT NULL)
TABLE_COLUMN,events,total_cost (numeric)
TABLE_COLUMN,events,venue_address (text)
TABLE_COLUMN,events,x_reg_close_weeks (integer)
TABLE_COLUMN,events,z_intent_months (integer)
TABLE_COLUMN,profiles,created_at (timestamp with time zone)
TABLE_COLUMN,profiles,email (text NOT NULL)
TABLE_COLUMN,profiles,full_name (text)
TABLE_COLUMN,profiles,id (uuid NOT NULL)
TABLE_COLUMN,profiles,is_admin (boolean)
TABLE_COLUMN,registration_edits,changes (jsonb)
TABLE_COLUMN,registration_edits,edited_at (timestamp with time zone)
TABLE_COLUMN,registration_edits,edited_by (uuid)
TABLE_COLUMN,registration_edits,id (uuid NOT NULL)
TABLE_COLUMN,registration_edits,registration_id (uuid NOT NULL)
TABLE_COLUMN,registration_summary_view,attendees (jsonb)
TABLE_COLUMN,registration_summary_view,calculated_amount_owed (numeric)
TABLE_COLUMN,registration_summary_view,edit_count (integer)
TABLE_COLUMN,registration_summary_view,event_id (uuid)
TABLE_COLUMN,registration_summary_view,id (uuid)
TABLE_COLUMN,registration_summary_view,is_waitlisted (boolean)
TABLE_COLUMN,registration_summary_view,last_edited_at (timestamp with time zone)
TABLE_COLUMN,registration_summary_view,logistics (jsonb)
TABLE_COLUMN,registration_summary_view,message_to_organizers (text)
TABLE_COLUMN,registration_summary_view,music_requests (text)
TABLE_COLUMN,registration_summary_view,payment_status (text)
TABLE_COLUMN,registration_summary_view,status (text)
TABLE_COLUMN,registration_summary_view,transport (jsonb)
TABLE_COLUMN,user_event_history,attendees (jsonb)
TABLE_COLUMN,user_event_history,calculated_amount_owed (numeric)
TABLE_COLUMN,user_event_history,counts (jsonb)
TABLE_COLUMN,user_event_history,email (text)
TABLE_COLUMN,user_event_history,event_id (uuid)
TABLE_COLUMN,user_event_history,event_theme (text)
TABLE_COLUMN,user_event_history,full_name (text)
TABLE_COLUMN,user_event_history,is_waitlisted (boolean)
TABLE_COLUMN,user_event_history,party_id (uuid)
TABLE_COLUMN,user_event_history,payment_status (text)
TABLE_COLUMN,user_event_history,reg_start_date (date)
TABLE_COLUMN,user_event_history,registration_date (timestamp with time zone)
TABLE_COLUMN,user_event_history,registration_status (text)
TABLE_COLUMN,user_event_history,user_id (uuid)
TABLE_COLUMN,user_parties,admin_notes (text)
TABLE_COLUMN,user_parties,attendees (jsonb NOT NULL)
TABLE_COLUMN,user_parties,calculated_amount_owed (numeric)
TABLE_COLUMN,user_parties,confirmation_message (text)
TABLE_COLUMN,user_parties,counts (jsonb NOT NULL)
TABLE_COLUMN,user_parties,created_at (timestamp with time zone)
TABLE_COLUMN,user_parties,edit_count (integer)
TABLE_COLUMN,user_parties,event_id (uuid NOT NULL)
TABLE_COLUMN,user_parties,id (uuid NOT NULL)
TABLE_COLUMN,user_parties,is_waitlisted (boolean)