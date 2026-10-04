export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_feedback: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_resolved: boolean | null
          resolved_at: string | null
          screenshot_url: string | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          resolved_at?: string | null
          screenshot_url?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          resolved_at?: string | null
          screenshot_url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["user_id"]
          },
        ]
      }
      attendees: {
        Row: {
          bed_reason: string
          bed_reason_other: string
          created_at: string
          dietary_needs: string[]
          dietary_other: string
          id: string
          is_new_member: boolean
          name: string
          participation: string
          party_id: string
          position: number
          sleeping_preference: string
          sleeping_preference_other: string
          type: string
        }
        Insert: {
          bed_reason?: string
          bed_reason_other?: string
          created_at?: string
          dietary_needs?: string[]
          dietary_other?: string
          id?: string
          is_new_member?: boolean
          name: string
          participation: string
          party_id: string
          position: number
          sleeping_preference?: string
          sleeping_preference_other?: string
          type: string
        }
        Update: {
          bed_reason?: string
          bed_reason_other?: string
          created_at?: string
          dietary_needs?: string[]
          dietary_other?: string
          id?: string
          is_new_member?: boolean
          name?: string
          participation?: string
          party_id?: string
          position?: number
          sleeping_preference?: string
          sleeping_preference_other?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendees_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "attendees_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "user_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          created_at: string
          error: string | null
          id: string
          party_id: string
          recipient: string | null
          resend_id: string | null
          status: string
          template: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          party_id: string
          recipient?: string | null
          resend_id?: string | null
          status?: string
          template: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          party_id?: string
          recipient?: string | null
          resend_id?: string | null
          status?: string
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "email_log_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "user_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      event_budgets: {
        Row: {
          contingency_pct: number
          event_id: string
          lines: Json
          total_cost: number
          updated_at: string
        }
        Insert: {
          contingency_pct?: number
          event_id: string
          lines?: Json
          total_cost?: number
          updated_at?: string
        }
        Update: {
          contingency_pct?: number
          event_id?: string
          lines?: Json
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_budgets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_budgets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "user_event_history"
            referencedColumns: ["event_id"]
          },
        ]
      }
      event_place_overrides: {
        Row: {
          capacity: number | null
          created_at: string
          event_id: string
          is_excluded: boolean
          place_id: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          event_id: string
          is_excluded?: boolean
          place_id: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          event_id?: string
          is_excluded?: boolean
          place_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_place_overrides_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_place_overrides_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_place_overrides_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "attendee_places"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "event_place_overrides_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string | null
          description: string | null
          duration_days: number | null
          event_start_date: string | null
          external_links: Json | null
          id: string
          instructions: string | null
          is_active: boolean | null
          is_reg_open: boolean | null
          max_attendees: number | null
          points_of_contact: string | null
          ratio_main_whole: number
          reg_start_date: string | null
          selling_price_whole_event: number | null
          status: string | null
          theme: string
          venue_id: string | null
          x_reg_close_weeks: number | null
          z_intent_months: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          duration_days?: number | null
          event_start_date?: string | null
          external_links?: Json | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          is_reg_open?: boolean | null
          max_attendees?: number | null
          points_of_contact?: string | null
          ratio_main_whole?: number
          reg_start_date?: string | null
          selling_price_whole_event?: number | null
          status?: string | null
          theme: string
          venue_id?: string | null
          x_reg_close_weeks?: number | null
          z_intent_months?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          duration_days?: number | null
          event_start_date?: string | null
          external_links?: Json | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          is_reg_open?: boolean | null
          max_attendees?: number | null
          points_of_contact?: string | null
          ratio_main_whole?: number
          reg_start_date?: string | null
          selling_price_whole_event?: number | null
          status?: string | null
          theme?: string
          venue_id?: string | null
          x_reg_close_weeks?: number | null
          z_intent_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      galleries: {
        Row: {
          created_at: string
          id: string
          kind: string | null
          location_id: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string | null
          location_id?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string | null
          location_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "galleries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "attendee_places"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "galleries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "galleries_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_images: {
        Row: {
          created_at: string
          gallery_id: string
          id: string
          path: string
          position: number
        }
        Insert: {
          created_at?: string
          gallery_id: string
          id?: string
          path: string
          position: number
        }
        Update: {
          created_at?: string
          gallery_id?: string
          id?: string
          path?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "gallery_images_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          created_at: string
          id: string
          name: string
          note: string | null
          sort_order: number
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          note?: string | null
          sort_order?: number
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      party_admin_notes: {
        Row: {
          notes: string | null
          party_id: string
          updated_at: string
        }
        Insert: {
          notes?: string | null
          party_id: string
          updated_at?: string
        }
        Update: {
          notes?: string | null
          party_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_admin_notes_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: true
            referencedRelation: "user_event_history"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "party_admin_notes_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: true
            referencedRelation: "user_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      place_assignments: {
        Row: {
          attendee_id: string
          created_at: string
          id: string
          place_id: string
        }
        Insert: {
          attendee_id: string
          created_at?: string
          id?: string
          place_id: string
        }
        Update: {
          attendee_id?: string
          created_at?: string
          id?: string
          place_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_assignments_attendee_id_fkey"
            columns: ["attendee_id"]
            isOneToOne: true
            referencedRelation: "attendees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_assignments_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "attendee_places"
            referencedColumns: ["place_id"]
          },
          {
            foreignKeyName: "place_assignments_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      places: {
        Row: {
          capacity: number
          created_at: string
          id: string
          label: string
          location_id: string
          sort_order: number
          type: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          id?: string
          label: string
          location_id: string
          sort_order?: number
          type: string
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          label?: string
          location_id?: string
          sort_order?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "places_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "attendee_places"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "places_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string
          full_name: string | null
          id: string
          is_admin: boolean | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email: string
          full_name?: string | null
          id: string
          is_admin?: boolean | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_admin?: boolean | null
        }
        Relationships: []
      }
      registration_edits: {
        Row: {
          changes: Json | null
          edited_at: string | null
          edited_by: string | null
          id: string
          registration_id: string
        }
        Insert: {
          changes?: Json | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          registration_id: string
        }
        Update: {
          changes?: Json | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          registration_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_edits_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "registration_edits_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "user_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_parties: {
        Row: {
          calculated_amount_owed: number | null
          confirmation_message: string | null
          created_at: string | null
          edit_count: number | null
          event_id: string
          id: string
          is_waitlisted: boolean | null
          last_edited_at: string | null
          locked_ratio_main_whole: number | null
          locked_selling_price_whole_event: number | null
          logistics: Json
          message_to_organizers: string | null
          message_to_participants: string | null
          music_requests: string | null
          payment_status: string | null
          status: string | null
          transport: Json
          user_id: string
        }
        Insert: {
          calculated_amount_owed?: number | null
          confirmation_message?: string | null
          created_at?: string | null
          edit_count?: number | null
          event_id: string
          id?: string
          is_waitlisted?: boolean | null
          last_edited_at?: string | null
          locked_ratio_main_whole?: number | null
          locked_selling_price_whole_event?: number | null
          logistics?: Json
          message_to_organizers?: string | null
          message_to_participants?: string | null
          music_requests?: string | null
          payment_status?: string | null
          status?: string | null
          transport?: Json
          user_id: string
        }
        Update: {
          calculated_amount_owed?: number | null
          confirmation_message?: string | null
          created_at?: string | null
          edit_count?: number | null
          event_id?: string
          id?: string
          is_waitlisted?: boolean | null
          last_edited_at?: string | null
          locked_ratio_main_whole?: number | null
          locked_selling_price_whole_event?: number | null
          logistics?: Json
          message_to_organizers?: string | null
          message_to_participants?: string | null
          music_requests?: string | null
          payment_status?: string | null
          status?: string | null
          transport?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_parties_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_parties_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "user_parties_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_parties_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["user_id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          archived_at: string | null
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          name: string
          snapshot_of: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          snapshot_of?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          snapshot_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_snapshot_of_fkey"
            columns: ["snapshot_of"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      attendee_places: {
        Row: {
          attendee_id: string | null
          attendee_name: string | null
          bed_label: string | null
          event_id: string | null
          location_id: string | null
          location_name: string | null
          party_id: string | null
          place_id: string | null
          place_label: string | null
          place_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendees_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["party_id"]
          },
          {
            foreignKeyName: "attendees_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "user_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_assignments_attendee_id_fkey"
            columns: ["attendee_id"]
            isOneToOne: true
            referencedRelation: "attendees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_parties_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_parties_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "user_event_history"
            referencedColumns: ["event_id"]
          },
        ]
      }
      user_event_history: {
        Row: {
          calculated_amount_owed: number | null
          email: string | null
          event_id: string | null
          event_theme: string | null
          full_name: string | null
          is_waitlisted: boolean | null
          party_id: string | null
          payment_status: string | null
          reg_start_date: string | null
          registration_date: string | null
          registration_status: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_gallery_image: {
        Args: {
          p_kind?: string
          p_location_id?: string
          p_path: string
          p_venue_id?: string
        }
        Returns: {
          created_at: string
          gallery_id: string
          id: string
          path: string
          position: number
        }
        SetofOptions: {
          from: "*"
          to: "gallery_images"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_is_admin: {
        Args: { new_is_admin: boolean; target_user_id: string }
        Returns: undefined
      }
      can_view_carpool_board: { Args: never; Returns: boolean }
      carpool_board: {
        Args: never
        Returns: {
          arrival: string
          contact_email: string
          contact_name: string
          departure: string
          departure_fsa: string
          departure_place: string
          entry: number
          is_mine: boolean
          kind: string
          matches: Json
          seats: number
        }[]
      }
      create_event_venue: { Args: { p_event_id: string }; Returns: string }
      delete_my_account: { Args: never; Returns: undefined }
      event_places: {
        Args: { p_event_id: string }
        Returns: {
          capacity: number
          is_excluded: boolean
          label: string
          location_id: string
          location_name: string
          occupants: string[]
          place_id: string
          position: number
          type: string
          venue_capacity: number
        }[]
      }
      get_latest_feedback_resolution: { Args: never; Returns: string }
      is_account_active: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      move_gallery_image: {
        Args: { p_image_id: string; p_offset: number }
        Returns: undefined
      }
      my_party_emails: {
        Args: { p_party_id: string }
        Returns: {
          sent_at: string
          status: string
          template: string
        }[]
      }
      save_logistics: { Args: { p_changes: Json }; Returns: Json }
      save_registration: {
        Args: {
          p_attendees: Json
          p_event_id: string
          p_party?: Json
          p_user_id?: string
        }
        Returns: {
          calculated_amount_owed: number | null
          confirmation_message: string | null
          created_at: string | null
          edit_count: number | null
          event_id: string
          id: string
          is_waitlisted: boolean | null
          last_edited_at: string | null
          locked_ratio_main_whole: number | null
          locked_selling_price_whole_event: number | null
          logistics: Json
          message_to_organizers: string | null
          message_to_participants: string | null
          music_requests: string | null
          payment_status: string | null
          status: string | null
          transport: Json
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_parties"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_place_override: {
        Args: {
          p_capacity: number
          p_event_id: string
          p_is_excluded: boolean
          p_place_id: string
        }
        Returns: {
          capacity: number
          is_excluded: boolean
          label: string
          location_id: string
          location_name: string
          occupants: string[]
          place_id: string
          position: number
          type: string
          venue_capacity: number
        }[]
      }
      unused_gallery_images: { Args: { p_paths?: string[] }; Returns: string[] }
      venue_layout: {
        Args: { p_venue_id: string }
        Returns: {
          capacity: number
          label: string
          location_id: string
          location_name: string
          location_note: string
          location_sort_order: number
          place_id: string
          place_sort_order: number
          position: number
          type: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

