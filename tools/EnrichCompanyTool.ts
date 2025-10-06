import axios, { AxiosResponse } from "axios";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { 
  CompanyInfo, 
  ApolloCompanyResponse, 
  CompanyEnrichmentInput,
  APIError,
  EnrichmentError,
  ValidationError,
  DOMAIN_REGEX
} from "../types";

export const enrichCompanyTool = () =>
  tool(
    async ({ domain }: CompanyEnrichmentInput): Promise<string> => {
      try {
        // Validate input
        if (!domain || typeof domain !== 'string') {
          throw new ValidationError("Domain is required and must be a string", "domain");
        }

        const cleanDomain = domain.trim().toLowerCase();
        if (!DOMAIN_REGEX.test(cleanDomain)) {
          throw new ValidationError(`Invalid domain format: ${cleanDomain}`, "domain");
        }

        // Check API key
        if (!process.env.APOLLO_API_KEY) {
          throw new ValidationError("APOLLO_API_KEY not found in environment variables", "apiKey");
        }

        const url = "https://api.apollo.io/v1/organizations/enrich";
        
        const response: AxiosResponse<ApolloCompanyResponse> = await axios.get(url, {
          params: { domain: cleanDomain },
          headers: {
            "x-api-key": process.env.APOLLO_API_KEY,
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 second timeout
        });

        // Handle different response scenarios
        if (response.status !== 200) {
          throw new APIError(
            `Apollo API returned status ${response.status}`,
            response.status,
            url
          );
        }

        const data = response.data;
        console.log('DATA', data)

        if (data.error) {
          throw new EnrichmentError(data.error, "APOLLO_API_ERROR");
        }

        if (!data.organization) {
          throw new EnrichmentError("Company not found in Apollo database", "COMPANY_NOT_FOUND");
        }

        // Validate required fields
        const company = data.organization;
        if (!company.name || !company.website_url) {
          throw new EnrichmentError("Company data missing required fields", "INVALID_COMPANY_DATA");
        }

        return JSON.stringify(company);
      } catch (error) {
        console.error("Error in enrichCompanyTool:", error);
        
        if (error instanceof ValidationError || error instanceof APIError || error instanceof EnrichmentError) {
          return JSON.stringify({ error: error.message, code: error.name });
        }

        if (axios.isAxiosError(error)) {
          const statusCode = error.response?.status || 0;
          const message = error.response?.data?.message || error.message;
          return JSON.stringify({ 
            error: `Apollo API error: ${message}`, 
            code: "APOLLO_API_ERROR",
            statusCode 
          });
        }

        return JSON.stringify({ 
          error: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
          code: "UNKNOWN_ERROR" 
        });
      }
    },
    {
      name: "apollo_company_info",
      description: "Gets company information from Apollo.io API using company domain",
      schema: z.object({
        domain: z
          .string()
          .min(1, "Domain cannot be empty")
          .regex(DOMAIN_REGEX, "Invalid domain format")
          .describe("The domain name of the company to look up (e.g., 'example.com')"),
      }),
    }
  );
