import axios, { AxiosResponse } from "axios";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { 
  PersonInfo, 
  ApolloPersonResponse, 
  PersonEnrichmentInput,
  APIError,
  EnrichmentError,
  ValidationError
} from "../types";

export const enrichPersonTool = () =>
  tool(
    async ({ name, company }: PersonEnrichmentInput): Promise<string> => {
      try {
        // Validate input
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          throw new ValidationError("Name is required and must be a non-empty string", "name");
        }

        if (!company || typeof company !== 'string' || company.trim().length === 0) {
          throw new ValidationError("Company is required and must be a non-empty string", "company");
        }

        // Check API key
        if (!process.env.APOLLO_API_KEY) {
          throw new ValidationError("APOLLO_API_KEY not found in environment variables", "apiKey");
        }

        const url = "https://api.apollo.io/api/v1/people/match";
        
        const response: AxiosResponse<ApolloPersonResponse> = await axios.post(url, {
          name: name.trim(),
          organization_name: company.trim(),
        }, {
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

        if (data.error) {
          throw new EnrichmentError(data.error, "APOLLO_API_ERROR");
        }

        if (!data.person) {
          throw new EnrichmentError("Person not found in Apollo database", "PERSON_NOT_FOUND");
        }

        // Validate required fields
        const person = data.person;
        if (!person.name) {
          throw new EnrichmentError("Person data missing required fields", "INVALID_PERSON_DATA");
        }

        return JSON.stringify(person);
      } catch (error) {
        console.error("Error in enrichPersonTool:", error);
        
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
      name: "apollo_person_info",
      description: "Gets person information from Apollo.io API using name and company",
      schema: z.object({
        name: z
          .string()
          .min(1, "Name cannot be empty")
          .describe("The full name of the person to look up"),
        company: z
          .string()
          .min(1, "Company cannot be empty")
          .describe("The company name where the person works"),
      }),
    }
  );
