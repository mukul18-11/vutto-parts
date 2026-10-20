
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": string,"created_at": string,"entity_id": string,"entity_type": string,"id": number,"is_simulated": boolean,"request_id": string | null,"summary": NonNullable<Json>,"user_id": string | null,"workshop_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string,"entity_id": string,"entity_type": string,"id"?: never,"is_simulated"?: boolean,"request_id"?: string | null,"summary"?: NonNullable<Json>,"user_id"?: string | null,"workshop_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"entity_id"?: string,"entity_type"?: string,"id"?: never,"is_simulated"?: boolean,"request_id"?: string | null,"summary"?: NonNullable<Json>,"user_id"?: string | null,"workshop_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_log_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "activity_log_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"app_errors": {
                  Row: {
                    "code": string,"created_at": string,"id": number,"message": string,"request_id": string | null,"route": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: never,"message": string,"request_id"?: string | null,"route": string,"user_id": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: never,"message"?: string,"request_id"?: string | null,"route"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"bikes": {
                  Row: {
                    "arrived_at": string | null,"bay_in_at": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"created_at": string,"id": string,"is_simulated": boolean,"mfg_year": number,"model_id": string,"purchased_at": string,"ready_at": string | null,"reg_no": string,"reg_no_norm": string | null,"status": Database["public"]['Enums']["bike_status"],"variant_id": string | null,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "arrived_at"?: string | null,"bay_in_at"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"id"?: string,"is_simulated"?: boolean,"mfg_year": number,"model_id": string,"purchased_at": string,"ready_at"?: string | null,"reg_no": string,"reg_no_norm"?: never,"status"?: Database["public"]['Enums']["bike_status"],"variant_id"?: string | null,"workshop_id": string
                  }
                  Update: {
                    "arrived_at"?: string | null,"bay_in_at"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"id"?: string,"is_simulated"?: boolean,"mfg_year"?: number,"model_id"?: string,"purchased_at"?: string,"ready_at"?: string | null,"reg_no"?: string,"reg_no_norm"?: never,"status"?: Database["public"]['Enums']["bike_status"],"variant_id"?: string | null,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bikes_model_id_fkey"
      columns: ["model_id"]
isOneToOne: false
      referencedRelation: "vehicle_models"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bikes_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "model_variants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bikes_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "bikes_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"bins": {
                  Row: {
                    "code": string,"count_requested_at": string | null,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["bin_kind"],"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"count_requested_at"?: string | null,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["bin_kind"],"workshop_id": string
                  }
                  Update: {
                    "code"?: string,"count_requested_at"?: string | null,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["bin_kind"],"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bins_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "bins_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"demo_meta": {
                  Row: {
                    "anchor_date": string | null,"cooldown_seconds": number,"created_at": string,"id": number,"last_reset_at": string | null,"last_reset_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "anchor_date"?: string | null,"cooldown_seconds"?: number,"created_at"?: string,"id": number,"last_reset_at"?: string | null,"last_reset_by"?: string | null
                  }
                  Update: {
                    "anchor_date"?: string | null,"cooldown_seconds"?: number,"created_at"?: string,"id"?: number,"last_reset_at"?: string | null,"last_reset_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"doc_counters": {
                  Row: {
                    "created_at": string,"doc_type": Database["public"]['Enums']["doc_type"],"next_no": number,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"doc_type": Database["public"]['Enums']["doc_type"],"next_no"?: number,"workshop_id": string
                  }
                  Update: {
                    "created_at"?: string,"doc_type"?: Database["public"]['Enums']["doc_type"],"next_no"?: number,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "doc_counters_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "doc_counters_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"emergency_buys": {
                  Row: {
                    "bill_photo_path": string | null,"bought_by": string,"created_at": string,"id": string,"is_simulated": boolean,"job_card_line_id": string,"note": string | null,"part_id": string,"qty": number,"qty_issued": number,"qty_to_stock": number,"reason": Database["public"]['Enums']["emergency_reason"],"reference_price_paise": number | null,"unit_price_paise": number,"vendor_name": string,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bill_photo_path"?: string | null,"bought_by": string,"created_at"?: string,"id"?: string,"is_simulated"?: boolean,"job_card_line_id": string,"note"?: string | null,"part_id": string,"qty": number,"qty_issued": number,"qty_to_stock": number,"reason": Database["public"]['Enums']["emergency_reason"],"reference_price_paise"?: number | null,"unit_price_paise": number,"vendor_name": string,"workshop_id": string
                  }
                  Update: {
                    "bill_photo_path"?: string | null,"bought_by"?: string,"created_at"?: string,"id"?: string,"is_simulated"?: boolean,"job_card_line_id"?: string,"note"?: string | null,"part_id"?: string,"qty"?: number,"qty_issued"?: number,"qty_to_stock"?: number,"reason"?: Database["public"]['Enums']["emergency_reason"],"reference_price_paise"?: number | null,"unit_price_paise"?: number,"vendor_name"?: string,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "emergency_buys_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "emergency_buys_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "emergency_buys_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "emergency_buys_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "emergency_buys_workshop_id_job_card_line_id_fkey"
      columns: ["workshop_id","job_card_line_id"]
isOneToOne: false
      referencedRelation: "job_card_lines"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"finding_type_parts": {
                  Row: {
                    "attr_key": string | null,"attr_value": string | null,"created_at": string,"finding_type_id": string,"id": string,"part_type": string,"qty": number
                  }
                  ComputedFields: never
                  Insert: {
                    "attr_key"?: string | null,"attr_value"?: string | null,"created_at"?: string,"finding_type_id": string,"id"?: string,"part_type": string,"qty": number
                  }
                  Update: {
                    "attr_key"?: string | null,"attr_value"?: string | null,"created_at"?: string,"finding_type_id"?: string,"id"?: string,"part_type"?: string,"qty"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "finding_type_parts_finding_type_id_fkey"
      columns: ["finding_type_id"]
isOneToOne: false
      referencedRelation: "finding_types"
      referencedColumns: ["id"]
    }
                  ]
                },"finding_types": {
                  Row: {
                    "area": Database["public"]['Enums']["finding_area"],"code": string,"created_at": string,"id": string,"is_active": boolean,"label_en": string,"label_hi": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area": Database["public"]['Enums']["finding_area"],"code": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label_en": string,"label_hi": string
                  }
                  Update: {
                    "area"?: Database["public"]['Enums']["finding_area"],"code"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label_en"?: string,"label_hi"?: string
                  }
                  Relationships: [
                    
                  ]
                },"grn_lines": {
                  Row: {
                    "created_at": string,"grn_id": string,"id": string,"part_id": string,"po_line_id": string,"qty_accepted": number,"qty_damaged": number,"qty_received": number,"qty_wrong_part": number,"unit_price_paise": number,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"grn_id": string,"id"?: string,"part_id": string,"po_line_id": string,"qty_accepted": number,"qty_damaged"?: number,"qty_received": number,"qty_wrong_part"?: number,"unit_price_paise": number,"workshop_id": string
                  }
                  Update: {
                    "created_at"?: string,"grn_id"?: string,"id"?: string,"part_id"?: string,"po_line_id"?: string,"qty_accepted"?: number,"qty_damaged"?: number,"qty_received"?: number,"qty_wrong_part"?: number,"unit_price_paise"?: number,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "grn_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grn_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "grn_lines_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "grn_lines_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grn_lines_workshop_id_grn_id_fkey"
      columns: ["workshop_id","grn_id"]
isOneToOne: false
      referencedRelation: "grns"
      referencedColumns: ["workshop_id","id"]
    },{
      foreignKeyName: "grn_lines_workshop_id_po_line_id_fkey"
      columns: ["workshop_id","po_line_id"]
isOneToOne: false
      referencedRelation: "po_lines"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"grns": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"invoice_date": string,"invoice_no_norm": string | null,"is_simulated": boolean,"po_id": string,"received_at": string,"received_by": string,"supplier_id": string,"supplier_invoice_no": string,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"invoice_date": string,"invoice_no_norm"?: never,"is_simulated"?: boolean,"po_id": string,"received_at"?: string,"received_by": string,"supplier_id": string,"supplier_invoice_no": string,"workshop_id": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"invoice_date"?: string,"invoice_no_norm"?: never,"is_simulated"?: boolean,"po_id"?: string,"received_at"?: string,"received_by"?: string,"supplier_id"?: string,"supplier_invoice_no"?: string,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "grns_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grns_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "grns_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grns_workshop_id_po_id_fkey"
      columns: ["workshop_id","po_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"idempotency": {
                  Row: {
                    "created_at": string,"fn": string,"payload_hash": string,"request_id": string,"result": Json | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"fn": string,"payload_hash": string,"request_id": string,"result"?: Json | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"fn"?: string,"payload_hash"?: string,"request_id"?: string,"result"?: Json | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"inspection_findings": {
                  Row: {
                    "bike_id": string,"created_at": string,"finding_type_id": string,"id": string,"job_card_line_id": string | null,"no_part_reason": string | null,"notes": string | null,"qty": number | null,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bike_id": string,"created_at"?: string,"finding_type_id": string,"id"?: string,"job_card_line_id"?: string | null,"no_part_reason"?: string | null,"notes"?: string | null,"qty"?: number | null,"workshop_id": string
                  }
                  Update: {
                    "bike_id"?: string,"created_at"?: string,"finding_type_id"?: string,"id"?: string,"job_card_line_id"?: string | null,"no_part_reason"?: string | null,"notes"?: string | null,"qty"?: number | null,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inspection_findings_finding_type_id_fkey"
      columns: ["finding_type_id"]
isOneToOne: false
      referencedRelation: "finding_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_findings_workshop_id_bike_id_fkey"
      columns: ["workshop_id","bike_id"]
isOneToOne: false
      referencedRelation: "bikes"
      referencedColumns: ["workshop_id","id"]
    },{
      foreignKeyName: "inspection_findings_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "inspection_findings_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_findings_workshop_id_job_card_line_id_fkey"
      columns: ["workshop_id","job_card_line_id"]
isOneToOne: false
      referencedRelation: "job_card_lines"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"job_card_lines": {
                  Row: {
                    "added_reason": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"created_at": string,"id": string,"job_card_id": string,"part_id": string,"qty_issued": number,"qty_required": number,"qty_reserved": number,"qty_returned": number,"source": Database["public"]['Enums']["line_source"],"status": Database["public"]['Enums']["line_status"] | null,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_reason"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"id"?: string,"job_card_id": string,"part_id": string,"qty_issued"?: number,"qty_required": number,"qty_reserved"?: number,"qty_returned"?: number,"source": Database["public"]['Enums']["line_source"],"status"?: never,"workshop_id": string
                  }
                  Update: {
                    "added_reason"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"id"?: string,"job_card_id"?: string,"part_id"?: string,"qty_issued"?: number,"qty_required"?: number,"qty_reserved"?: number,"qty_returned"?: number,"source"?: Database["public"]['Enums']["line_source"],"status"?: never,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_card_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "job_card_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "job_card_lines_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "job_card_lines_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "job_card_lines_workshop_id_job_card_id_fkey"
      columns: ["workshop_id","job_card_id"]
isOneToOne: false
      referencedRelation: "job_cards"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"job_cards": {
                  Row: {
                    "bike_id": string,"cancel_reason": string | null,"cancelled_at": string | null,"closed_at": string | null,"code": string,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"id": string,"is_simulated": boolean,"needed_by": string | null,"needs_review_reason": string | null,"parts_complete_at": string | null,"status": Database["public"]['Enums']["job_card_status"],"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bike_id": string,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"closed_at"?: string | null,"code": string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"id"?: string,"is_simulated"?: boolean,"needed_by"?: string | null,"needs_review_reason"?: string | null,"parts_complete_at"?: string | null,"status"?: Database["public"]['Enums']["job_card_status"],"workshop_id": string
                  }
                  Update: {
                    "bike_id"?: string,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"closed_at"?: string | null,"code"?: string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"id"?: string,"is_simulated"?: boolean,"needed_by"?: string | null,"needs_review_reason"?: string | null,"parts_complete_at"?: string | null,"status"?: Database["public"]['Enums']["job_card_status"],"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_cards_workshop_id_bike_id_fkey"
      columns: ["workshop_id","bike_id"]
isOneToOne: false
      referencedRelation: "bikes"
      referencedColumns: ["workshop_id","id"]
    },{
      foreignKeyName: "job_cards_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "job_cards_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"model_variants": {
                  Row: {
                    "brake_front": Database["public"]['Enums']["brake_type"],"brake_rear": Database["public"]['Enums']["brake_type"],"created_at": string,"emission": Database["public"]['Enums']["emission_norm"],"fuel": Database["public"]['Enums']["fuel_system"],"id": string,"model_id": string,"name": string,"start_type": Database["public"]['Enums']["start_type"],"wheels": Database["public"]['Enums']["wheel_type"],"year_from": number,"year_to": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brake_front": Database["public"]['Enums']["brake_type"],"brake_rear": Database["public"]['Enums']["brake_type"],"created_at"?: string,"emission": Database["public"]['Enums']["emission_norm"],"fuel": Database["public"]['Enums']["fuel_system"],"id"?: string,"model_id": string,"name": string,"start_type": Database["public"]['Enums']["start_type"],"wheels": Database["public"]['Enums']["wheel_type"],"year_from": number,"year_to"?: number | null
                  }
                  Update: {
                    "brake_front"?: Database["public"]['Enums']["brake_type"],"brake_rear"?: Database["public"]['Enums']["brake_type"],"created_at"?: string,"emission"?: Database["public"]['Enums']["emission_norm"],"fuel"?: Database["public"]['Enums']["fuel_system"],"id"?: string,"model_id"?: string,"name"?: string,"start_type"?: Database["public"]['Enums']["start_type"],"wheels"?: Database["public"]['Enums']["wheel_type"],"year_from"?: number,"year_to"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "model_variants_model_id_fkey"
      columns: ["model_id"]
isOneToOne: false
      referencedRelation: "vehicle_models"
      referencedColumns: ["id"]
    }
                  ]
                },"part_fitments": {
                  Row: {
                    "confirmed_count": number,"created_at": string,"flagged_count": number,"last_flag_note": string | null,"last_flagged_at": string | null,"part_id": string,"qty_per_bike": number,"source": Database["public"]['Enums']["fitment_source"],"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_count"?: number,"created_at"?: string,"flagged_count"?: number,"last_flag_note"?: string | null,"last_flagged_at"?: string | null,"part_id": string,"qty_per_bike"?: number,"source": Database["public"]['Enums']["fitment_source"],"variant_id": string
                  }
                  Update: {
                    "confirmed_count"?: number,"created_at"?: string,"flagged_count"?: number,"last_flag_note"?: string | null,"last_flagged_at"?: string | null,"part_id"?: string,"qty_per_bike"?: number,"source"?: Database["public"]['Enums']["fitment_source"],"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "part_fitments_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "part_fitments_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "part_fitments_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "model_variants"
      referencedColumns: ["id"]
    }
                  ]
                },"parts": {
                  Row: {
                    "aliases": (string)[],"category": Database["public"]['Enums']["part_category"],"created_at": string,"id": string,"is_active": boolean,"is_universal": boolean,"name": string,"name_hi": string | null,"oem_part_no": string | null,"oem_part_no_norm": string | null,"part_type": string,"preferred_supplier_id": string | null,"sku": string,"standard_price_paise": number,"uom": Database["public"]['Enums']["uom"]
                  }
                  ComputedFields: never
                  Insert: {
                    "aliases"?: (string)[],"category": Database["public"]['Enums']["part_category"],"created_at"?: string,"id"?: string,"is_active"?: boolean,"is_universal"?: boolean,"name": string,"name_hi"?: string | null,"oem_part_no"?: string | null,"oem_part_no_norm"?: never,"part_type": string,"preferred_supplier_id"?: string | null,"sku": string,"standard_price_paise": number,"uom": Database["public"]['Enums']["uom"]
                  }
                  Update: {
                    "aliases"?: (string)[],"category"?: Database["public"]['Enums']["part_category"],"created_at"?: string,"id"?: string,"is_active"?: boolean,"is_universal"?: boolean,"name"?: string,"name_hi"?: string | null,"oem_part_no"?: string | null,"oem_part_no_norm"?: never,"part_type"?: string,"preferred_supplier_id"?: string | null,"sku"?: string,"standard_price_paise"?: number,"uom"?: Database["public"]['Enums']["uom"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "parts_preferred_supplier_id_fkey"
      columns: ["preferred_supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    }
                  ]
                },"po_lines": {
                  Row: {
                    "created_at": string,"id": string,"open_qty": number | null,"part_id": string,"po_id": string,"qty_accepted": number,"qty_cancelled": number,"qty_ordered": number,"qty_rejected": number,"source": Database["public"]['Enums']["po_line_source"],"unit_price_paise": number | null,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"open_qty"?: never,"part_id": string,"po_id": string,"qty_accepted"?: number,"qty_cancelled"?: number,"qty_ordered": number,"qty_rejected"?: number,"source": Database["public"]['Enums']["po_line_source"],"unit_price_paise"?: number | null,"workshop_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"open_qty"?: never,"part_id"?: string,"po_id"?: string,"qty_accepted"?: number,"qty_cancelled"?: number,"qty_ordered"?: number,"qty_rejected"?: number,"source"?: Database["public"]['Enums']["po_line_source"],"unit_price_paise"?: number | null,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "po_lines_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "po_lines_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_lines_workshop_id_po_id_fkey"
      columns: ["workshop_id","po_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string,"role": Database["public"]['Enums']["app_role"],"user_id": string,"workshop_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name": string,"role": Database["public"]['Enums']["app_role"],"user_id": string,"workshop_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"role"?: Database["public"]['Enums']["app_role"],"user_id"?: string,"workshop_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "profiles_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"purchase_orders": {
                  Row: {
                    "cancel_reason": string | null,"code": string,"created_at": string,"expected_on": string | null,"id": string,"is_simulated": boolean,"sent_at": string | null,"status": Database["public"]['Enums']["po_status"],"supplier_id": string,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_reason"?: string | null,"code": string,"created_at"?: string,"expected_on"?: string | null,"id"?: string,"is_simulated"?: boolean,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["po_status"],"supplier_id": string,"workshop_id": string
                  }
                  Update: {
                    "cancel_reason"?: string | null,"code"?: string,"created_at"?: string,"expected_on"?: string | null,"id"?: string,"is_simulated"?: boolean,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["po_status"],"supplier_id"?: string,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_orders_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_orders_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "purchase_orders_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"reorder_settings": {
                  Row: {
                    "auto": boolean,"created_at": string,"max_qty": number,"part_id": string,"preferred_supplier_id": string | null,"safety_stock": number,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auto": boolean,"created_at"?: string,"max_qty": number,"part_id": string,"preferred_supplier_id"?: string | null,"safety_stock": number,"workshop_id": string
                  }
                  Update: {
                    "auto"?: boolean,"created_at"?: string,"max_qty"?: number,"part_id"?: string,"preferred_supplier_id"?: string | null,"safety_stock"?: number,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reorder_settings_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reorder_settings_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "reorder_settings_preferred_supplier_id_fkey"
      columns: ["preferred_supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reorder_settings_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "reorder_settings_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_balances": {
                  Row: {
                    "bin_id": string,"created_at": string,"on_hand": number,"part_id": string,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bin_id": string,"created_at"?: string,"on_hand": number,"part_id": string,"workshop_id": string
                  }
                  Update: {
                    "bin_id"?: string,"created_at"?: string,"on_hand"?: number,"part_id"?: string,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_balances_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_balances_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "stock_balances_workshop_id_bin_id_fkey"
      columns: ["workshop_id","bin_id"]
isOneToOne: false
      referencedRelation: "bins"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"stock_moves": {
                  Row: {
                    "created_at": string,"emergency_buy_id": string | null,"from_bin_id": string | null,"grn_line_id": string | null,"id": number,"is_simulated": boolean,"job_card_line_id": string | null,"move_type": Database["public"]['Enums']["move_type"],"note": string | null,"part_id": string,"qty": number,"reason": string | null,"request_id": string | null,"to_bin_id": string | null,"user_id": string | null,"workshop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"emergency_buy_id"?: string | null,"from_bin_id"?: string | null,"grn_line_id"?: string | null,"id"?: never,"is_simulated"?: boolean,"job_card_line_id"?: string | null,"move_type": Database["public"]['Enums']["move_type"],"note"?: string | null,"part_id": string,"qty": number,"reason"?: string | null,"request_id"?: string | null,"to_bin_id"?: string | null,"user_id"?: string | null,"workshop_id": string
                  }
                  Update: {
                    "created_at"?: string,"emergency_buy_id"?: string | null,"from_bin_id"?: string | null,"grn_line_id"?: string | null,"id"?: never,"is_simulated"?: boolean,"job_card_line_id"?: string | null,"move_type"?: Database["public"]['Enums']["move_type"],"note"?: string | null,"part_id"?: string,"qty"?: number,"reason"?: string | null,"request_id"?: string | null,"to_bin_id"?: string | null,"user_id"?: string | null,"workshop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_moves_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_moves_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "stock_moves_workshop_id_emergency_buy_id_fkey"
      columns: ["workshop_id","emergency_buy_id"]
isOneToOne: false
      referencedRelation: "emergency_buys"
      referencedColumns: ["workshop_id","id"]
    },{
      foreignKeyName: "stock_moves_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["workshop_id"]
    },{
      foreignKeyName: "stock_moves_workshop_id_fkey"
      columns: ["workshop_id"]
isOneToOne: false
      referencedRelation: "workshops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_moves_workshop_id_from_bin_id_fkey"
      columns: ["workshop_id","from_bin_id"]
isOneToOne: false
      referencedRelation: "bins"
      referencedColumns: ["workshop_id","id"]
    },{
      foreignKeyName: "stock_moves_workshop_id_grn_line_id_fkey"
      columns: ["workshop_id","grn_line_id"]
isOneToOne: false
      referencedRelation: "grn_lines"
      referencedColumns: ["workshop_id","id"]
    },{
      foreignKeyName: "stock_moves_workshop_id_job_card_line_id_fkey"
      columns: ["workshop_id","job_card_line_id"]
isOneToOne: false
      referencedRelation: "job_card_lines"
      referencedColumns: ["workshop_id","id"]
    },{
      foreignKeyName: "stock_moves_workshop_id_to_bin_id_fkey"
      columns: ["workshop_id","to_bin_id"]
isOneToOne: false
      referencedRelation: "bins"
      referencedColumns: ["workshop_id","id"]
    }
                  ]
                },"supplier_parts": {
                  Row: {
                    "created_at": string,"part_id": string,"price_paise": number,"supplier_code": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"part_id": string,"price_paise": number,"supplier_code"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "created_at"?: string,"part_id"?: string,"price_paise"?: number,"supplier_code"?: string | null,"supplier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_parts_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_parts_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    },{
      foreignKeyName: "supplier_parts_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "city": string,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["supplier_kind"],"lead_time_days": number,"name": string,"phone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "city": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["supplier_kind"],"lead_time_days": number,"name": string,"phone": string
                  }
                  Update: {
                    "city"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["supplier_kind"],"lead_time_days"?: number,"name"?: string,"phone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"vehicle_models": {
                  Row: {
                    "created_at": string,"id": string,"make": string,"model": string,"segment": Database["public"]['Enums']["vehicle_segment"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"make": string,"model": string,"segment": Database["public"]['Enums']["vehicle_segment"]
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"make"?: string,"model"?: string,"segment"?: Database["public"]['Enums']["vehicle_segment"]
                  }
                  Relationships: [
                    
                  ]
                },"workshops": {
                  Row: {
                    "city": string,"code": string,"created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "city": string,"code": string,"created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "city"?: string,"code"?: string,"created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "v_part_last_price": {
                  Row: {
                    "grn_id": string | null,"part_id": string | null,"received_at": string | null,"unit_price_paise": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "grn_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "parts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grn_lines_part_id_fkey"
      columns: ["part_id"]
isOneToOne: false
      referencedRelation: "v_stock_position"
      referencedColumns: ["part_id"]
    }
                  ]
                },"v_stock_position": {
                  Row: {
                    "available": number | null,"on_order": number | null,"outstanding_demand": number | null,"part_id": string | null,"quarantine_on_hand": number | null,"reserved": number | null,"shortfall": number | null,"usable_on_hand": number | null,"workshop_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "add_job_card_line":
{ Args: { "p_card_id": string,"p_part_id": string,"p_qty": number,"p_reason"?: string,"p_request_id": string }; Returns: Json
                           },
"adjust_stock":
{ Args: { "p_bin_id": string,"p_counted_qty": number,"p_expected_on_hand": number,"p_part_id": string,"p_reason": string,"p_request_id": string }; Returns: Json
                           },
"cancel_bike":
{ Args: { "p_bike_id": string,"p_reason": string,"p_request_id": string }; Returns: Json
                           },
"cancel_job_card":
{ Args: { "p_card_id": string,"p_reason": string,"p_request_id": string }; Returns: Json
                           },
"clear_needs_review":
{ Args: { "p_card_id": string,"p_reason": string,"p_request_id": string }; Returns: Json
                           },
"close_job_card":
{ Args: { "p_card_id": string,"p_drop_remaining": boolean,"p_reason"?: string,"p_request_id": string }; Returns: Json
                           },
"confirm_job_card":
{ Args: { "p_card_id": string,"p_request_id": string }; Returns: Json
                           },
"create_bike":
{ Args: { "p_findings": Json,"p_mfg_year": number,"p_model_id": string,"p_reg_no": string,"p_request_id": string,"p_variant_id"?: string,"p_workshop_id": string }; Returns: Json
                           },
"create_job_card":
{ Args: { "p_bike_id": string,"p_request_id": string }; Returns: Json
                           },
"finding_candidates":
{ Args: { "p_finding_id": string }; Returns: {
              "auto_pick": boolean,"confirmed_count": number,"flagged_count": number,"is_universal": boolean,"name": string,"name_hi": string,"part_id": string,"part_type": string,"qty": number,"qty_per_bike": number,"rank": number,"sku": string,"source": Database["public"]['Enums']["fitment_source"],"uom": Database["public"]['Enums']["uom"]
            }[]
                           },
"health":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"line_candidates":
{ Args: { "p_line_id": string }; Returns: {
              "auto_pick": boolean,"confirmed_count": number,"flagged_count": number,"is_current": boolean,"is_universal": boolean,"name": string,"name_hi": string,"part_id": string,"qty_per_bike": number,"rank": number,"sku": string,"source": Database["public"]['Enums']["fitment_source"],"uom": Database["public"]['Enums']["uom"]
            }[]
                           },
"mark_arrived":
{ Args: { "p_bike_id": string,"p_request_id": string }; Returns: Json
                           },
"move_stock":
{ Args: { "p_from_bin_id": string,"p_part_id": string,"p_qty": number,"p_reason": string,"p_request_id": string,"p_to_bin_id": string }; Returns: Json
                           },
"part_candidates":
{ Args: { "p_part_type": string,"p_variant_id": string }; Returns: {
              "auto_pick": boolean,"confirmed_count": number,"flagged_count": number,"is_universal": boolean,"name": string,"name_hi": string,"part_id": string,"qty_per_bike": number,"rank": number,"sku": string,"source": Database["public"]['Enums']["fitment_source"],"uom": Database["public"]['Enums']["uom"]
            }[]
                           },
"putaway":
{ Args: { "p_from_bin_id": string,"p_part_id": string,"p_qty": number,"p_request_id": string,"p_to_bin_id": string }; Returns: Json
                           },
"reallocate_reservation":
{ Args: { "p_from_line_id": string,"p_qty": number,"p_reason": string,"p_request_id": string,"p_to_line_id": string }; Returns: Json
                           },
"request_bin_count":
{ Args: { "p_bin_id": string,"p_request_id": string }; Returns: Json
                           },
"resolve_finding":
{ Args: { "p_finding_id": string,"p_no_part_reason"?: string,"p_part_id"?: string,"p_request_id": string }; Returns: Json
                           },
"return_to_supplier":
{ Args: { "p_bin_id": string,"p_part_id": string,"p_qty": number,"p_reason": string,"p_request_id": string }; Returns: Json
                           },
"search_parts":
{ Args: { "p_part_type"?: string,"p_q": string,"p_variant_id"?: string,"p_workshop_id": string }; Returns: {
              "available": number,"category": Database["public"]['Enums']["part_category"],"fits": boolean,"is_universal": boolean,"name": string,"name_hi": string,"oem_part_no": string,"part_id": string,"part_type": string,"sku": string,"uom": Database["public"]['Enums']["uom"],"usable_on_hand": number
            }[]
                           },
"set_bike_variant":
{ Args: { "p_bike_id": string,"p_request_id": string,"p_variant_id": string }; Returns: Json
                           },
"set_line_qty":
{ Args: { "p_line_id": string,"p_qty": number,"p_reason": string,"p_request_id": string }; Returns: Json
                           },
"set_needed_by":
{ Args: { "p_card_id": string,"p_date": string,"p_request_id": string }; Returns: Json
                           },
"start_repair":
{ Args: { "p_bike_id": string,"p_request_id": string }; Returns: Json
                           },
"switch_line_part":
{ Args: { "p_line_id": string,"p_part_id": string,"p_request_id": string }; Returns: Json
                           },
"update_draft_findings":
{ Args: { "p_card_id": string,"p_findings": Json,"p_request_id": string }; Returns: Json
                           }
          }
          Enums: {
            "app_role": "store_keeper"|"manager"|"admin","bike_status": "purchased"|"at_workshop"|"in_repair"|"ready"|"cancelled","bin_kind": "normal"|"receiving"|"quarantine","brake_type": "drum"|"disc","doc_type": "job_card"|"po"|"grn","emergency_reason": "no_stock"|"supplier_late"|"wrong_part_received"|"other","emission_norm": "bs3"|"bs4"|"bs6"|"bs6_obd2"|"bs6_obd2b","finding_area": "engine"|"brakes"|"drivetrain"|"electrical"|"body"|"tyres_suspension","fitment_source": "catalogue"|"learned","fuel_system": "carb"|"fi"|"ei","job_card_status": "draft"|"confirmed"|"closed"|"cancelled","line_source": "suggested"|"manual"|"extra","line_status": "needed"|"partially_reserved"|"reserved"|"issued"|"cancelled","move_type": "grn"|"putaway"|"move"|"issue"|"return_to_stock"|"return_to_quarantine"|"return_to_supplier"|"adjust_in"|"adjust_out"|"emergency_in","part_category": "consumable"|"wear"|"model_specific","po_line_source": "suggested"|"manual","po_status": "draft"|"sent"|"partially_received"|"received"|"closed"|"cancelled","start_type": "kick"|"self"|"kick_self","supplier_kind": "oem_dealer"|"wholesaler"|"local_market","uom": "pcs"|"set"|"pair"|"bottle"|"kit","vehicle_segment": "motorcycle"|"scooter"|"moped","wheel_type": "spoke"|"alloy"|"steel"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["store_keeper", "manager", "admin"],"bike_status": ["purchased", "at_workshop", "in_repair", "ready", "cancelled"],"bin_kind": ["normal", "receiving", "quarantine"],"brake_type": ["drum", "disc"],"doc_type": ["job_card", "po", "grn"],"emergency_reason": ["no_stock", "supplier_late", "wrong_part_received", "other"],"emission_norm": ["bs3", "bs4", "bs6", "bs6_obd2", "bs6_obd2b"],"finding_area": ["engine", "brakes", "drivetrain", "electrical", "body", "tyres_suspension"],"fitment_source": ["catalogue", "learned"],"fuel_system": ["carb", "fi", "ei"],"job_card_status": ["draft", "confirmed", "closed", "cancelled"],"line_source": ["suggested", "manual", "extra"],"line_status": ["needed", "partially_reserved", "reserved", "issued", "cancelled"],"move_type": ["grn", "putaway", "move", "issue", "return_to_stock", "return_to_quarantine", "return_to_supplier", "adjust_in", "adjust_out", "emergency_in"],"part_category": ["consumable", "wear", "model_specific"],"po_line_source": ["suggested", "manual"],"po_status": ["draft", "sent", "partially_received", "received", "closed", "cancelled"],"start_type": ["kick", "self", "kick_self"],"supplier_kind": ["oem_dealer", "wholesaler", "local_market"],"uom": ["pcs", "set", "pair", "bottle", "kit"],"vehicle_segment": ["motorcycle", "scooter", "moped"],"wheel_type": ["spoke", "alloy", "steel"]
          }
        }
} as const
