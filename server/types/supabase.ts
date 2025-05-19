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
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
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
  mikage: {
    Tables: {
      incident: {
        Row: {
          googlechat_name: string | null
          instatus_id: string | null
          key: string
          last_updated: string | null
        }
        Insert: {
          googlechat_name?: string | null
          instatus_id?: string | null
          key: string
          last_updated?: string | null
        }
        Update: {
          googlechat_name?: string | null
          instatus_id?: string | null
          key?: string
          last_updated?: string | null
        }
        Relationships: []
      }
      incidents: {
        Row: {
          count: number
          created_at: string
          googlechat_name: string | null
          id: number
          instatus_id: string | null
          is_closed: boolean | null
          keyword: string
          updated_at: string
        }
        Insert: {
          count?: number
          created_at?: string
          googlechat_name?: string | null
          id?: number
          instatus_id?: string | null
          is_closed?: boolean | null
          keyword?: string
          updated_at?: string
        }
        Update: {
          count?: number
          created_at?: string
          googlechat_name?: string | null
          id?: number
          instatus_id?: string | null
          is_closed?: boolean | null
          keyword?: string
          updated_at?: string
        }
        Relationships: []
      }
      logs: {
        Row: {
          created_at: string
          error_code: string | null
          error_name: string | null
          id: number
          response_time: number | null
          status_code: number | null
          status_message: string | null
          target_key: string
        }
        Insert: {
          created_at: string
          error_code?: string | null
          error_name?: string | null
          id?: number
          response_time?: number | null
          status_code?: number | null
          status_message?: string | null
          target_key: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_name?: string | null
          id?: number
          response_time?: number | null
          status_code?: number | null
          status_message?: string | null
          target_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "logs_target_key_fkey"
            columns: ["target_key"]
            isOneToOne: false
            referencedRelation: "targets"
            referencedColumns: ["key"]
          },
        ]
      }
      targets: {
        Row: {
          headers: Json | null
          key: string
          name: string
          url: string
        }
        Insert: {
          headers?: Json | null
          key: string
          name: string
          url: string
        }
        Update: {
          headers?: Json | null
          key?: string
          name?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_error_logs: {
        Args: { start_offset: number; end_offset: number }
        Returns: Json
      }
      get_error_logs_: {
        Args: { start_offset: number; end_offset: number }
        Returns: {
          target_key: string
          name: string
          checked_at: string
          response_time: number
          status_code: number
          status_message: string
          error_name: string
          error_code: string
        }[]
      }
      get_logs_in_range: {
        Args: { keys: string[]; start_time: string; end_time: string }
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
      [_ in never]: never
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

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  mikage: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
