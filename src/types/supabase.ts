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
    PostgrestVersion: "14.5"
  }
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
      app_roles: {
        Row: {
          created_at: string | null
          description: string | null
          role_code: string
          role_name_th: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          role_code: string
          role_name_th: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          role_code?: string
          role_name_th?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action_type"]
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          correlation_id: string | null
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action_type"]
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          correlation_id?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action_type"]
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          correlation_id?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      billing_note_items: {
        Row: {
          billed_amount: number
          billing_note_id: string
          created_at: string | null
          id: string
          invoice_id: string
          updated_at: string | null
        }
        Insert: {
          billed_amount?: number
          billing_note_id: string
          created_at?: string | null
          id?: string
          invoice_id: string
          updated_at?: string | null
        }
        Update: {
          billed_amount?: number
          billing_note_id?: string
          created_at?: string | null
          id?: string
          invoice_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_note_items_billing_note_id_fkey"
            columns: ["billing_note_id"]
            isOneToOne: false
            referencedRelation: "doc_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_note_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "doc_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_persons: {
        Row: {
          contact_id: string | null
          created_at: string | null
          department_or_role: string | null
          email: string | null
          id: string
          is_primary: boolean | null
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          department_or_role?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          department_or_role?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_persons_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          address: string | null
          branch_code: string | null
          company_name: string
          contact_roles: string[]
          created_at: string | null
          credit_days: number | null
          customer_type: string | null
          default_price_tier: string | null
          entity_type: string | null
          id: string
          is_active: boolean | null
          is_tax_validated: boolean | null
          ocr_pattern_config: Json | null
          phone: string | null
          tax_address: string | null
          tax_branch_code: string | null
          tax_id: string | null
        }
        Insert: {
          address?: string | null
          branch_code?: string | null
          company_name: string
          contact_roles?: string[]
          created_at?: string | null
          credit_days?: number | null
          customer_type?: string | null
          default_price_tier?: string | null
          entity_type?: string | null
          id?: string
          is_active?: boolean | null
          is_tax_validated?: boolean | null
          ocr_pattern_config?: Json | null
          phone?: string | null
          tax_address?: string | null
          tax_branch_code?: string | null
          tax_id?: string | null
        }
        Update: {
          address?: string | null
          branch_code?: string | null
          company_name?: string
          contact_roles?: string[]
          created_at?: string | null
          credit_days?: number | null
          customer_type?: string | null
          default_price_tier?: string | null
          entity_type?: string | null
          id?: string
          is_active?: boolean | null
          is_tax_validated?: boolean | null
          ocr_pattern_config?: Json | null
          phone?: string | null
          tax_address?: string | null
          tax_branch_code?: string | null
          tax_id?: string | null
        }
        Relationships: []
      }
      doc_details: {
        Row: {
          description: string | null
          discount_amount: number | null
          discount_text: string | null
          doc_header_id: string | null
          id: string
          line_total: number
          product_id: string | null
          qty: number
          unit_cost_price: number | null
          unit_price: number
          uom_used: string | null
        }
        Insert: {
          description?: string | null
          discount_amount?: number | null
          discount_text?: string | null
          doc_header_id?: string | null
          id?: string
          line_total: number
          product_id?: string | null
          qty?: number
          unit_cost_price?: number | null
          unit_price: number
          uom_used?: string | null
        }
        Update: {
          description?: string | null
          discount_amount?: number | null
          discount_text?: string | null
          doc_header_id?: string | null
          id?: string
          line_total?: number
          product_id?: string | null
          qty?: number
          unit_cost_price?: number | null
          unit_price?: number
          uom_used?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doc_details_doc_header_id_fkey"
            columns: ["doc_header_id"]
            isOneToOne: false
            referencedRelation: "doc_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_details_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_headers: {
        Row: {
          attached_file_url: string | null
          contact_id: string
          contact_person_id: string | null
          created_at: string | null
          deposit_deducted: number | null
          discount_amount: number | null
          doc_date: string
          doc_no: string
          doc_type: string
          due_date: string | null
          grand_total: number | null
          id: string
          original_file_name: string | null
          original_receipt_url: string | null
          payment_status: string | null
          ref_doc_id: string | null
          sub_total: number | null
          tax_amount: number | null
          tax_rate: number | null
          wht_amount: number | null
          wht_attachment_url: string | null
          wht_rate: number | null
        }
        Insert: {
          attached_file_url?: string | null
          contact_id: string
          contact_person_id?: string | null
          created_at?: string | null
          deposit_deducted?: number | null
          discount_amount?: number | null
          doc_date: string
          doc_no: string
          doc_type: string
          due_date?: string | null
          grand_total?: number | null
          id?: string
          original_file_name?: string | null
          original_receipt_url?: string | null
          payment_status?: string | null
          ref_doc_id?: string | null
          sub_total?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          wht_amount?: number | null
          wht_attachment_url?: string | null
          wht_rate?: number | null
        }
        Update: {
          attached_file_url?: string | null
          contact_id?: string
          contact_person_id?: string | null
          created_at?: string | null
          deposit_deducted?: number | null
          discount_amount?: number | null
          doc_date?: string
          doc_no?: string
          doc_type?: string
          due_date?: string | null
          grand_total?: number | null
          id?: string
          original_file_name?: string | null
          original_receipt_url?: string | null
          payment_status?: string | null
          ref_doc_id?: string | null
          sub_total?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          wht_amount?: number | null
          wht_attachment_url?: string | null
          wht_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "doc_headers_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_headers_contact_person_id_fkey"
            columns: ["contact_person_id"]
            isOneToOne: false
            referencedRelation: "contact_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_headers_ref_doc_id_fkey"
            columns: ["ref_doc_id"]
            isOneToOne: false
            referencedRelation: "doc_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      document_allocations: {
        Row: {
          adjustment_amount: number | null
          adjustment_reason: string | null
          allocated_amount: number
          created_at: string | null
          id: string
          invoice_doc_id: string
          original_receipt_received: boolean
          receipt_doc_id: string
          updated_at: string | null
          wht_amount: number | null
          wht_reference_no: string | null
        }
        Insert: {
          adjustment_amount?: number | null
          adjustment_reason?: string | null
          allocated_amount?: number
          created_at?: string | null
          id?: string
          invoice_doc_id: string
          original_receipt_received?: boolean
          receipt_doc_id: string
          updated_at?: string | null
          wht_amount?: number | null
          wht_reference_no?: string | null
        }
        Update: {
          adjustment_amount?: number | null
          adjustment_reason?: string | null
          allocated_amount?: number
          created_at?: string | null
          id?: string
          invoice_doc_id?: string
          original_receipt_received?: boolean
          receipt_doc_id?: string
          updated_at?: string | null
          wht_amount?: number | null
          wht_reference_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_allocations_invoice_doc_id_fkey"
            columns: ["invoice_doc_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_allocations_invoice_doc_id_fkey"
            columns: ["invoice_doc_id"]
            isOneToOne: false
            referencedRelation: "vw_sales_profit_analysis"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "document_allocations_receipt_doc_id_fkey"
            columns: ["receipt_doc_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_allocations_receipt_doc_id_fkey"
            columns: ["receipt_doc_id"]
            isOneToOne: false
            referencedRelation: "vw_sales_profit_analysis"
            referencedColumns: ["document_id"]
          },
        ]
      }
      document_items: {
        Row: {
          created_at: string
          description: string | null
          discount_amount: number
          discount_text: string | null
          document_id: string
          id: string
          line_total: number
          product_id: string | null
          qty: number
          sort_order: number
          technician_bill_id: string | null
          technician_id: string | null
          unit_cost_price: number
          unit_price: number
          uom_used: string | null
          wage_cost: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount_amount?: number
          discount_text?: string | null
          document_id: string
          id?: string
          line_total?: number
          product_id?: string | null
          qty?: number
          sort_order?: number
          technician_bill_id?: string | null
          technician_id?: string | null
          unit_cost_price?: number
          unit_price?: number
          uom_used?: string | null
          wage_cost?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          discount_amount?: number
          discount_text?: string | null
          document_id?: string
          id?: string
          line_total?: number
          product_id?: string | null
          qty?: number
          sort_order?: number
          technician_bill_id?: string | null
          technician_id?: string | null
          unit_cost_price?: number
          unit_price?: number
          uom_used?: string | null
          wage_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "vw_sales_profit_analysis"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "document_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_items_technician_bill_id_fkey"
            columns: ["technician_bill_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_items_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          attached_file_url: string | null
          attachment_url: string | null
          contact_id: string
          contact_person_id: string | null
          created_at: string
          deposit_deducted: number
          discount_amount: number
          discount_text: string | null
          doc_date: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["document_type"]
          due_date: string | null
          grand_total: number
          id: string
          is_voided: boolean | null
          net_before_vat: number
          notes: string | null
          original_file_name: string | null
          original_receipt_url: string | null
          paid_amount: number | null
          payment_status: string
          ref_doc_id: string | null
          ref_document_id: string | null
          reference_no: string | null
          rounding_difference: number | null
          status: Database["public"]["Enums"]["document_status"]
          sub_total: number
          tax_amount: number
          tax_rate: number
          total_amount: number
          updated_at: string
          vat_amount: number
          vat_rate: number
          vat_type: Database["public"]["Enums"]["vat_calculation_type"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wht_amount: number
          wht_attachment_url: string | null
          wht_rate: number
        }
        Insert: {
          attached_file_url?: string | null
          attachment_url?: string | null
          contact_id: string
          contact_person_id?: string | null
          created_at?: string
          deposit_deducted?: number
          discount_amount?: number
          discount_text?: string | null
          doc_date?: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          grand_total?: number
          id?: string
          is_voided?: boolean | null
          net_before_vat?: number
          notes?: string | null
          original_file_name?: string | null
          original_receipt_url?: string | null
          paid_amount?: number | null
          payment_status?: string
          ref_doc_id?: string | null
          ref_document_id?: string | null
          reference_no?: string | null
          rounding_difference?: number | null
          status?: Database["public"]["Enums"]["document_status"]
          sub_total?: number
          tax_amount?: number
          tax_rate?: number
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
          vat_type?: Database["public"]["Enums"]["vat_calculation_type"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wht_amount?: number
          wht_attachment_url?: string | null
          wht_rate?: number
        }
        Update: {
          attached_file_url?: string | null
          attachment_url?: string | null
          contact_id?: string
          contact_person_id?: string | null
          created_at?: string
          deposit_deducted?: number
          discount_amount?: number
          discount_text?: string | null
          doc_date?: string
          doc_no?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          grand_total?: number
          id?: string
          is_voided?: boolean | null
          net_before_vat?: number
          notes?: string | null
          original_file_name?: string | null
          original_receipt_url?: string | null
          paid_amount?: number | null
          payment_status?: string
          ref_doc_id?: string | null
          ref_document_id?: string | null
          reference_no?: string | null
          rounding_difference?: number | null
          status?: Database["public"]["Enums"]["document_status"]
          sub_total?: number
          tax_amount?: number
          tax_rate?: number
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
          vat_type?: Database["public"]["Enums"]["vat_calculation_type"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wht_amount?: number
          wht_attachment_url?: string | null
          wht_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_contact_person_id_fkey"
            columns: ["contact_person_id"]
            isOneToOne: false
            referencedRelation: "contact_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_ref_doc_id_fkey"
            columns: ["ref_doc_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_ref_doc_id_fkey"
            columns: ["ref_doc_id"]
            isOneToOne: false
            referencedRelation: "vw_sales_profit_analysis"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "documents_ref_document_id_fkey"
            columns: ["ref_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_ref_document_id_fkey"
            columns: ["ref_document_id"]
            isOneToOne: false
            referencedRelation: "vw_sales_profit_analysis"
            referencedColumns: ["document_id"]
          },
        ]
      }
      expenses: {
        Row: {
          bank_account_id: string | null
          category_id: string | null
          created_at: string
          document_no: string
          expense_date: string
          grand_total: number | null
          id: string
          net_amount: number
          net_payable: number
          payment_method: string | null
          payment_slip_url: string | null
          receipt_url: string | null
          recorded_by: string | null
          remark: string | null
          status: string
          updated_at: string
          vat_amount: number
          vendor_doc_no: string | null
          vendor_id: string | null
          wht_amount: number
          wht_base_amount: number | null
          wht_doc_no: string | null
          wht_rate: number
          wht_type: string | null
        }
        Insert: {
          bank_account_id?: string | null
          category_id?: string | null
          created_at?: string
          document_no: string
          expense_date: string
          grand_total?: number | null
          id?: string
          net_amount?: number
          net_payable?: number
          payment_method?: string | null
          payment_slip_url?: string | null
          receipt_url?: string | null
          recorded_by?: string | null
          remark?: string | null
          status?: string
          updated_at?: string
          vat_amount?: number
          vendor_doc_no?: string | null
          vendor_id?: string | null
          wht_amount?: number
          wht_base_amount?: number | null
          wht_doc_no?: string | null
          wht_rate?: number
          wht_type?: string | null
        }
        Update: {
          bank_account_id?: string | null
          category_id?: string | null
          created_at?: string
          document_no?: string
          expense_date?: string
          grand_total?: number | null
          id?: string
          net_amount?: number
          net_payable?: number
          payment_method?: string | null
          payment_slip_url?: string | null
          receipt_url?: string | null
          recorded_by?: string | null
          remark?: string | null
          status?: string
          updated_at?: string
          vat_amount?: number
          vendor_doc_no?: string | null
          vendor_id?: string | null
          wht_amount?: number
          wht_base_amount?: number | null
          wht_doc_no?: string | null
          wht_rate?: number
          wht_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "mst_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "mst_expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_ledger: {
        Row: {
          created_at: string | null
          doc_header_id: string | null
          id: string
          notes: string | null
          product_id: string
          qty: number
          trans_type: string
        }
        Insert: {
          created_at?: string | null
          doc_header_id?: string | null
          id?: string
          notes?: string | null
          product_id: string
          qty: number
          trans_type: string
        }
        Update: {
          created_at?: string | null
          doc_header_id?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          qty?: number
          trans_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_ledger_doc_header_id_fkey"
            columns: ["doc_header_id"]
            isOneToOne: false
            referencedRelation: "doc_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      mst_bank_accounts: {
        Row: {
          account_name: string
          account_no: string
          bank_name: string
          branch_name: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          account_name: string
          account_no: string
          bank_name: string
          branch_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string
          account_no?: string
          bank_name?: string
          branch_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mst_brands: {
        Row: {
          brand_code: string
          brand_name: string
          id: string
          is_active: boolean | null
        }
        Insert: {
          brand_code: string
          brand_name: string
          id?: string
          is_active?: boolean | null
        }
        Update: {
          brand_code?: string
          brand_name?: string
          id?: string
          is_active?: boolean | null
        }
        Relationships: []
      }
      mst_categories: {
        Row: {
          category_code: string
          category_name: string
          id: string
          is_active: boolean | null
        }
        Insert: {
          category_code: string
          category_name: string
          id?: string
          is_active?: boolean | null
        }
        Update: {
          category_code?: string
          category_name?: string
          id?: string
          is_active?: boolean | null
        }
        Relationships: []
      }
      mst_colors: {
        Row: {
          color_code: string
          color_name: string
          id: string
          is_active: boolean | null
        }
        Insert: {
          color_code: string
          color_name: string
          id?: string
          is_active?: boolean | null
        }
        Update: {
          color_code?: string
          color_name?: string
          id?: string
          is_active?: boolean | null
        }
        Relationships: []
      }
      mst_expense_categories: {
        Row: {
          category_name: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
        }
        Insert: {
          category_name: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
        }
        Update: {
          category_name?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      mst_genders: {
        Row: {
          created_at: string | null
          gender_code: string
          gender_name: string
          id: string
          is_active: boolean | null
        }
        Insert: {
          created_at?: string | null
          gender_code: string
          gender_name: string
          id?: string
          is_active?: boolean | null
        }
        Update: {
          created_at?: string | null
          gender_code?: string
          gender_name?: string
          id?: string
          is_active?: boolean | null
        }
        Relationships: []
      }
      mst_sizes: {
        Row: {
          brand_id: string | null
          id: string
          is_active: boolean | null
          size_code: string
          size_label: string
          sort_order: number | null
        }
        Insert: {
          brand_id?: string | null
          id?: string
          is_active?: boolean | null
          size_code: string
          size_label: string
          sort_order?: number | null
        }
        Update: {
          brand_id?: string | null
          id?: string
          is_active?: boolean | null
          size_code?: string
          size_label?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mst_sizes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "mst_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          allocated_amount: number
          doc_header_id: string | null
          id: string
          payment_slip_id: string | null
        }
        Insert: {
          allocated_amount: number
          doc_header_id?: string | null
          id?: string
          payment_slip_id?: string | null
        }
        Update: {
          allocated_amount?: number
          doc_header_id?: string | null
          id?: string
          payment_slip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_doc_header_id_fkey"
            columns: ["doc_header_id"]
            isOneToOne: false
            referencedRelation: "doc_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_slip_id_fkey"
            columns: ["payment_slip_id"]
            isOneToOne: false
            referencedRelation: "payment_slips"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_slips: {
        Row: {
          account_source: string | null
          created_at: string | null
          id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          payment_type: string
          recorded_by: string | null
          reference_no: string | null
          slip_image_url: string | null
          total_amount: number
        }
        Insert: {
          account_source?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date: string
          payment_method?: string | null
          payment_type: string
          recorded_by?: string | null
          reference_no?: string | null
          slip_image_url?: string | null
          total_amount: number
        }
        Update: {
          account_source?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_type?: string
          recorded_by?: string | null
          reference_no?: string | null
          slip_image_url?: string | null
          total_amount?: number
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          attachment_url: string | null
          bank_account_id: string | null
          created_at: string | null
          document_id: string
          id: string
          is_reconciled: boolean | null
          is_voided: boolean | null
          payment_date: string | null
          payment_method: Database["public"]["Enums"]["payment_method_enum"]
          reconciled_at: string | null
          reconciled_by: string | null
          reference_no: string | null
          updated_at: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount?: number
          attachment_url?: string | null
          bank_account_id?: string | null
          created_at?: string | null
          document_id: string
          id?: string
          is_reconciled?: boolean | null
          is_voided?: boolean | null
          payment_date?: string | null
          payment_method: Database["public"]["Enums"]["payment_method_enum"]
          reconciled_at?: string | null
          reconciled_by?: string | null
          reference_no?: string | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          bank_account_id?: string | null
          created_at?: string | null
          document_id?: string
          id?: string
          is_reconciled?: boolean | null
          is_voided?: boolean | null
          payment_date?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method_enum"]
          reconciled_at?: string | null
          reconciled_by?: string | null
          reference_no?: string | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "mst_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "vw_sales_profit_analysis"
            referencedColumns: ["document_id"]
          },
        ]
      }
      product_models: {
        Row: {
          brand_id: string | null
          category_id: string | null
          created_at: string | null
          gender: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_service: boolean | null
          model_code: string
          name: string
          short_name: string | null
          size_pricing_config: Json | null
          status: string | null
          tax_type: string | null
          vendor_id: string | null
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_service?: boolean | null
          model_code: string
          name: string
          short_name?: string | null
          size_pricing_config?: Json | null
          status?: string | null
          tax_type?: string | null
          vendor_id?: string | null
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_service?: boolean | null
          model_code?: string
          name?: string
          short_name?: string | null
          size_pricing_config?: Json | null
          status?: string | null
          tax_type?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_models_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "mst_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_models_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "mst_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_models_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      production_jobs: {
        Row: {
          attachment_paths: string[]
          created_at: string | null
          details: string | null
          document_id: string | null
          due_date: string | null
          id: string
          is_archived: boolean
          job_no: string
          job_type: Database["public"]["Enums"]["production_job_type"]
          status: Database["public"]["Enums"]["production_job_status"]
          technician_id: string | null
          technician_bill_id: string | null
          updated_at: string | null
          wage_cost: number | null
        }
        Insert: {
          attachment_paths?: string[]
          created_at?: string | null
          details?: string | null
          document_id?: string | null
          due_date?: string | null
          id?: string
          is_archived?: boolean
          job_no: string
          job_type?: Database["public"]["Enums"]["production_job_type"]
          status?: Database["public"]["Enums"]["production_job_status"]
          technician_id?: string | null
          technician_bill_id?: string | null
          updated_at?: string | null
          wage_cost?: number | null
        }
        Update: {
          attachment_paths?: string[]
          created_at?: string | null
          details?: string | null
          document_id?: string | null
          due_date?: string | null
          id?: string
          is_archived?: boolean
          job_no?: string
          job_type?: Database["public"]["Enums"]["production_job_type"]
          status?: Database["public"]["Enums"]["production_job_status"]
          technician_id?: string | null
          technician_bill_id?: string | null
          updated_at?: string | null
          wage_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "vw_sales_profit_analysis"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "production_jobs_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_jobs_technician_bill_id_fkey"
            columns: ["technician_bill_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          base_uom: string | null
          category: string | null
          color: string | null
          cost_price: number | null
          created_at: string | null
          description: string | null
          gender: string | null
          id: string
          is_active: boolean | null
          model_id: string | null
          name: string
          retail_price: number | null
          short_name: string | null
          size: string | null
          sku: string
          tax_type: string | null
          wholesale_price: number | null
        }
        Insert: {
          barcode?: string | null
          base_uom?: string | null
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          model_id?: string | null
          name: string
          retail_price?: number | null
          short_name?: string | null
          size?: string | null
          sku: string
          tax_type?: string | null
          wholesale_price?: number | null
        }
        Update: {
          barcode?: string | null
          base_uom?: string | null
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          model_id?: string | null
          name?: string
          retail_price?: number | null
          short_name?: string | null
          size?: string | null
          sku?: string
          tax_type?: string | null
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tracking: {
        Row: {
          doc_header_id: string | null
          id: string
          notes: string | null
          step_status: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          doc_header_id?: string | null
          id?: string
          notes?: string | null
          step_status: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          doc_header_id?: string | null
          id?: string
          notes?: string | null
          step_status?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_tracking_doc_header_id_fkey"
            columns: ["doc_header_id"]
            isOneToOne: false
            referencedRelation: "doc_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          address: string
          allow_negative_inventory: boolean
          branch_code: string
          branch_name: string
          company_name: string
          company_name_en: string
          document_print_settings: Json
          email: string
          gl_rounding_expense_acc: string
          gl_rounding_income_acc: string
          id: number
          logo_url: string
          phone: string
          tax_id: string
          updated_at: string
          updated_by: string | null
          vat_rate: number
        }
        Insert: {
          address?: string
          allow_negative_inventory?: boolean
          branch_code?: string
          branch_name?: string
          company_name?: string
          company_name_en?: string
          document_print_settings?: Json
          email?: string
          gl_rounding_expense_acc?: string
          gl_rounding_income_acc?: string
          id?: number
          logo_url?: string
          phone?: string
          tax_id?: string
          updated_at?: string
          updated_by?: string | null
          vat_rate?: number
        }
        Update: {
          address?: string
          allow_negative_inventory?: boolean
          branch_code?: string
          branch_name?: string
          company_name?: string
          company_name_en?: string
          document_print_settings?: Json
          email?: string
          gl_rounding_expense_acc?: string
          gl_rounding_income_acc?: string
          id?: number
          logo_url?: string
          phone?: string
          tax_id?: string
          updated_at?: string
          updated_by?: string | null
          vat_rate?: number
        }
        Relationships: []
      }
      technician_rates: {
        Row: {
          created_at: string | null
          default_wage: number
          id: string
          service_model_id: string
          technician_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_wage?: number
          id?: string
          service_model_id: string
          technician_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_wage?: number
          id?: string
          service_model_id?: string
          technician_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technician_rates_service_model_id_fkey"
            columns: ["service_model_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_rates_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      technician_rates_legacy_archive: {
        Row: {
          contact_id: string | null
          cost_price: number
          created_at: string | null
          default_wage: number | null
          id: string
          is_active: boolean | null
          selling_price: number
          service_model_id: string | null
          service_name: string
          technician_id: string | null
          updated_at: string | null
        }
        Insert: {
          contact_id?: string | null
          cost_price?: number
          created_at?: string | null
          default_wage?: number | null
          id?: string
          is_active?: boolean | null
          selling_price?: number
          service_model_id?: string | null
          service_name: string
          technician_id?: string | null
          updated_at?: string | null
        }
        Update: {
          contact_id?: string | null
          cost_price?: number
          created_at?: string | null
          default_wage?: number | null
          id?: string
          is_active?: boolean | null
          selling_price?: number
          service_model_id?: string | null
          service_name?: string
          technician_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean | null
          pin_code: string | null
          role_code: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name: string
          id: string
          is_active?: boolean | null
          pin_code?: string | null
          role_code?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          pin_code?: string | null
          role_code?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "app_roles"
            referencedColumns: ["role_code"]
          },
        ]
      }
      vendor_product_mapping: {
        Row: {
          conversion_factor: number | null
          created_at: string | null
          id: string
          internal_product_id: string | null
          vendor_id: string | null
          vendor_product_name: string | null
          vendor_sku: string
          vendor_uom: string | null
        }
        Insert: {
          conversion_factor?: number | null
          created_at?: string | null
          id?: string
          internal_product_id?: string | null
          vendor_id?: string | null
          vendor_product_name?: string | null
          vendor_sku: string
          vendor_uom?: string | null
        }
        Update: {
          conversion_factor?: number | null
          created_at?: string | null
          id?: string
          internal_product_id?: string | null
          vendor_id?: string | null
          vendor_product_name?: string | null
          vendor_sku?: string
          vendor_uom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_product_mapping_internal_product_id_fkey"
            columns: ["internal_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_product_mapping_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      vw_monthly_profit_summary: {
        Row: {
          cogs: number | null
          gross_profit: number | null
          net_profit: number | null
          opex: number | null
          product_cogs: number | null
          profit_month: string | null
          revenue: number | null
          wage_cogs: number | null
        }
        Relationships: []
      }
      vw_sales_profit_analysis: {
        Row: {
          contact_name: string | null
          doc_type: Database["public"]["Enums"]["document_type"] | null
          document_date: string | null
          document_id: string | null
          document_number: string | null
          grand_total: number | null
          net_revenue: number | null
          product_cogs: number | null
          total_cogs: number | null
          wage_cogs: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      fn_is_admin: { Args: never; Returns: boolean }
      generate_document_no: {
        Args: { p_doc_date: string; p_doc_type: string }
        Returns: string
      }
      generate_expense_no: {
        Args: { p_expense_date?: string }
        Returns: string
      }
      void_document_with_stock_reversal: {
        Args: { p_document_id: string }
        Returns: Json
      }
    }
    Enums: {
      audit_action_type: "INSERT" | "UPDATE" | "DELETE"
      document_status:
        | "DRAFT"
        | "ISSUED"
        | "PAID"
        | "CANCELLED"
        | "VOID"
        | "COMPLETED"
      document_type:
        | "QT"
        | "PO"
        | "ABB"
        | "DEP"
        | "INV_DO"
        | "REC"
        | "TAX_INV"
        | "INT_REC"
        | "SO"
        | "CS_TAX"
        | "DEP_IN"
        | "CN"
        | "AP_TAX"
        | "AP_INV"
        | "AP_CASH"
        | "DEP_OUT"
        | "PAY"
        | "REFUND"
        | "WRITE_OFF"
        | "AR_REFUND"
        | "AP_REFUND"
        | "AR_WRITEOFF"
        | "AP_WRITEOFF"
        | "TB"
      payment_method_enum:
        | "CASH"
        | "BANK_TRANSFER"
        | "CHEQUE"
        | "CREDIT_CARD"
        | "OFFSET_DEPOSIT"
      payment_status_enum: "UNPAID" | "PARTIAL" | "PAID" | "VOIDED"
      production_job_status:
        | "TODO"
        | "IN_PROGRESS"
        | "QC"
        | "READY_TO_SHIP"
        | "DELIVERED"
        | "CANCELLED"
      production_job_type: "SCREEN" | "EMBROIDERY" | "SEWING" | "OTHER"
      vat_calculation_type: "NONE" | "INCLUSIVE" | "EXCLUSIVE"
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
    Enums: {
      audit_action_type: ["INSERT", "UPDATE", "DELETE"],
      document_status: [
        "DRAFT",
        "ISSUED",
        "PAID",
        "CANCELLED",
        "VOID",
        "COMPLETED",
      ],
      document_type: [
        "QT",
        "PO",
        "ABB",
        "DEP",
        "INV_DO",
        "REC",
        "TAX_INV",
        "INT_REC",
        "SO",
        "CS_TAX",
        "DEP_IN",
        "CN",
        "AP_TAX",
        "AP_INV",
        "AP_CASH",
        "DEP_OUT",
        "PAY",
        "REFUND",
        "WRITE_OFF",
        "AR_REFUND",
        "AP_REFUND",
        "AR_WRITEOFF",
        "AP_WRITEOFF",
        "TB",
      ],
      payment_method_enum: [
        "CASH",
        "BANK_TRANSFER",
        "CHEQUE",
        "CREDIT_CARD",
        "OFFSET_DEPOSIT",
      ],
      payment_status_enum: ["UNPAID", "PARTIAL", "PAID", "VOIDED"],
      production_job_status: [
        "TODO",
        "IN_PROGRESS",
        "QC",
        "READY_TO_SHIP",
        "DELIVERED",
        "CANCELLED",
      ],
      production_job_type: ["SCREEN", "EMBROIDERY", "SEWING", "OTHER"],
      vat_calculation_type: ["NONE", "INCLUSIVE", "EXCLUSIVE"],
    },
  },
} as const
