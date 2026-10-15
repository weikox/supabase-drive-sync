export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      curenergia_invoices: {
        Row: {
          amount: number | null
          consumption: string | null
          contract_id: string | null
          created_at: string
          id: string
          invoice_id: string
          invoice_num: string | null
          issued_date: string | null
          pdf_storage_path: string | null
          period_from: string | null
          period_to: string | null
          status: string | null
          supply: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          consumption?: string | null
          contract_id?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_storage_path?: string | null
          period_from?: string | null
          period_to?: string | null
          status?: string | null
          supply: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          consumption?: string | null
          contract_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_storage_path?: string | null
          period_from?: string | null
          period_to?: string | null
          status?: string | null
          supply?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      curenergia_sessions: {
        Row: {
          auth_token: string
          cookie: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_token: string
          cookie: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_token?: string
          cookie?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      digi_invoices: {
        Row: {
          amount: number | null
          contract_id: string | null
          created_at: string
          id: string
          invoice_id: string
          invoice_num: string | null
          issued_date: string | null
          pdf_storage_path: string | null
          pdf_url: string | null
          raw: Json | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          contract_id?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_storage_path?: string | null
          pdf_url?: string | null
          raw?: Json | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          contract_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_storage_path?: string | null
          pdf_url?: string | null
          raw?: Json | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      digi_sessions: {
        Row: {
          device_cookie: string | null
          pending_uuid: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          device_cookie?: string | null
          pending_uuid?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          device_cookie?: string | null
          pending_uuid?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gomez_invoices: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          pdf_storage_path: string | null
          receipt_date: string | null
          receipt_id: string
          supply: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          pdf_storage_path?: string | null
          receipt_date?: string | null
          receipt_id: string
          supply?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          pdf_storage_path?: string | null
          receipt_date?: string | null
          receipt_id?: string
          supply?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inima_invoices: {
        Row: {
          amount: number | null
          contract_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          invoice_key: string
          invoice_num: string | null
          issued_date: string | null
          pdf_storage_path: string | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          contract_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_key: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_storage_path?: string | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          contract_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_key?: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_storage_path?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invoice_runs: {
        Row: {
          captured_lists: Json | null
          captured_texts: Json | null
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          status: string
          task_id: string | null
          user_id: string
        }
        Insert: {
          captured_lists?: Json | null
          captured_texts?: Json | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          status?: string
          task_id?: string | null
          user_id: string
        }
        Update: {
          captured_lists?: Json | null
          captured_texts?: Json | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          status?: string
          task_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      naturgy_invoices: {
        Row: {
          amount: number | null
          contract_account_id: string
          created_at: string
          id: string
          invoice_id: string
          invoice_num: string | null
          issued_date: string | null
          pdf_document_id: string | null
          pdf_storage_path: string | null
          period_from: string | null
          period_to: string | null
          raw: Json | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          contract_account_id: string
          created_at?: string
          id?: string
          invoice_id: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_document_id?: string | null
          pdf_storage_path?: string | null
          period_from?: string | null
          period_to?: string | null
          raw?: Json | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          contract_account_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          invoice_num?: string | null
          issued_date?: string | null
          pdf_document_id?: string | null
          pdf_storage_path?: string | null
          period_from?: string | null
          period_to?: string | null
          raw?: Json | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
