// Core domain types
export interface Lead {
  name: string;
  role: string;
  email?: string;
  linkedin: string;
}

export interface CompanyInfo {
  id: string;
  name: string;
  primary_domain: string;
  website_url?: string;
  blog_url?: string;
  
  // Social media links
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  angellist_url?: string;
  crunchbase_url?: string;
  
  // Contact information
  phone?: string;
  primary_phone?: {
    number: string;
    source: string;
    sanitized_number: string;
  };
  sanitized_phone?: string;
  
  // Location information
  raw_address?: string;
  street_address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  
  // Company details
  industry?: string;
  industries?: string[];
  secondary_industries?: string[];
  founded_year?: number;
  estimated_num_employees?: number;
  
  // Financial information
  organization_revenue?: number;
  organization_revenue_printed?: string;
  annual_revenue?: number;
  annual_revenue_printed?: string;
  total_funding?: number;
  total_funding_printed?: string;
  latest_funding_round_date?: string;
  latest_funding_stage?: string;
  
  // Business information
  short_description?: string;
  keywords?: string[];
  sic_codes?: string[];
  naics_codes?: string[];
  
  // Technology stack
  technology_names?: string[];
  current_technologies?: any[];
  
  // Organizational structure
  org_chart_root_people_ids?: string[];
  org_chart_sector?: string;
  departmental_head_count?: {
    finance?: number;
    sales?: number;
    engineering?: number;
    human_resources?: number;
    administrative?: number;
    operations?: number;
    accounting?: number;
    marketing?: number;
    data_science?: number;
    education?: number;
    arts_and_design?: number;
    business_development?: number;
    consulting?: number;
    support?: number;
    media_and_commmunication?: number;
    legal?: number;
    product_management?: number;
    information_technology?: number;
    entrepreneurship?: number;
  };
  
  // Additional metadata
  logo_url?: string;
  linkedin_uid?: string;
  alexa_ranking?: number;
  languages?: string[];
  publicly_traded_symbol?: string;
  publicly_traded_exchange?: string;
  owned_by_organization_id?: string;
  suborganizations?: any[];
  num_suborganizations?: number;
  snippets_loaded?: boolean;
  industry_tag_id?: string;
  industry_tag_hash?: Record<string, string>;
  retail_location_count?: number;
  funding_events?: any[];
  org_chart_removed?: boolean;
  org_chart_show_department_filter?: boolean;
  generic_org_insights?: any;
}

export interface PersonInfo {
  id?: string;
  firstName?: string;
  lastName?: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  organizationName?: string;
  organizationId?: string;
  photoUrl?: string;
  headline?: string;
  city?: string;
  state?: string;
  country?: string;
}

// API Response types
export interface ApolloCompanyResponse {
  organization?: CompanyInfo;
  error?: string;
}

export interface ApolloPersonResponse {
  person?: PersonInfo;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilySearchResponse {
  results: SearchResult[];
  query: string;
  answer?: string;
}

// Workflow state types
export type WorkflowStep = 
  | "process_query" 
  | "enrich" 
  | "search_managers" 
  | "summarize" 
  | "end";

export interface WorkflowState {
  companyName?: string;
  companyDomain?: string;
  companyInfo?: CompanyInfo;
  currentStep: WorkflowStep;
  error?: string;
  leads: Lead[];
  messages: any[]; // BaseMessage[] from LangChain
}

// Result types
export interface ProcessCompanyResult {
  success: boolean;
  summary?: string;
  companyDomain?: string;
  companyData?: CompanyInfo;
  leads?: Lead[];
  error?: string;
  message?: string;
}

// Error types
export class EnrichmentError extends Error {
  constructor(
    message: string, 
    public code: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class APIError extends Error {
  constructor(
    message: string, 
    public statusCode: number,
    public endpoint: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Configuration types
export interface Config {
  apollo: {
    baseUrl: string;
    timeout: number;
    apiKey: string;
  };
  search: {
    maxResults: number;
    leadTypes: string[];
  };
  openai: {
    temperature: number;
    model: string;
  };
}

// Tool input/output types
export interface CompanyEnrichmentInput {
  domain: string;
}

export interface PersonEnrichmentInput {
  name: string;
  company: string;
}

export interface DomainExtractionInput {
  results: SearchResult[];
}

// Validation schemas
export const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LINKEDIN_URL_REGEX = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+\/?$/;
